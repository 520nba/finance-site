-- 用户索引表
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    last_login DATETIME DEFAULT CURRENT_TIMESTAMP
);

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

-- 分时数据
CREATE TABLE IF NOT EXISTS asset_intraday (
    code TEXT NOT NULL,
    record_date TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(code, record_date)
);

-- 报价缓存 (仅作为 KV 的 D1 替代方案，TTL 逻辑需应用层处理)
CREATE TABLE IF NOT EXISTS asset_quotes (
    code TEXT PRIMARY KEY,
    name TEXT,
    price REAL,
    change REAL,
    changePercent REAL,
    prevClose REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 系统日志 (虽然用户要求禁用 KV 写入，但 D1 写入成本极低，若需要可保留，目前按计划禁用)
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

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON system_logs(timestamp);
