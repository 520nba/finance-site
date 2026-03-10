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

    const getPerf = (h, days) => {
        const data = h.slice(-(days + 1))
        if (data.length < 2 || !data[0].value) return 0
        const first = data[0].value
        const last = data[data.length - 1].value
        const perf = ((last / first - 1) * 100).toFixed(2)
        return Number(perf)
    }

    return {
        perf5d: getPerf(history, 5),
        perf22d: getPerf(history, 22),
        perf250d: getPerf(history, 250)
    }
}

/**
 * 将数组切分为固定大小的块 (通用分批工具)
 * @param {Array} arr 
 * @param {number} size 
 */
export function chunkArray(arr, size) {
    const result = [];
    for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
    }
    return result;
}
