import { NextResponse } from 'next/server';
import { isAdminAuthorized } from '@/lib/storage/authRepo';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getKvStorage } from '@/lib/storage/d1Client';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const QUEUE = await getKvStorage('STOCK_DATA');
    if (!QUEUE) {
        return NextResponse.json({ queue: [], count: 0, status: 'error', message: 'STOCK_DATA KV not bound' });
    }

    try {
        const list = await QUEUE.list({ prefix: 'fund:' });
        const items = await Promise.all(list.keys.map(async (key) => {
            const val = await QUEUE.get(key.name);
            return {
                id: key.name.split(':')[1],
                ...(val ? JSON.parse(val) : { status: 'unknown' })
            };
        }));

        return NextResponse.json({
            queue: items,
            count: items.length,
            status: items.some(i => i.status === 'processing') ? 'running' : (items.length > 0 ? 'pending' : 'idle')
        });
    } catch (e) {
        return NextResponse.json({ error: e.message, status: 'error' }, { status: 500 });
    }
}

/**
 * 允许手动重置/清理队列（危险操作，仅限管理员）
 */
export async function DELETE(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const QUEUE = await getKvStorage('STOCK_DATA');
    if (!QUEUE) return NextResponse.json({ error: 'KV not found' }, { status: 500 });

    const list = await QUEUE.list({ prefix: 'fund:' });
    await Promise.all(list.keys.map(k => QUEUE.delete(k.name)));

    return NextResponse.json({ ok: true, cleared: list.keys.length });
}
