-- 统一同步任务索引名称为 idx_sync_jobs_upsert
-- 职责：清理线上可能存在的旧名称索引，并创建与 schema.sql 一致的最终索引。

-- 1. 尝试删除已知的旧版本索引名称（如果存在）
DROP INDEX IF EXISTS idx_sync_jobs_pending_unique;
DROP INDEX IF EXISTS idx_sync_jobs_code_type_pending;

-- 2. 创建标准化的部分唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_jobs_upsert 
ON sync_jobs(code, type) 
WHERE status = 'pending';
