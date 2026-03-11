import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/storage/d1Client';
import { getD1Storage } from '@/lib/storage/historyRepo';
import { fetchStockHistory, fetchFundHistory } from '@/lib/services/historyFetcher';
import { syncCounterFromTable } from '@/lib/storage/statsRepo';
import { isAdminAuthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * 强行同步接口：拉取最新 250 条数据并彻底替换旧数据
 */
export async function POST(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { type } = await request.json(); // 'stock' 或 'fund'
        if (!['stock', 'fund'].includes(type)) {
            return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
        }

        // 1. 获取所有该类型的资产代码
        const assets = await queryAll('SELECT DISTINCT code FROM user_assets WHERE type = ?', [type]);
        if (assets.length === 0) {
            return NextResponse.json({ success: true, message: `No ${type}s to sync` });
        }

        const db = await getD1Storage();
        let successCount = 0;
        let failCount = 0;

        // 2. 遍历同步 (逐个处理以防 Worker 超时，如果资产极多建议走 SyncQueue，但用户要求“点击后拉取并替换”)
        // 注意：在大规模资产下，此接口可能会因为 30s 限制而中断。
        for (const asset of assets) {
            const { code } = asset;
            try {
                const history = type === 'fund'
                    ? await fetchFundHistory(code, 250)
                    : await fetchStockHistory(code, 250);

                if (history && history.length > 0) {
                    // 原子化操作：删除旧数据 + 插入新数据
                    const stmts = [
                        db.prepare('DELETE FROM asset_history WHERE code = ? AND type = ?').bind(code, type)
                    ];

                    // 分片插入
                    const records = history.map(h => ({
                        code,
                        type,
                        price: h.value,
                        date: h.date
                    }));

                    for (const r of records) {
                        stmts.push(
                            db.prepare('INSERT INTO asset_history (code, type, price, record_date) VALUES (?, ?, ?, ?)')
                                .bind(r.code, r.type, r.price, r.date)
                        );
                    }

                    // 由于 D1 batch 限制 100 条，历史 250 条需要分批事务
                    const CHUNK = 90;
                    for (let i = 0; i < stmts.length; i += CHUNK) {
                        await db.batch(stmts.slice(i, i + CHUNK));
                    }
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (err) {
                console.error(`[ForceSync] Failed ${code}:`, err.message);
                failCount++;
            }
        }

        // 3. 校准计数器
        await syncCounterFromTable('history_points', 'asset_history');

        return NextResponse.json({
            success: true,
            message: `Force synced ${type}s: ${successCount} success, ${failCount} failed.`
        });
    } catch (e) {
        console.error('[ForceSync] Global Failure:', e.message);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
