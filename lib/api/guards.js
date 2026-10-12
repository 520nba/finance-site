/**
 * lib/api/guards.js
 *
 * bulk 系列接口的统一守卫。
 *
 * 背景：`/api/quotes|names|intraday|history/bulk` 原先完全开放——匿名可调用，
 * 且 `items` 长度、`allowExternal` 都由请求体决定，等于把「防止未登录用户滥用
 * 外呼/配额」这道闸门（只在 /api/proxy 实现）旁路了。
 *
 * 前端所有调用点都在已登录态（useRealtimeQuotes/useAssetSync/AssetCard），
 * 且同源 fetch 默认携带 cookie，因此加鉴权不影响正常使用。
 */

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/requireUser';

export const MAX_BULK_ITEMS = 200;

/**
 * 校验：必须已登录 + items 为非空数组且不超过上限。
 * 注意：会消费 request body，调用方请使用返回的 body。
 *
 * @returns {{ok: true, userId: string, body: object, items: Array} | {ok: false, response: NextResponse}}
 */
export async function guardBulkRequest(request, { maxItems = MAX_BULK_ITEMS } = {}) {
    const userId = await requireUser(request);
    if (!userId) {
        return {
            ok: false,
            response: NextResponse.json(
                { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' },
                { status: 401 }
            )
        };
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return {
            ok: false,
            response: NextResponse.json(
                { success: false, error: 'Invalid JSON body', code: 'BAD_REQUEST' },
                { status: 400 }
            )
        };
    }

    const items = body?.items;
    if (!Array.isArray(items) || items.length === 0) {
        return {
            ok: false,
            response: NextResponse.json(
                { success: false, error: 'items must be a non-empty array', code: 'BAD_REQUEST' },
                { status: 400 }
            )
        };
    }

    if (items.length > maxItems) {
        return {
            ok: false,
            response: NextResponse.json(
                { success: false, error: `Too many items (max ${maxItems})`, code: 'TOO_MANY_ITEMS' },
                { status: 413 }
            )
        };
    }

    return { ok: true, userId, body, items };
}
