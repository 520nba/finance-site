-- Migration: 0002_saas_auth.sql
-- Description: 为 SaaS 架构升级用户认证与会话管理

-- 扩展用户表
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN email TEXT UNIQUE;

-- 创建会话表
CREATE TABLE IF NOT EXISTS user_sessions (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

-- 创建会话索引
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
