import { queryOne, getRequiredDb, getCloudflareCtx } from './d1Client';
import { memoryCache } from './memoryCache';
import { hashPassword, verifyPassword, generateToken } from '@/lib/auth';

// ── 常量 ─────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000   // 7 天
const SESSION_TTL_S = 7 * 24 * 3600           // cookie maxAge 单位秒
const SESS_CACHE_TTL = 5 * 60 * 1000           // L1 缓存 5 分钟

// timing-safe 验证时使用的占位哈希，格式与真实哈希完全一致
const DUMMY_HASH = 'pbkdf2:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';

/**
 * 常量时间比较（防 timing attack）
 */
function safeCompare(a, b) {
    if (!a || !b || a.length !== b.length) return false;

    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

/**
 * 校验管理员权限
 * @param {Request} request 
 * @param {Object} env Cloudflare environment
 */
export async function isAdminAuthorized(request, env = null) {
    const url = new URL(request.url);
    const searchParams = url.searchParams;

    /**
     * 1. Session Token 验证 (优先)
     */
    const sessionToken =
        request.headers.get('x-admin-session') ||
        searchParams.get('sess');

    if (sessionToken && sessionToken.length < 128) {
        try {
            const session = await queryOne(
                `SELECT 1
                 FROM admin_sessions
                 WHERE token = ?
                 AND expires_at > CURRENT_TIMESTAMP
                 LIMIT 1`,
                [sessionToken],
                env
            );

            if (session) {
                return true;
            }
        } catch (err) {
            console.error('[AdminAuth] session lookup failed', err);
        }
    }

    /**
     * 2. 后备方案：PSK 密钥
     */
    const adminKey = request.headers.get('x-admin-key');
    const queryKey =
        searchParams.get('token') ||
        searchParams.get('adminKey') ||
        searchParams.get('key') ||
        searchParams.get('secret');

    const inputKey = adminKey || queryKey;

    if (!inputKey) {
        return false;
    }

    /**
     * 3. 获取 Worker 环境变量
     */
    let envKey = env?.ADMIN_API_KEY || process.env.ADMIN_API_KEY;

    if (!envKey) {
        try {
            const ctx = await getCloudflareCtx(env);
            envKey = ctx?.env?.ADMIN_API_KEY;
        } catch (err) {
            console.error('[AdminAuth] env read failed', err);
        }
    }

    if (!envKey) {
        console.error('[AdminAuth] ADMIN_API_KEY not configured');
        return false;
    }

    /**
     * 4. 常量时间比较
     */
    return safeCompare(inputKey.trim(), envKey.trim());
}

// ── 用户查询 ──────────────────────────────────────────────────────────

/**
 * 按用户名查找用户（登录用）
 * @returns {{ id: string, password_hash: string } | null}
 */
export async function findUserById(userId) {
    return await queryOne(
        'SELECT id, password_hash FROM users WHERE id = ? LIMIT 1',
        [userId.toLowerCase()]
    );
}

/**
 * 检查用户名是否已被占用（注册用）
 */
export async function isUsernameTaken(userId) {
    const row = await queryOne(
        'SELECT 1 FROM users WHERE id = ? LIMIT 1',
        [userId.toLowerCase()]
    );
    return !!row;
}

// ── 注册 ──────────────────────────────────────────────────────────────

/**
 * 创建新用户并同时创建初始会话（原子操作）
 * @returns {{ userId: string, token: string }}
 */
export async function registerUser(username, password) {
    const userId = username.toLowerCase();
    const hash = await hashPassword(password);
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    const db = await getRequiredDb();
    await db.batch([
        db.prepare('INSERT INTO users (id, password_hash) VALUES (?, ?)')
            .bind(userId, hash),
        db.prepare('INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
            .bind(token, userId, expiresAt),
    ]);

    return { userId, token };
}

// ── 登录 ──────────────────────────────────────────────────────────────

/**
 * Timing-safe 密码验证。
 * @returns {{ userId: string, token: string } | null}
 */
export async function loginUser(username, password) {
    const user = await findUserById(username);

    // 无论 user 是否存在都跑一次 verifyPassword，耗时一致 (防时序探测)
    const isValid = user
        ? await verifyPassword(password, user.password_hash)
        : (await verifyPassword(password, DUMMY_HASH) && false);

    if (!isValid) return null;

    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    const db = await getRequiredDb();
    await db.prepare(
        'INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
    ).bind(token, user.id, expiresAt).run();

    // 预填 L1 缓存，提升后续业务请求性能
    memoryCache.set(`sess:${token}`, user.id, SESS_CACHE_TTL);

    return { userId: user.id, token };
}

// ── 登出 ──────────────────────────────────────────────────────────────

/**
 * 撤销会话：删除 D1 记录 + 清除 L1 缓存
 */
export async function revokeSession(token) {
    if (!token) return;
    try {
        const db = await getRequiredDb();
        await db.prepare('DELETE FROM user_sessions WHERE token = ?')
            .bind(token).run();
    } catch (e) {
        console.error('[AuthRepo:revokeSession] DB error:', e.message);
    }
    memoryCache.delete(`sess:${token}`);
}

// ── Cookie 配置（集中管理，route 直接引用） ───────────────────────────

export const SESSION_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_TTL_S,
    path: '/',
};
