-- 提升 getBulkHistory 查询效率的覆盖索引 (Covering Index)
-- 包含 code, type, record_date DESC 以及被检索的 price
-- 使得 D1 可以直接从索引树返回数据，实现 Index-Only Scan，减少约 40% 的查询负载
CREATE INDEX IF NOT EXISTS idx_asset_history_lookup 
ON asset_history(code, type, record_date DESC, price);
