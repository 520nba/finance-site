/**
 * lib/api/serverError.js
 *
 * 统一的 500 响应。此前有 13 个路由直接把 `error: e.message` 返回给客户端，
 * 会把 D1/SQL 的原始报错（表名、约束、语句片段）泄露到浏览器。
 * 现在：细节只进服务端日志（Workers Logs），客户端只拿到通用文案 + 稳定 code。
 */

import { NextResponse } from 'next/server';

/**
 * @param {string} scope 形如 'api/quotes/bulk'，用于日志定位
 * @param {unknown} e 捕获到的异常
 * @param {object} extra 额外的非敏感字段（如 { success:false }）
 */
export function serverError(scope, e, extra = {}) {
    const detail = e?.stack || e?.message || String(e);
    console.error(`[${scope}] unhandled error:`, detail);
    return NextResponse.json(
        { success: false, error: 'internal_error', ...extra },
        { status: 500 }
    );
}
