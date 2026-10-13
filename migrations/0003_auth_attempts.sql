-- 0003_auth_attempts.sql
--
-- 登录/注册防爆破。此前 /api/auth/login 可以无限次尝试密码（全仓库无任何限流），
-- 而账户里就是本人账号，弱口令可被持续爆破。
--
-- 时间一律用 **epoch 毫秒整数** 存，避免本项目曾踩过的
-- 「ISO 字符串与 SQLite datetime('now') 按字符串比较」的坑。
--
--   key               'ip:<cf-connecting-ip>' 或 'user:<小写用户名>'
--   count             窗口内连续失败次数
--   first_at_ms       本窗口首次失败时间
--   locked_until_ms   锁定到期时间（null 表示未锁定）
--   updated_at_ms     最近一次失败时间（供清理）

CREATE TABLE IF NOT EXISTS auth_attempts (
    key             TEXT PRIMARY KEY,
    count           INTEGER NOT NULL DEFAULT 0,
    first_at_ms     INTEGER NOT NULL,
    locked_until_ms INTEGER,
    updated_at_ms   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_updated ON auth_attempts(updated_at_ms);
