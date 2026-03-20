/**
 * lib/auth.js
 * 
 * 基于 WebCrypto 的安全认证逻辑 (Cloudflare Workers 原生支持)
 * 
 * Hash 格式演进：
 *   v1 (旧): pbkdf2:{saltHex}:{hashHex}                    → 10,000 迭代
 *   v2 (新): pbkdf2:{iterations}:{saltHex}:{hashHex}        → 迭代次数嵌入
 * 
 * verifyPassword 自动检测格式并选择对应迭代次数，实现向后兼容。
 */

const CURRENT_ITERATIONS = 100000;
const LEGACY_ITERATIONS = 10000;

/**
 * 从 PBKDF2 参数生成派生密钥
 */
async function _deriveKey(password, salt, iterations) {
    const keyMaterial = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(password),
        'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        keyMaterial, 256
    );
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 生成密码哈希 (v2 格式，嵌入迭代次数)
 */
export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hashHex = await _deriveKey(password, salt, CURRENT_ITERATIONS);
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    return `pbkdf2:${CURRENT_ITERATIONS}:${saltHex}:${hashHex}`;
}

/**
 * 解析存储的哈希字符串，自动识别 v1/v2 格式
 * @returns {{ iterations: number, saltHex: string, hashHex: string, isLegacy: boolean } | null}
 */
function _parseStoredHash(stored) {
    if (!stored) return null;
    const parts = stored.split(':');

    // v2 格式: pbkdf2:{iterations}:{saltHex}:{hashHex}  (4段)
    if (parts.length === 4 && parts[0] === 'pbkdf2') {
        const iterations = parseInt(parts[1], 10);
        if (isNaN(iterations) || iterations <= 0) return null;
        return { iterations, saltHex: parts[2], hashHex: parts[3], isLegacy: false };
    }

    // v1 格式: pbkdf2:{saltHex}:{hashHex}  (3段)
    if (parts.length === 3 && parts[0] === 'pbkdf2') {
        return { iterations: LEGACY_ITERATIONS, saltHex: parts[1], hashHex: parts[2], isLegacy: true };
    }

    return null;
}

/**
 * 验证密码 (兼容 v1 和 v2 格式)
 * @returns {Promise<{ valid: boolean, needsUpgrade: boolean }>}
 */
export async function verifyPassword(password, stored) {
    const parsed = _parseStoredHash(stored);
    if (!parsed) return { valid: false, needsUpgrade: false };

    const { iterations, saltHex, hashHex, isLegacy } = parsed;
    const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    const candidate = await _deriveKey(password, salt, iterations);

    // 常量时间比较防止时序攻击 (Manual XOR loop for Workers)
    if (candidate.length !== hashHex.length) return { valid: false, needsUpgrade: false };
    let diff = 0;
    for (let i = 0; i < candidate.length; i++) {
        diff |= candidate.charCodeAt(i) ^ hashHex.charCodeAt(i);
    }

    const valid = diff === 0;
    // 旧格式验证通过时标记为需要升级
    return { valid, needsUpgrade: valid && isLegacy };
}

export function generateToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}
