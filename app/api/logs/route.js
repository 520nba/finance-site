import { NextResponse } from 'next/server';
import { getSystemLogs, cleanupOldData, addSystemLog } from '@/lib/storage';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const hours = parseInt(searchParams.get('hours')) || 48;
        const format = searchParams.get('format') || 'json';

        // 触发清理一次，由于 GET 是高频操作，我们只小概率触发
        if (Math.random() < 0.1) {
            cleanupOldData().catch(() => { });
        }

        const { getCloudflareContext } = await import('@opennextjs/cloudflare');

        await addSystemLog('INFO', 'System', `Logs accessed (Filter: ${hours}h)`);

        const logs = await getSystemLogs(hours);

        if (format === 'csv') {
            const header = 'ID,Level,Module,Message,Timestamp\n';
            const rows = logs.map(l => {
                const msg = (l.message || '').replace(/"/g, '""');
                return `${l.id},${l.level},${l.module},"${msg}",${l.timestamp}`;
            }).join('\n');

            return new Response(header + rows, {
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': `attachment; filename="system_logs_${new Date().toISOString()}.csv"`
                }
            });
        }

        return NextResponse.json(logs);
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
