
-- 创建异步任务队列表，替代 KV 队列实现透明监控与原子锁定
CREATE TABLE IF NOT EXISTS sync_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,         -- 'fund_history', 'asset_init' 等
    code TEXT NOT NULL,         -- 资产代码
    payload TEXT,               -- JSON 负载 (如 { force: true })
    status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
    retry_count INTEGER DEFAULT 0,
    error_msg TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_code ON sync_jobs(code);
