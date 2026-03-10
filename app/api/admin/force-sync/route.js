import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { fetchFundHistory } from '@/lib/services/historyFetcher';
import { insertDailyPricesBatch } from '@/lib/storage/historyRepo';
import { addSystemLog } from '@/lib/storage/logRepo';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code') || '110020';

    try {
        console.log(`[ManualSync] Fetching ${code}...`);
        const history = await fetchFundHistory(code, 20);
        if (history && history.length > 0) {
            const records = history.map(h => ({
                code,
                type: 'fund',
                price: h.value,
                date: h.date
            }));
            await insertDailyPricesBatch(records);
            await addSystemLog('INFO', 'ManualSync', `Manually synced ${history.length} points for ${code}`);
            return NextResponse.json({ success: true, count: history.length, latest: history[history.length - 1] });
        }
        return NextResponse.json({ success: false, message: 'No data fetched' });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
