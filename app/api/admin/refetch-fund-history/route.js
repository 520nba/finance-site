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

    // 3. 获取所有基金列表及最新时间戳 (优化点：单次批量查询，节省 25 次子请求)
    const { results: funds } = await db
        .prepare("SELECT DISTINCT code FROM user_assets WHERE type = 'fund'")
        .all();

    if (!funds?.length) return NextResponse.json({ ok: true, message: 'No funds found' });

    // 如果是非 force 模式，预先批量抓取所有基金的最新记录日期，避免在循环中产生 25 次子请求
    const latestDatesMap = {};
    if (!force) {
        const batchQuery = funds.map(f =>
            db.prepare("SELECT MAX(record_date) AS latest FROM asset_history WHERE code = ? AND type = 'fund'").bind(f.code.toLowerCase())
        );
        const results = await db.batch(batchQuery);
        funds.forEach((f, idx) => {
            latestDatesMap[f.code.toLowerCase()] = results[idx]?.results?.[0]?.latest ?? null;
        });
    }

    // 4. 使用 Stream 处理多阶段逻辑报告
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (data) => controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));

            send({ status: 'started', total: funds.length, force });

            const allStatements = [];
            const fetchResults = [];

            // 阶段一：批量离线抓取 (数据密集型，仅 fetch)
            for (let i = 0; i < funds.length; i++) {
                const { code } = funds[i];
                try {
                    const history = await fetchFundHistory(code, HISTORY_DAYS);
                    if (!history?.length) {
                        send({ index: i + 1, code, status: 'skipped', reason: 'empty_response' });
                        continue;
                    }

                    const latestDate = latestDatesMap[code.toLowerCase()] || null;
                    fetchResults.push({ code, history, latestDate });
                    send({ index: i + 1, code, status: 'fetched', count: history.length });
                } catch (e) {
                    send({ index: i + 1, code, status: 'error', error: e.message });
                }
            }

            // 阶段二：聚合生成 SQL 语句
            send({ status: 'writing_prepare', count: fetchResults.length });

            for (const item of fetchResults) {
                const { code, history, latestDate } = item;

                if (force) {
                    allStatements.push(db.prepare('DELETE FROM asset_history WHERE code = ? AND type = ?').bind(code.toLowerCase(), 'fund'));
                }

                const toWrite = (latestDate && !force) ? history.filter(h => h.date > latestDate) : history;
                if (!toWrite.length) continue;

                // 250 天数据，按 50 条分片，保证 stmts 数量可控
                for (let j = 0; j < toWrite.length; j += 50) {
                    const chunk = toWrite.slice(j, j + 50);
                    const insertSql = `INSERT OR REPLACE INTO asset_history (code, type, price, record_date) VALUES ` +
                        chunk.map(() => "(?, 'fund', ?, ?)").join(', ');
                    const params = [];
                    chunk.forEach(r => params.push(code.toLowerCase(), r.value, r.date));
                    allStatements.push(db.prepare(insertSql).bind(...params));
                }
            }

            // 阶段三：分批执行 D1 Batch (每个 batch 控制在 50 条语句内，更稳健)
            if (allStatements.length > 0) {
                const totalBatches = Math.ceil(allStatements.length / 50);
                for (let k = 0; k < allStatements.length; k += 50) {
                    const batchChunk = allStatements.slice(k, k + 50);
                    await db.batch(batchChunk);
                    const batchIdx = Math.floor(k / 50) + 1;
                    send({ status: 'ok', batch_index: batchIdx, total_batches: totalBatches });
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
