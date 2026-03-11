import { NextResponse } from 'next/server';
import { queryAll, runSql } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * 强行同步接口：将指定类型的所有资产推入高优先同步队列
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
        const assets = await queryAll('SELECT DISTINCT code, type FROM user_assets WHERE type = ?', [type]);
        if (assets.length === 0) {
            return NextResponse.json({ success: true, message: `No ${type}s found in user tracking lists.` });
        }

        // 2. 物理抹除旧数据 (维度 1 优化)
        // 为了防止“单位净值”与“累计净值”混合导致的曲线断层，强行同步前必须物理删除原有历史
        const codes = assets.map(a => a.code.toLowerCase());

        // 分片删除，防止 SQL 语句过长或超出 D1 限制
        for (let i = 0; i < codes.length; i += 50) {
            const chunk = codes.slice(i, i + 50);
            const placeholders = chunk.map(() => '?').join(',');
            await runSql(`DELETE FROM asset_history WHERE type = ? AND code IN (${placeholders})`, [type, ...chunk]);
        }

        // 3. 清理并推入队列
        // 先删除队列中已存在的同类任务，确保能重新触发全量拉取
        await runSql('DELETE FROM sync_queue WHERE type = ?', [type]);

        const { addToSyncQueue } = await import('@/lib/storage/historyRepo');
        await addToSyncQueue(assets);

        // 4. 记录审计日志
        const { addSystemLog } = await import('@/lib/storage/logRepo');
        await addSystemLog('WARN', 'ForceSync', `Full Re-Sync Triggered [${type}]: ${assets.length} assets cleared and pushed to queue.`);

        return NextResponse.json({
            success: true,
            message: `Successfully cleared and queued ${assets.length} ${type}s. Background workers are rebuilding the smooth history now.`
        });
    } catch (e) {
        console.error('[ForceSync] Queue Injection Failure:', e.message);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
