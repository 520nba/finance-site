-- Migration: 0003_fix_api_health.sql
-- Description: 修复 api_health 表结构不一致问题

-- 如果由于旧版定义导致 api_name 缺失或字段名冲突，我们通过创建新表并迁移数据的方式彻底修复
-- 这是最安全的方式，防止 ALTER TABLE 的限制

CREATE TABLE IF NOT EXISTS api_health_new (
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

-- 尝试迁移旧数据 (如果表存在且字段匹配)
INSERT OR IGNORE INTO api_health_new (api_name, status, last_check, error_msg)
SELECT api_name, status, last_check, error_msg FROM api_health;

-- 替换旧表
DROP TABLE IF EXISTS api_health;
ALTER TABLE api_health_new RENAME TO api_health;
