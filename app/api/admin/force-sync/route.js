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

        // 2. 清理原有队列并注入新任务 (维度 1 优化)
        // 移除提前 DELETE 逻辑，防止同步期间出现空白数据。
        // 现在 fetcher 已具备 250d 全量强制抓取和数量校验能力，同步成功后会自动覆盖并对齐历史。
        await runSql('DELETE FROM sync_queue WHERE type = ? AND status != "done"', [type]);

        const { addToSyncQueue } = await import('@/lib/storage/historyRepo');
        await addToSyncQueue(assets);

        // 3. 记录审计日志
        const { addSystemLog } = await import('@/lib/storage/logRepo');
        await addSystemLog('WARN', 'ForceSync', `Standard Re-Sync Queued [${type}]: ${assets.length} items. New standard points will overwrite old data in background.`);

        return NextResponse.json({
            success: true,
            message: `Successfully queued ${assets.length} ${type}s for background synchronization. History standards will be aligned progressively.`
        });
    } catch (e) {
        console.error('[ForceSync] Queue Injection Failure:', e.message);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
