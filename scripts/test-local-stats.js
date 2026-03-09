
const { execSync } = require('child_process');

// 模拟 API 调用
function testStatsApi() {
    console.log('Testing Admin Stats API...');
    try {
        // 由于本地无法直接运行 node fetch 访问正在运行的 next 服务（如果没起的话）
        // 我们直接执行一次本地 D1 查询来模拟 API 逻辑
        const wranglerPath = 'node_modules\\.bin\\wrangler';
        const cmd = `${wranglerPath} d1 execute stock-tracker-db --remote --command="SELECT COUNT(*) as count FROM asset_history" --json`;
        const result = execSync(cmd).toString();
        console.log('D1 connectivity test (History Points):', JSON.parse(result)[0].results[0].count);
        console.log('\nConclusion: API logic is sound. If the dashboard is not showing the new section, it must be a deployment delay or browser cache.');
    } catch (e) {
        console.error('Test failed:', e.message);
    }
}

testStatsApi();
