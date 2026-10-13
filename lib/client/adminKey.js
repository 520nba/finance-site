/**
 * lib/client/adminKey.js
 *
 * 管理员密钥的**唯一**存取入口（仅客户端）。
 *
 * 背景：此前密钥会经 URL query 传递（`/admin?key=...`），导致它出现在
 * Cloudflare Workers 日志、浏览器历史与 Referer 中。现在服务端只接受请求头，
 * 这里用 localStorage 作为「新标签页桥接」（sessionStorage 作用域是单标签页，
 * 新开的标签页读不到，所以才有人把密钥塞进 URL）。
 */

const ADMIN_KEY_STORAGE = 'tracker_admin_secret';

export function readAdminKey() {
    if (typeof window === 'undefined') return '';
    try {
        return sessionStorage.getItem(ADMIN_KEY_STORAGE)
            || localStorage.getItem(ADMIN_KEY_STORAGE)
            || '';
    } catch {
        return '';
    }
}

export function writeAdminKey(key) {
    if (typeof window === 'undefined' || !key) return;
    try {
        sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
        localStorage.setItem(ADMIN_KEY_STORAGE, key);
    } catch { /* ignore */ }
}

export function clearAdminKey() {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.removeItem(ADMIN_KEY_STORAGE);
        localStorage.removeItem(ADMIN_KEY_STORAGE);
    } catch { /* ignore */ }
}
