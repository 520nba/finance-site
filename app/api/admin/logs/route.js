import { NextResponse } from 'next/server';
import { getSystemLogs } from '@/lib/storage/logRepo';
import { isAdminAuthorized } from '@/lib/storage/authRepo';

export async function GET(request) {
    if (!(await isAdminAuthorized(request))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get('hours') || '72');

    try {
        const logs = await getSystemLogs(hours);
        return NextResponse.json({ success: true, logs });
    } catch (e) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
