-- 0002_drop_dead_tables.sql
--
-- 删除两张已被取代、且代码里零引用的表（静态审计确认）：
--   asset_intraday_points —— 旧版「逐分钟点位」存储，已被 asset_intraday（整段 JSON）取代
--   sync_queue            —— 旧任务队列，已被 sync_jobs 取代
--
-- 背景：0001_init.sql 保留这两张表的 DDL，是为了与线上 sqlite_master 逐字对齐；
-- 线上它们仍在，但没有任何代码读写。这里用追加式迁移把它们真正删掉，
-- 这样「迁移历史」与「线上实际结构」保持一致（不会再出现两套 schema 互相矛盾的情况）。
--
-- 删除前已导出数据到工作区：
--   finance/d1-legacy-intraday-points-export/asset_intraday_points.json（1,213 行）
--   finance/d1-legacy-stock-export/（另一张已删的 legacy 库 stock 的完整备份）

DROP TABLE IF EXISTS asset_intraday_points;
DROP TABLE IF EXISTS sync_queue;
