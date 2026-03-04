import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const url = 'https://fund.eastmoney.com/003321.html';
        const res = await fetch(url);
        const html = await res.text();
        const textToMatch = html.substring(0, 5000); // only search first 5k chars
        const titleMatch = textToMatch.match(/<title>([^<(]+)/);
        return NextResponse.json({ ok: true, name: titleMatch ? titleMatch[1].trim() : 'NOT_FOUND' });
    } catch (e) {
        return NextResponse.json({ ok: false, error: e.message });
    }
}
