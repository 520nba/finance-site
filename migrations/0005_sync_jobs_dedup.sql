-- 为 sync_jobs 增加基于 pending 状态的分部分唯一索引 (Partial Unique Index)
-- 防止同一资产在待处理状态时被重复投递 (De-duplication)
-- 与 INSERT OR IGNORE 配合使用，实现任务系统的“幂等投递”
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_jobs_pending_unique 
ON sync_jobs(code, type) 
WHERE status = 'pending';
