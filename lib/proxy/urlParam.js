/**
 * lib/proxy/urlParam.js
 *
 * 代理接口的「URL 传参」编解码。
 *
 * 背景（实测踩坑）：
 *   应用运行时会对查询参数**多解码一层** —— 客户端发 `?url=https%3A%2F%2F…%3Fb%3D1%26c%3D2`
 *   时，路由里的 `searchParams.get('url')` 只能拿到 `https://…?b=1`，
 *   第一个 `&` 之后的内容被当成新的查询参数吃掉了。
 *   于是任何含多个查询参数的 URL 都无法通过 `?url=` 传递（东财 API 会因此回 rc:102）。
 *
 * 解法：用 base64url 传参（`?url64=`）。base64url 只含 A-Za-z0-9-_，
 * 不含 `%`、`&`、`=`、`+`、`/`，无论被解码几层都不会被截断。
 */

/** 字符串 → base64url（去掉 padding，+ → -，/ → _） */
export function encodeUrlParam(value) {
    if (typeof value !== 'string') return '';
    const bytes = new TextEncoder().encode(value);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → 字符串（UTF-8 安全；非法输入返回空串） */
export function decodeUrlParam(value) {
    if (typeof value !== 'string' || value.length === 0) return '';
    try {
        const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
        const bin = atob(b64 + pad);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    } catch {
        return '';
    }
}
