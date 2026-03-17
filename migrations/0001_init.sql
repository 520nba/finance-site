-- Migration: 0001_init.sql
-- Created at: 2026-03-16
-- Description: Initial database schema for Stock Tracker

-- 1. 用户与权限
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    admin_id TEXT DEFAULT 'admin',
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 资产元数据
CREATE TABLE IF NOT EXISTS asset_names (
    code TEXT PRIMARY KEY,
    type TEXT NOT NULL, -- stock, fund
    name TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. 用户自选列表
CREATE TABLE IF NOT EXISTS user_assets (
    user_id TEXT NOT NULL,
    code TEXT NOT NULL,
    type TEXT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, code, type),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. 历史价格数据 (250日)
CREATE TABLE IF NOT EXISTS asset_history (
    code TEXT NOT NULL,
    type TEXT NOT NULL,
    price REAL NOT NULL,
    record_date TEXT NOT NULL, -- YYYY-MM-DD
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (code, type, record_date)
);
CREATE INDEX IF NOT EXISTS idx_history_date ON asset_history(record_date);

-- 5. 分时走势 (当日/昨日完整包)
CREATE TABLE IF NOT EXISTS asset_intraday (
    code TEXT NOT NULL,
    record_date TEXT NOT NULL,
    data TEXT NOT NULL, -- JSON 格式的 [{t, p, v}, ...]
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (code, record_date)
);

-- 6. 分时物理点位 (Cron 盘中增量采集)
CREATE TABLE IF NOT EXISTS asset_intraday_points (
    code TEXT NOT NULL,
    time INTEGER NOT NULL, -- HHMM
    price REAL NOT NULL,
    vol REAL DEFAULT 0,
    PRIMARY KEY (code, time)
);

-- 7. 报价快照 (缓存加速)
CREATE TABLE IF NOT EXISTS asset_quotes (
    code TEXT PRIMARY KEY,
    name TEXT,
    price REAL,
    change REAL,
    changePercent REAL,
    prevClose REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. 系统统计
CREATE TABLE IF NOT EXISTS system_stats (
    key TEXT PRIMARY KEY,
    value INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. 接口健康度
CREATE TABLE IF NOT EXISTS api_health (
    source TEXT PRIMARY KEY,
    status TEXT NOT NULL, -- healthy, wary, slow, critical, down
    latency INTEGER,
    error_msg TEXT,
    checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 10. 系统日志
CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL, -- INFO, WARN, ERROR
    module TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. 异步同步任务
CREATE TABLE IF NOT EXISTS sync_jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL,
    code        TEXT NOT NULL,
    payload     TEXT,
    status      TEXT DEFAULT 'pending',
    retry_count INTEGER DEFAULT 0,
    error_msg   TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status, created_at);
