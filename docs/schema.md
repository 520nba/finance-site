# Database Schema Documentation

本文档描述了 Stock Tracker D1 数据库的表结构设计。

## 1. 用户与权限 (Auth)

### `users`
存储基本用户信息。
- `id`: `TEXT` (PK) - 用户唯一标识。
- `last_login`: `DATETIME` - 最近登录时间。
- `created_at`: `DATETIME` - 账户创建时间。

### `admin_sessions`
存储管理员会话令牌。
- `token`: `TEXT` (PK) - Session 令牌。
- `admin_id`: `TEXT` - 管理员标识。
- `expires_at`: `DATETIME` - 过期时间。

---

## 2. 资产管理 (Assets)

### `asset_names`
资产元数据缓存（名称库）。
- `code`: `TEXT` (PK) - 资产代码 (如 `sh600000`)。
- `type`: `TEXT` - 资产类型 (`stock`, `fund`)。
- `name`: `TEXT` - 中文名称。

### `user_assets`
用户自选列表挂载表。
- `user_id`: `TEXT` (PK) - 关联 `users.id`。
- `code`: `TEXT` (PK) - 资产代码。
- `type`: `TEXT` (PK) - 资产类型。
- `added_at`: `DATETIME` - 添加时间。

---

## 3. 价格数据 (Market Data)

### `asset_history`
日 K 线历史价格，默认保留最近 250 天。
- `code`: `TEXT` (PK) - 资产代码。
- `type`: `TEXT` (PK) - 类型。
- `record_date`: `TEXT` (PK) - 日期 (`YYYY-MM-DD`)。
- `price`: `REAL` - 收盘价/净值。

### `asset_intraday`
分时聚合包，存储完整的当日或昨日分时 JSON。
- `code`: `TEXT` (PK) - 资产代码。
- `record_date`: `TEXT` (PK) - 日期。
- `data`: `TEXT` - 压缩的 JSON 字符串。

### `asset_intraday_points`
盘中实时采集的分时点位，用于增量预热。
- `code`: `TEXT` (PK) - 资产代码。
- `time`: `INTEGER` (PK) - 时间 (`HHMM`)。
- `price`: `REAL` - 即时价。

---

## 4. 系统运维 (Ops)

### `system_stats`
O(1) 计数器表。
- `key`: `TEXT` (PK) - 统计项名 (如 `users`, `history_points`)。
- `value`: `INTEGER` - 计数值。

### `api_health`
外部财经接口监控表。
- `source`: `TEXT` (PK) - 探针名。
- `status`: `TEXT` - 健康状态。
- `latency`: `INTEGER` - 响应延迟 (ms)。
- `error_msg`: `TEXT` - 异常详情。

### `system_logs`
结构化系统日志。
- `id`: `INTEGER` (PK, AUTO)
- `level`: `TEXT` - 日志等级 (`INFO`, `WARN`, `ERROR`)。
- `module`: `TEXT` - 来源模块。
- `message`: `TEXT` - 日志正文。
