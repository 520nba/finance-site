/**
 * lib/auth/requireAdmin.js
 *
 * 管理员鉴权守卫。此前 5 个路由各自抄了同一段（含 403 文案），
 * 抽取后不仅少 5 份重复，也降低「新加管理接口忘了鉴权」的风险。
 *
 * 用法：
 *   const denied = await requireAdmin(request);
 *   if (denied) return denied;
 */
import { NextResponse } from 'next/server';
import { isAdminAuthorized } from './adminAuth';

/**
 * @param {Request} request
 * @param {object|null} env 传入真实 Worker env（不传则回退到 context）
 * @returns {Promise<NextResponse|null>} 未授权时返回 403 响应，否则 null
 */
export async function requireAdmin(request, env = null) {
    if (await isAdminAuthorized(request, env)) return null;
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
}
