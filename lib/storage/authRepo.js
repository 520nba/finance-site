import { queryOne, getRequiredDb } from './d1Client';
import { memoryCache } from './memoryCache';
import { hashPassword, verifyPassword, generateToken } from '@/lib/auth';

// ── 常量 ─────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000   // 7 天
const SESSION_TTL_S = 7 * 24 * 3600           // cookie maxAge 单位秒
const SESS_CACHE_TTL = 5 * 60 * 1000           // L1 缓存 5 分钟

// timing-safe 验证时使用的占位哈希，v2 格式以保证 _parseStoredHash 和迭代次数匹配
const DUMMY_HASH = 'pbkdf2:100000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';

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
 * Timing-safe 密码验证 + 透明哈希升级。
 * 当旧格式 (v1, 10000迭代) 哈希验证通过后，自动在同一 batch 中升级为 v2 格式。
 * @returns {{ userId: string, token: string } | null}
 */
export async function loginUser(username, password) {
    const user = await findUserById(username);

    // 无论 user 是否存在都跑一次 verifyPassword，耗时一致 (防时序探测)
    const result = user
        ? await verifyPassword(password, user.password_hash)
        : (await verifyPassword(password, DUMMY_HASH), { valid: false, needsUpgrade: false });

    if (!result.valid) return null;

    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    const db = await getRequiredDb();
    const stmts = [
        db.prepare('INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
            .bind(token, user.id, expiresAt),
    ];

    // 透明升级：旧格式哈希在验证通过后自动重哈希为新格式
    if (result.needsUpgrade) {
        const newHash = await hashPassword(password);
        stmts.push(
            db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
                .bind(newHash, user.id)
        );
        console.log(`[Auth] Transparent hash upgrade for user: ${user.id}`);
    }

    await db.batch(stmts);

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
