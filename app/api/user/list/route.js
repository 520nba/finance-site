import { NextResponse } from 'next/server';
import { readDoc } from '@/lib/storage';
import { isAdminAuthorized } from '@/lib/auth';

const STORAGE_KEY = 'users_config';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const INDEX_KEY = 'users_index';
    const userIds = await readDoc(INDEX_KEY, []);

    // 排除 admin
    const filtered = userIds.filter(id => id !== 'admin');

    return NextResponse.json(filtered);
}
