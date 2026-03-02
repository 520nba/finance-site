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

    const data = await readDoc(STORAGE_KEY, {});
    const userIds = Object.keys(data).filter(id => id !== 'admin'); // 排除 admin 自己

    return NextResponse.json(userIds);
}
