/**
 * 波动率与表现曲线计算逻辑
 */

/**
 * 计算相对表现曲线 (Performance Curve)
 * 将初始价格基准设为 100，观察后续走势
 * @param {Array} history 历史数据 [{value: 10, ...}, ...]
 * @param {number} days 周期天数
 */
export function calculatePerformance(history, days) {
    if (!history || history.length === 0) return [];

    // 截取最近 N+1 天的数据，以第 0 点作为起算的基准
    const data = history.slice(-(days + 1));
    if (data.length === 0) return [];

    const baseValue = data[0].value;

    // 防御：baseValue 为 0 时（停牌、数据缺失）无法计算涨跌幅，返回空数组
    // 避免产生 Infinity 或 NaN 传入 ECharts 导致图表崩溃
    if (!baseValue || baseValue <= 0) return [];

    return data.map(item => ({
        date: item.date,
        // (当前价 / 基准价 - 1) * 100 = 收益率
        performance: ((item.value / baseValue) - 1) * 100,
        originalValue: item.value
    }));
}

/**
 * 计算波动率 (Standard Deviation of returns) - 可选增强功能
 */
export function calculateVolatility(history, days) {
    const perf = calculatePerformance(history, days);
    if (perf.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < perf.length; i++) {
        const prev = perf[i - 1].originalValue;
        const curr = perf[i].originalValue;
        if (prev <= 0 || curr <= 0) continue; // 健壮性：屏蔽休市除零与黑天鹅负值
        returns.push(Math.log(curr / prev));
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;

    // 年化波动率 (假设每年 250 个交易日)
    return Math.sqrt(variance) * Math.sqrt(250) * 100;
}
/**
 * 计算多周期表现统计 (Performance Stats)
 * @param {Array} history 历史数据
 */
export function calculateStats(history) {
    if (!history || history.length < 2)
        return { perf5d: 0, perf22d: 0, perf250d: 0 }

    const getPerf = (days) => {
        const data = history.slice(-(days + 1))
        if (data.length < 2 || !data[0].value || data[0].value === 0) return 0
        const perf = ((data[data.length - 1].value / data[0].value) - 1) * 100
        if (isNaN(perf) || !isFinite(perf)) return 0
        return Number(perf.toFixed(2))
    }

    return {
        perf5d: getPerf(5),
        perf22d: getPerf(22),
        perf250d: getPerf(250)
    }
}

/**
 * 切分数组 (Chunk Array)
 */
export function chunkArray(arr, size) {
    const result = [];
    for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
    }
    return result;
}

/**
 * ── 健壮性增强工具 ──────────────────────────────────────────────────
 */

/**
 * 获取标准北京时间 Date 对象
 * 屏蔽由于部署环境（如 Cloudflare Edge）时区不一致导致的计算偏差
 */
export function getBeijingDate() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
}

/**
 * 获取北京时间当前的日期字符串 (YYYY-MM-DD)
 */
export function getBeijingTodayStr() {
    const bjNow = getBeijingDate();
    const y = bjNow.getFullYear();
    const m = String(bjNow.getMonth() + 1).padStart(2, '0');
    const d = String(bjNow.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 将时间戳转换为指定时区的日期字符串 (YYYY-MM-DD)
 * @param {number|Date} date 时间戳或对象
 * @param {string} timeZone 时区名称
 */
export function formatDateInTimezone(date, timeZone = "Asia/Shanghai") {
    const d = typeof date === 'number' ? new Date(date) : date;
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return formatter.format(d);
}

/**
 * 带有指数退避 + Jitter 的通用 fetch 重试逻辑
 * @param {string} url 目标 URL
 * @param {Object} options fetch 选项
 * @param {number} retry 重试次数
 * @param {AbortSignal} signal 外部取消信号
 */
export async function fetchWithRetry(url, options = {}, retry = 2, signal = null) {
    const timeoutMs = options.timeout ?? 10000;

    for (let i = 0; i <= retry; i++) {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const signals = [controller.signal];
            if (signal) signals.push(signal);

            const res = await fetch(url, {
                ...options,
                signal: AbortSignal.any(signals)
            });

            if (res.ok) return res;

            // 429 Too Many Requests | 503 Service Unavailable | 504 Gateway Timeout -> 触发重试
            if ([429, 503, 504].includes(res.status) && i < retry) {
                const backoff = Math.min(1000 * Math.pow(2, i) + Math.random() * 1000, 10000);
                console.warn(`[FetchRetry] Status ${res.status} for ${url}, retrying in ${Math.round(backoff)}ms...`);
                await new Promise(r => setTimeout(r, backoff));
                continue;
            }

            return res; // 其他非 ok 状态（如 404, 401）不重试，直接返回
        } catch (e) {
            const isAbort = e.name === 'AbortError' || (signal?.aborted);
            if (isAbort && !controller.signal.aborted) throw e; // 外部 Abort 直接抛出

            if (i < retry) {
                const backoff = Math.min(1000 * Math.pow(2, i) + Math.random() * 1000, 10000);
                console.warn(`[FetchRetry] Attempt ${i + 1} failed for ${url}: ${e.message}, retrying in ${Math.round(backoff)}ms...`);
                await new Promise(r => setTimeout(r, backoff));
                continue;
            }
            throw e;
        } finally {
            clearTimeout(t);
        }
    }
}

/**
 * 判断当前是否已过 A 股收盘时间 (北京时间 15:30 以后)
 */
export function isMarketClosedBeijing() {
    const bjNow = getBeijingDate();
    const hour = bjNow.getHours();
    const minute = bjNow.getMinutes();
    // 15:30 以后视为收盘
    return (hour > 15) || (hour === 15 && minute >= 30);
}
