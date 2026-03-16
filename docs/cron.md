# Cron & Scheduled Tasks Documentation

本文档记录了 Stock Tracker 离线同步任务的调度逻辑。

## 1. 触发周期 (Schedules)

所有任务依 `wrangler.toml` 中的 `triggers` 条目运行。

| 时间 (北京) | 频率 | 任务模块 | 业务目标 |
| :--- | :--- | :--- | :--- |
| **09:00 - 15:55** | 每 5 分钟 | `realtimeSync` | **盘中预热**：采集 A 股实时分时点，存入 `asset_intraday_points` |
| **21:00** | 每日 | `historySync` | **股票收盘同步**：获取全量股票今日 K 线，更新历史库 |
| **03:00** | 每日 | `historySync` | **基金净值同步**：获取基金当日更新的净值数据 |
| **全天候** | 每 15 分钟 | `sentinel` | **探针监控**：巡检 Sina/Tencent/EastMoney 接口可用性 |

## 2. 关键逻辑说明

### 时区处理 (Timezone)
- 项目严格使用 **Asia/Shanghai** 时区进行市场开闭市判断。
- 代码中优先采用 `toLocaleString("en-US", { timeZone: "Asia/Shanghai" })` 获取稳健时间，避免手动偏置导致的 DST 或闰秒误差。

### 增量与截断 (Pruning)
- `historySync` 在插入新数据后，会自动执行 `DELETE` 逻辑，确保每只资产在 D1 中仅保留 **250 个交易日** 的记录，控制存储成本。
- `realtimeSync` 采集的点位在收盘后由 `pruneIntradayPoints` 统一清理，确保数据库不产生冗余碎片。

### 并发控制 (Chunking)
- 大批量任务执行时，采用 `chunkArray` 分片处理（通常为 50-100 个一组）。
- 每次 D1 操作前均会检查 `env` 对象，确保 `getRequiredDb` 能在 Cron 上下文下正确检索到 D1 绑定。
