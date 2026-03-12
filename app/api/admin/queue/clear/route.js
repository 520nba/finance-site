import { NextResponse } from 'next/server';
import { runSql } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';
import { syncCounterFromTable } from '@/lib/storage/statsRepo';
import { addSystemLog } from '@/lib/storage/logRepo';

export const dynamic = 'force-dynamic';

/**
 * 清空同步队列接口
 * 操作：物理删除 sync_queue 表中的所有记录，并校准计数器。
 */
export async function POST(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const res = await runSql('DELETE FROM sync_queue');
        const count = res?.meta?.changes || 0;

        // 强制校准计数器
        await syncCounterFromTable('queue_count', 'sync_queue');

        await addSystemLog('WARN', 'QueueAdmin', `Manual queue purge: ${count} tasks cleared.`);

        return NextResponse.json({
            success: true,
            message: `Successfully cleared ${count} tasks from the sync queue.`,
            cleared: count
        });
    } catch (e) {
        console.error('[QueueClear] Failure:', e.message);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
