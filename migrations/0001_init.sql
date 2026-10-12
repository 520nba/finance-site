-- Migration: 0001_init.sql
--
-- 基线 schema（由历史 0001~0006 链压缩而来）。
--
-- 背景：线上 schema 实际是按 schema.sql 手工建/改的，d1_migrations 只记录了最早两条，
-- 导致 `wrangler d1 migrations apply` 从 0002_saas_auth 起就报 duplicate column 而永久失败，
-- 且全新库按旧 migration 链也建不出可用 schema（asset_names 主键、system_logs.timestamp 等都不一致）。
--
-- 本文件**逐字对应线上 sqlite_master 的现状**（已用 sqlite_master 核对），
-- 全部使用 IF NOT EXISTS，因此对既有库是幂等的、对全新库可直接建出同样的结构。
--
-- 有意不包含：
--   _cf_KV            —— KV 命名空间 STOCK_DATA 的底层表，由 Cloudflare 维护
--   d1_migrations     —— wrangler 自己管理
--   asset_intraday_points / sync_queue —— 已被全 JSON 模式取代的死表（代码零引用）
--
-- 环境：Cloudflare D1 (SQLite)

-- ── 用户与会话 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    last_login    DATETIME DEFAULT CURRENT_TIMESTAMP,
    password_hash TEXT
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token      TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
);

-- ── 资产元数据 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_assets (
    user_id  TEXT NOT NULL,
    code     TEXT NOT NULL,
    type     TEXT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, code, type),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS asset_names (
    code       TEXT NOT NULL,
    type       TEXT NOT NULL,
    name       TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(code, type)
);

-- ── 历史价格（每资产保留 250 个交易日）──────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_history (
    code        TEXT NOT NULL,
    type        TEXT NOT NULL,
    price       REAL NOT NULL,
    record_date TEXT NOT NULL,          -- YYYY-MM-DD
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(code, type, record_date)
);
CREATE INDEX IF NOT EXISTS idx_asset_lookup ON asset_history (code, type, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_history_date ON asset_history(record_date);
CREATE INDEX IF NOT EXISTS idx_asset_history_created_at ON asset_history (created_at);

-- ── 分时（一天一资产一行 JSON）──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_intraday (
    code        TEXT NOT NULL,
    record_date TEXT NOT NULL,
    data        TEXT NOT NULL,          -- JSON: { code, points:[{time,value}], price, prevClose, source, date }
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(code, record_date)
);

-- ── 报价缓存 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_quotes (
    code          TEXT PRIMARY KEY,
    name          TEXT,
    price         REAL,
    change        REAL,
    changePercent REAL,
    prevClose     REAL,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 异步任务队列 ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL,          -- intraday_sync / asset_history_sync / fund_history
    code        TEXT NOT NULL,
    payload     TEXT,
    status      TEXT DEFAULT 'pending', -- pending / processing / completed / failed
    retry_count INTEGER DEFAULT 0,
    error_msg   TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_code ON sync_jobs(code);
-- 单资产单类型只能有一个待处理任务（配合 ON CONFLICT(code, type) WHERE status='pending' 去重）
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_jobs_upsert ON sync_jobs(code, type) WHERE status = 'pending';

-- ── 监控与统计 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_health (
    api_name       TEXT PRIMARY KEY,
    status         TEXT DEFAULT 'unknown',   -- healthy / wary / slow / critical / down
    success_rate   TEXT DEFAULT '0/0',
    avg_latency    INTEGER DEFAULT 0,
    success_count  INTEGER DEFAULT 0,
    fail_count     INTEGER DEFAULT 0,
    total_count    INTEGER DEFAULT 0,
    recent_results TEXT DEFAULT '',
    last_check     DATETIME DEFAULT CURRENT_TIMESTAMP,
    heartbeat_ts   DATETIME DEFAULT CURRENT_TIMESTAMP,
    error_msg      TEXT
);

CREATE TABLE IF NOT EXISTS system_logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    level     TEXT NOT NULL,            -- INFO / WARN / ERROR
    module    TEXT,
    message   TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON system_logs(timestamp);

-- 计数器（把 O(N) 的 COUNT(*) 降为 O(1) 点查）
CREATE TABLE IF NOT EXISTS system_stats (
    key        TEXT PRIMARY KEY,
    value      INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
