import { NextResponse } from 'next/server';
import { getKvStorage } from '@/lib/storage/kvClient';
import { isAdminAuthorized } from '@/lib/auth';

// 辅助函数：通过前缀分页统计 KV 中的键数量
async function countKeysByPrefix(kv, prefix) {
    if (!kv) return 0;

    let count = 0;
    let cursor = undefined;
    let listComplete = false;

    while (!listComplete) {
        const options = { prefix, limit: 1000 };
        if (cursor) options.cursor = cursor;

        try {
            const listResult = await kv.list(options);
            if (listResult && listResult.keys) {
                count += listResult.keys.length;
            }
            listComplete = listResult.list_complete;
            cursor = listResult.cursor;
        } catch (e) {
            console.error(`[Admin Stats] KV List failed for prefix ${prefix}:`, e);
            break; // 失败则停止，防止死循环
        }
    }

    return count;
}

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const kv = await getKvStorage();
        if (!kv) {
            return NextResponse.json({
                users: 0, stocks: 0, funds: 0,
                message: 'KV Storage API unavailable (running locally?)'
            });
        }

        // 并发统计三类前缀
        const [usersCount, stocksCount, fundsCount] = await Promise.all([
            countKeysByPrefix(kv, 'user:assets:'),
            countKeysByPrefix(kv, 'hist:stock:'),
            countKeysByPrefix(kv, 'hist:fund:')
        ]);

        return NextResponse.json({
            users: usersCount,
            stocks: stocksCount,
            funds: fundsCount
        });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
