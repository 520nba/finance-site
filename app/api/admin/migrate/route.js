import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { runSql } from '@/lib/storage/d1Client';
import { isAdminAuthorized } from '@/lib/auth';

/**
 * API Health 表迁移脚本
 * 增加 success_count, fail_count, total_count 以计算真实成功率
 * 增加 heartbeat_ts 用于探测延迟心跳
 */
export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        console.log('[Migration] Upgrading api_health table structure...');

        // 1. 创建新表结构
        await runSql(`
            CREATE TABLE IF NOT EXISTS api_health_new (
                api_name TEXT PRIMARY KEY,
                status TEXT DEFAULT 'unknown',
                success_rate REAL DEFAULT 0,
                avg_latency INTEGER DEFAULT 0,
                success_count INTEGER DEFAULT 0,
                fail_count INTEGER DEFAULT 0,
                total_count INTEGER DEFAULT 0,
                last_check DATETIME DEFAULT CURRENT_TIMESTAMP,
                heartbeat_ts DATETIME DEFAULT CURRENT_TIMESTAMP,
                error_msg TEXT
            )
        `);

        // 2. 迁移旧数据 (如果存在)
        await runSql(`
            INSERT OR IGNORE INTO api_health_new (api_name, status, success_rate, avg_latency, last_check, error_msg)
            SELECT api_name, status, success_rate, avg_latency, last_check, error_msg FROM api_health
        `);

        // 3. 切换表名
        await runSql(`DROP TABLE IF EXISTS api_health`);
        await runSql(`ALTER TABLE api_health_new RENAME TO api_health`);

        return NextResponse.json({ success: true, message: 'Schema migration: api_health upgraded successfully.' });
    } catch (e) {
        console.error('[Migration] Failed:', e.message);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
