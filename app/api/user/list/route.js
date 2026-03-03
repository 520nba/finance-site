import { NextResponse } from 'next/server';
import { readDoc } from '@/lib/storage';

const STORAGE_KEY = 'users_config';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const adminId = searchParams.get('adminId');

    // 简单验证：只有 ID 为 admin 的用户可以获取列表
    if (adminId !== 'admin') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const INDEX_KEY = 'users_index';
    const userIds = await readDoc(INDEX_KEY, []);

    // 排除 admin
    const filtered = userIds.filter(id => id !== 'admin');

    return NextResponse.json(filtered);
}
