# Cron 与定时任务

本文件描述 Stock Tracker 在 Cloudflare Workers 上的定时调度。
**唯一权威实现是 `wrangler.toml` 的 `[triggers].crons` + `worker-entry.js` + `lib/cron/dispatch.js`**，本文档随代码同步维护。

---

## 1. 为什么只有 2 条 cron 表达式

免费版 Cloudflare **每个账户**只有 **5 个 Cron Trigger**（实测添加第 6 个会被拒）：

```
10072: This account has reached the Workers Free limit of 5 cron triggers per account.
```

而账户下还有其他 Worker 也需要名额。因此本 Worker 只用 **2 条**表达式，
把 4 类任务合并为「每分钟醒来一次、由代码按北京时间分发」：

```toml
crons = [
  "*/1 * * * *",    # 队列 + 各类投递
  "*/15 * * * *",   # 健康巡检（单独一趟，避免与队列争抢单次外呼额度）
]
```

> 触发器数量是硬限，但**调用次数**不是：`*/1` 每天 1,440 次，仅占免费额度
> 10 万请求/天的 1.4%。所以「合并触发器、内部分发」是免费版下最划算的做法。

---

## 2. 任务分发表（均为北京时间）

| 时间 | 频率 | 任务 | 说明 |
| :--- | :--- | :--- | :--- |
| 全天 | 每分钟 | `queue` → `processSyncJobs` | 认领并执行 `sync_jobs`（认领走 `status` 索引） |
| 工作日 09:00–15:59 | 每 5 分钟 | `realtime` → `runRealtimeSync` | 只**投递** `intraday_sync` 任务（不直接外呼）；非连续竞价时段会被函数自身的 `isTradingHour()` 跳过 |
| 工作日 22:15–22:29 | 5 分钟网格 | `history-full` → `runHistorySync` | 收盘后**全量**投递历史任务（股票 + 基金） |
| 周二至周六 03:00–03:14 | 5 分钟网格 | `history-missing` → `runHistorySync({ onlyMissing: true })` | **只补缺**：只投递「`MAX(record_date)` 落后于最近已收盘交易日」或完全没有历史的资产 |
| 每 15 分钟 | 96 次/天 | `sentinel` → `runSentinel` | 12 个外部源探针，写入 `api_health` |

### 为什么用「时间窗」而不是精确到某一分钟
`22:15–22:29` / `03:00–03:14` 是**窗口**，窗口内每 5 分钟判断一次：
- 万一某一分钟被跳过，当天仍会补上，不会整日漏跑；
- 投递是**幂等**的（`sync_jobs` 上有 `ON CONFLICT(code, type) WHERE status='pending'` 唯一索引），
  重复投递只会刷新同一条 pending 记录的 `updated_at`。

### 「只补缺」的判定
`lastClosedTradingDateStr()`（`lib/utils.js`）取「北京时间向前跳过周末的最近一天」，
不查节假日表 —— 遇到节假日最多多投递几个任务，而任务与写入都是幂等的。

实测依据（2026-10-09）：22:15 那趟写入 47 行历史，03:00 那趟只有 4 行 ——
说明凌晨全量重跑几乎是纯重复劳动。改成「只补缺」后每晚只投递真正落后的资产（通常 0~2 只）。

---

## 3. 单次调用的资源边界

| 限制（免费版） | 本项目的用法 |
| :--- | :--- |
| 子请求 50/次 | 队列那趟最多领 20 个 job（每个 1~3 次外呼）≈ 20–40；巡检单独一趟 12 次外呼 → **两趟不叠加** |
| CPU 10 ms/次 | 定时任务几乎全是 I/O 等待（等外呼、等 D1），不计入 CPU |
| 触发次数 | 2 条表达式，账户尚有 3 个空闲名额 |

---

## 4. 怎么验证它在正常工作

```sql
-- 各模块最近一次日志时间
SELECT module, MAX(timestamp) FROM system_logs GROUP BY module;

-- 盘中分时任务是否按 5 分钟节拍投递（近 20 分钟约 27 只 × 4 轮）
SELECT type, COUNT(*), MAX(created_at) FROM sync_jobs
WHERE created_at >= datetime('now','-20 minutes') GROUP BY type;

-- 巡检是否在刷新
SELECT api_name, last_check FROM api_health ORDER BY last_check DESC LIMIT 3;
```

调度逻辑有单元测试：`node --test tests/cronDispatch.test.mjs`
（覆盖四条时间线、窗口边界、周末与跳周末日期；已接入 `npm test`）。
**改动 `lib/cron/dispatch.js` 后务必先跑测试** —— 分发写错会同时影响四类任务。

---

## 5. 要加新任务怎么办

1. 在 `lib/cron/dispatch.js` 的 `pickTasks()` 里加判断（纯函数，便于测试）；
2. 在 `worker-entry.js` 的 `switch (task)` 里加执行分支；
3. 在 `tests/cronDispatch.test.mjs` 里补用例。

只有在「节拍与现有两条表达式都对不上」时才需要新增触发器 —— 免费版账户只剩 3 个名额。

---

## 6. 历史变更

| 时间 | 变更 |
| :--- | :--- |
| 2026-10 | 5 条触发器（`15 14 * * 2-6`、`0 19 * * 2-7`、`*/15`、`*/5 1-7 * * 2-6`、`*/1`）合并为 2 条；新增「03:00 只补缺」；`runHistorySync` 增加 `onlyMissing` 选项；`manifest` 里删掉了 `asset_intraday_points` 相关的旧描述 |
