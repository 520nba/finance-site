-- 用户索引表
CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    password_hash TEXT,
    email       TEXT UNIQUE,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 会话表 (SaaS 认证)
CREATE TABLE IF NOT EXISTS user_sessions (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);

-- 用户资产关联表
CREATE TABLE IF NOT EXISTS user_assets (
    user_id TEXT NOT NULL,
    code TEXT NOT NULL,
    type TEXT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, code, type),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

-- 资产基本信息 (名称库)
CREATE TABLE IF NOT EXISTS asset_names (
    code TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(code, type)
);

-- 历史价格
CREATE TABLE IF NOT EXISTS asset_history (
    code TEXT NOT NULL,
    type TEXT NOT NULL,
    price REAL NOT NULL,
    record_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(code, type, record_date)
);

-- 分时数据 (按天存储的聚合 JSON)
CREATE TABLE IF NOT EXISTS asset_intraday (
    code TEXT NOT NULL,
    record_date TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(code, record_date)
);

-- 分时数据点 (颗粒度到分钟)
CREATE TABLE IF NOT EXISTS asset_intraday_points (
    code TEXT NOT NULL,
    time DATETIME NOT NULL,
    price REAL NOT NULL,
    vol REAL NOT NULL,
    PRIMARY KEY(code, time)
);
CREATE INDEX IF NOT EXISTS idx_intra_points_code_time ON asset_intraday_points(code, time DESC);

-- 报价缓存 (D1 历史缓存表)
CREATE TABLE IF NOT EXISTS asset_quotes (
    code TEXT PRIMARY KEY,
    name TEXT,
    price REAL,
    change REAL,
    changePercent REAL,
    prevClose REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 系统日志 (按计划禁用或存入 D1)
CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    module TEXT,
    message TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 管理员会话表
CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
);

-- 外部 API 健康监控
CREATE TABLE IF NOT EXISTS api_health (
    api_name TEXT PRIMARY KEY,
    status TEXT DEFAULT 'unknown',
    success_rate TEXT DEFAULT '0/0',
    avg_latency INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    recent_results TEXT DEFAULT '',
    last_check DATETIME DEFAULT CURRENT_TIMESTAMP,
    heartbeat_ts DATETIME DEFAULT CURRENT_TIMESTAMP,
    error_msg TEXT
);

-- 计数器表 (维度 3 优化: 将 O(N) 统计降为 O(1))
CREATE TABLE IF NOT EXISTS system_stats (
    key TEXT PRIMARY KEY,
    value INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON system_logs(timestamp);

-- [Optimization] 提升近期统计查询速度 (用于 recent_growth)
CREATE INDEX IF NOT EXISTS idx_asset_history_created_at ON asset_history (created_at);
