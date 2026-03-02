import { NextResponse } from 'next/server';
import { getSystemLogs, cleanupOldData } from '@/lib/storage';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const hours = parseInt(searchParams.get('hours')) || 48;
        const format = searchParams.get('format') || 'json';

        // 触发清理一次，由于 GET 是高频操作，我们只小概率触发
        if (Math.random() < 0.1) {
            cleanupOldData().catch(() => { });
        }

        // 尝试自动初始化表（生产环境如果 D1 没刷脚本，这里可以兜底）
        const { getCloudflareContext } = await import('@opennextjs/cloudflare');
        const { env } = await getCloudflareContext();
        if (env?.DB) {
            await env.DB.prepare(`
                CREATE TABLE IF NOT EXISTS system_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    level TEXT NOT NULL,
                    module TEXT,
                    message TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            `).run();
            await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON system_logs(timestamp);`).run();
            // 顺便初始化 asset_intraday
            await env.DB.prepare(`
                CREATE TABLE IF NOT EXISTS asset_intraday (
                    code TEXT NOT NULL,
                    record_date TEXT NOT NULL,
                    data TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(code, record_date)
                );
            `).run();
        }

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
