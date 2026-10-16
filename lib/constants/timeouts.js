/**
 * lib/constants/timeouts.js
 *
 * 全站超时与缓存 TTL 的集中定义。
 *
 * 背景：这些数字原先散落在 6+ 个文件里当魔法数字（6000 / 5000 / 10000 /
 * 30*1000 / 3600*1000 / 7 天 / 10s …），改一处要满仓库找。现在统一在这里，
 * 各模块只引用语义化名字。
 */

/** 网络请求超时（毫秒） */
export const TIMEOUT = {
    /** 东财 push2 分时/历史 */
    EASTMONEY_MS: 6000,
    /** 腾讯分时/行情 */
    TENCENT_MS: 6000,
    /** 巡检探针单次请求 */
    SENTINEL_MS: 5000,
    /** /api/proxy 转发 */
    PROXY_MS: 10000,
    /** 客户端 apiClient 默认超时 */
    CLIENT_MS: 15000,
    /** 队列里「重任务」等待上限（assetSyncService 的兜底 race） */
    QUEUE_HEAVY_MS: 25000,
};

/** 缓存 TTL（毫秒，括号内为秒的另存形式） */
export const TTL = {
    /** 分时快照缓存 */
    INTRADAY_CACHE_MS: 30 * 1000,
    /** 资产名称缓存 */
    NAME_CACHE_MS: 3600 * 1000,
    /** 用户会话有效期 */
    SESSION_MS: 7 * 24 * 3600 * 1000,
    /** 用户会话有效期（cookie maxAge 用秒） */
    SESSION_S: 7 * 24 * 3600,
    /** 会话的 L1 内存缓存 */
    SESSION_L1_MS: 5 * 60 * 1000,
    /** 管理端统计接口缓存 */
    ADMIN_STATS_MS: 10000,
};
