import { NextResponse } from 'next/server';
import { getD1Storage, runSql, queryOne, queryAll } from '@/lib/storage/d1Client';

/**
 * D1 深度诊断接口
 * 路径: /api/diag/d1-test
 * 用法: GET /api/diag/d1-test?token=SECRET
 */
export async function GET(request) {
    const token = new URL(request.url).searchParams.get('token');
    if (!process.env.DIAG_SECRET || token !== process.env.DIAG_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const report = {
        timestamp: new Date().toISOString(),
        steps: []
    };

    try {
        // 1. 获取 DB 实例
        report.steps.push({ name: 'get_db_instance' });
        const db = await getD1Storage();
        if (!db) throw new Error('D1 Binding (DB) is missing');
        report.steps[0].status = 'success';

        // 2. 基础写入测试 (使用临时表或系统表/现有表进行安全读写)
        // 我们在 users 表里操作一个专门的测试账号 diag_test_user
        const TEST_USER = 'diag_test_user_' + Date.now();
        report.steps.push({ name: 'write_test' });
        await runSql('INSERT INTO users (id) VALUES (?)', [TEST_USER]);
        report.steps[1].status = 'success';

        // 3. 基础读取测试
        report.steps.push({ name: 'read_back_test' });
        const row = await queryOne('SELECT id, last_login FROM users WHERE id = ?', [TEST_USER]);
        if (!row || row.id !== TEST_USER) throw new Error('Read back failed: mismatch or not found');
        report.steps[2].status = 'success';
        report.steps[2].data = row;

        // 4. 复杂查询测试 (Join 测试)
        report.steps.push({ name: 'complex_query_test' });
        const assets = await queryAll('SELECT * FROM user_assets LIMIT 5');
        report.steps[3].status = 'success';
        report.steps[3].count = assets.length;

        // 5. 权限与 Schema 校验
        report.steps.push({ name: 'schema_check' });
        const tables = await queryAll("SELECT name FROM sqlite_master WHERE type='table'");
        report.steps[4].status = 'success';
        report.steps[4].tables = tables.map(t => t.name);

        // 6. 清理测试数据
        report.steps.push({ name: 'cleanup_test' });
        await runSql('DELETE FROM users WHERE id = ?', [TEST_USER]);
        report.steps[5].status = 'success';

        return NextResponse.json({ success: true, report });

    } catch (e) {
        return NextResponse.json({
            success: false,
            error: e.message,
            stack: e.stack,
            report
        }, { status: 500 });
    }
}
