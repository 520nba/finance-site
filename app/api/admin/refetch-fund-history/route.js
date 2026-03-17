/**
 * src/app/api/admin/refetch-fund-history/route.js
 * 
 * 专用基金重刷接口，采用 Streaming (NDJSON) 响应以防止超时及提供实时进度。
 */

import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '@/lib/storage/authRepo';
import { fetchFundHistory } from '@/lib/services/historyFetcher';
import { insertDailyPricesBatch, deleteAssetHistory } from '@/lib/storage/historyRepo';
import { getD1Storage } from '@/lib/storage/d1Client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5分钟限时

const HISTORY_DAYS = 250;

export async function GET(request) {
    // 1. 鉴权
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === '1';

    // 2. 准备数据库
    const db = await getD1Storage();
    if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });

    // 3. 获取所有基金列表
    const { results: funds } = await db
        .prepare("SELECT DISTINCT code FROM user_assets WHERE type = 'fund'")
        .all();

    if (!funds?.length) return NextResponse.json({ ok: true, message: 'No funds found' });

    // 4. 使用 Stream 处理多阶段逻辑报告
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (data) => controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));

            send({ status: 'started', total: funds.length, force });

            const allStatements = [];
            const fetchResults = [];

            // 阶段一：批量离线抓取 (数据密集型，不涉及 D1 写入)
            for (let i = 0; i < funds.length; i++) {
                const { code } = funds[i];
                try {
                    const history = await fetchFundHistory(code, HISTORY_DAYS);
                    if (!history?.length) {
                        send({ index: i + 1, code, status: 'skipped', reason: 'empty_response' });
                        continue;
                    }

                    // 预处理增量逻辑 (如果是 force 模式，之后会补 delete 语句)
                    let latestDate = null;
                    if (!force) {
                        const row = await db.prepare("SELECT MAX(record_date) AS latest FROM asset_history WHERE code = ? AND type = 'fund'").bind(code.toLowerCase()).first();
                        latestDate = row?.latest ?? null;
                    }

                    fetchResults.push({ code, history, latestDate });
                    send({ index: i + 1, code, status: 'fetched', count: history.length });
                } catch (e) {
                    send({ index: i + 1, code, status: 'error', error: e.message });
                }
            }

            // 阶段二：聚合生成 SQL 语句 (准备进行一次性原子写入)
            send({ status: 'writing_prepare', count: fetchResults.length });

            for (const item of fetchResults) {
                const { code, history, latestDate } = item;

                if (force) {
                    allStatements.push(db.prepare('DELETE FROM asset_history WHERE code = ? AND type = ?').bind(code.toLowerCase(), 'fund'));
                }

                const toWrite = (latestDate && !force) ? history.filter(h => h.date > latestDate) : history;
                if (!toWrite.length) continue;

                // 为了节省 D1 batch 语句数限制 (上限100)，这里每只基金的历史点进行一次内部 Chunk 收集
                // 由于每只基金 250 天，按 100 条分片，每只有 3 条 INSERT 语句
                for (let j = 0; j < toWrite.length; j += 100) {
                    const chunk = toWrite.slice(j, j + 100);
                    // 此处暂不改写 historyRepo，直接手动快速构建 stmts
                    // 本次优化目标是解决 subrequest 配额，分片写入仍使用 .batch 提升效率
                    const insertSql = `INSERT OR REPLACE INTO asset_history (code, type, price, record_date) VALUES ` +
                        chunk.map(() => "(?, 'fund', ?, ?)").join(', ');
                    const params = [];
                    chunk.forEach(r => params.push(code.toLowerCase(), r.value, r.date));
                    allStatements.push(db.prepare(insertSql).bind(...params));
                }
            }

            // 阶段三：执行 D1 Batch (核心性能优化：降低子请求到 1 次)
            if (allStatements.length > 0) {
                // 如果语句总数还是很多（例如 > 100），仍需切分 batch
                // 25 只基金 * 4 句 = 100 句，正好能卡在 D1 单次 batch 限制内
                for (let k = 0; k < allStatements.length; k += 100) {
                    const batchChunk = allStatements.slice(k, k + 100);
                    await db.batch(batchChunk);
                    send({ status: 'ok', batch_index: Math.floor(k / 100) + 1, batch_size: batchChunk.length });
                }
            }

            send({ status: 'done', total: funds.length });
            controller.close();
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson',
            'Cache-Control': 'no-cache, no-transform',
            'X-Content-Type-Options': 'nosniff'
        },
    });
}
