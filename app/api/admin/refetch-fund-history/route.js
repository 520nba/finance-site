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
    if (!db) {
        return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });
    }

    // 3. 获取所有基金列表
    const { results: funds } = await db
        .prepare("SELECT DISTINCT code FROM user_assets WHERE type = 'fund'")
        .all();

    if (!funds?.length) {
        return NextResponse.json({ ok: true, message: 'No funds found' });
    }

    // 4. 使用 Stream 边处理边输出进度 (NDJSON)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (data) => {
                controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
            };

            send({ status: 'started', total: funds.length, force });

            for (let i = 0; i < funds.length; i++) {
                const { code } = funds[i];
                try {
                    // 1. 先从外部拉取数据 (核心：防止先删后抓失败导致的数据丢失)
                    const history = await fetchFundHistory(code, HISTORY_DAYS);

                    if (!history?.length) {
                        send({ index: i + 1, code, status: 'skipped', reason: 'empty_response' });
                        continue;
                    }

                    // 2. 查本地历史（非 force 模式下需要做增量过滤）
                    let latestDate = null;
                    if (!force) {
                        const row = await db
                            .prepare("SELECT MAX(record_date) AS latest FROM asset_history WHERE code = ? AND type = 'fund'")
                            .bind(code.toLowerCase())
                            .first();
                        latestDate = row?.latest ?? null;
                    } else {
                        // force 模式：先物理清空旧数据
                        await deleteAssetHistory(code, 'fund', { DB: db });
                    }

                    if (!history?.length) {
                        send({ index: i + 1, code, status: 'skipped', reason: 'empty_response' });
                        continue;
                    }

                    // 增量过滤
                    const toWrite = (latestDate && !force)
                        ? history.filter(h => h.date > latestDate)
                        : history;

                    if (!toWrite.length) {
                        send({ index: i + 1, code, status: 'skipped', reason: 'no_new_data' });
                        continue;
                    }

                    // 批量写入 D1
                    await insertDailyPricesBatch(
                        toWrite.map(r => ({ code, type: 'fund', price: r.value, date: r.date })),
                        { DB: db }
                    );

                    send({
                        index: i + 1,
                        code,
                        status: 'ok',
                        written: toWrite.length,
                        is_force: force
                    });
                } catch (e) {
                    console.error(`[RefetchFund] Error for ${code}:`, e.message);
                    send({ index: i + 1, code, status: 'error', error: e.message });
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
