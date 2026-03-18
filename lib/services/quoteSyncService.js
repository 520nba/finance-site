/**
 * lib/services/quoteSyncService.js
 * 
 * 职责：处理批量实时行情的同步逻辑。
 * 包括：腾讯 API 抓取、内存缓存逻辑 及 D1 存储层的交互。
 */

import { getBulkQuotes, saveQuotes } from '@/lib/storage/quoteRepo';

/**
 * 🚀 使用腾讯财经 API 批量获取行情 (极速且支持大量代码单次请求)
 * 内部实现 GBK 解码与解析流程。
 */
export async function fetchExternalBulkQuotes(stocks) {
    if (!stocks?.length) return {};
    const result = {};
    const CHUNK_SIZE = 50; // 腾讯 API 支持极长 URL，此处取保守值以保证稳定性

    for (let i = 0; i < stocks.length; i += CHUNK_SIZE) {
        const chunk = stocks.slice(i, i + CHUNK_SIZE);
        const q_params = chunk.map(code => code.toLowerCase()).join(',');

        try {
            const url = `https://qt.gtimg.cn/q=${q_params}`;
            const res = await fetch(url, { headers: { 'Referer': 'https://gu.qq.com/' } });
            if (!res.ok) continue;

            // 核心逻辑：处理腾讯财经的 GBK 编码
            const arrayBuffer = await res.arrayBuffer();
            const text = new TextDecoder('gbk').decode(arrayBuffer);
            const lines = text.split(';').filter(l => l.trim());

            for (const line of lines) {
                const match = line.match(/v_([^=]+)="([^"]+)"/);
                if (!match) continue;
                const data = match[2].split('~');

                // 涨跌幅字段在 data[32] 附近，需确保字段充足以防越界
                if (data.length < 33) continue;

                const code = match[1].toLowerCase();
                const price = parseFloat(data[3]) || 0;
                const prevClose = parseFloat(data[4]) || 0;

                result[code] = {
                    name: data[1] || code,
                    code: code,
                    price,
                    change: parseFloat(data[31]) || 0,
                    changePercent: parseFloat(data[32]) || 0,
                    prevClose
                };
            }
        } catch (e) {
            console.error(`[QuoteSync] Tencent Fetch failed for chunk:`, e.message);
        }
    }
    return result;
}

/**
 * 统筹实时行情同步逻辑
 * 会优先返回 D1 中的数据，如果过期则从外部 API 抓取并更新。
 * 
 * @param {Array<string|Object>} items 资产列表 (code 或 {code} 对象)
 * @param {boolean} allowExternal 是否允许穿透访问外部接口 (默认 false 以节省流量)
 * @returns {Promise<Object>} 处理后的行情 Map { code: data }
 */
export async function syncQuotesBulk(items, allowExternal = false) {
    if (!Array.isArray(items) || items.length === 0) return {};

    const codes = items.map(it => typeof it === 'string' ? it : it.code);

    // 1. 从 D1/内存 获取当前缓存
    const dbResult = await getBulkQuotes(codes);

    // 2. 判定外部抓取逻辑
    if (!allowExternal) {
        return dbResult;
    }

    const now = Date.now();
    const toFetch = codes.filter(code => {
        const cached = dbResult[code];
        if (!cached) return true;

        // 判定过期时间：1 分钟
        const updatedAt = cached.updated_at ? new Date(cached.updated_at).getTime() : 0;
        return now - updatedAt > 60000;
    });

    // 3. 执行外部同步
    if (toFetch.length > 0) {
        const externalData = await fetchExternalBulkQuotes(toFetch);
        if (Object.keys(externalData).length > 0) {
            const timeStr = new Date().toISOString();
            const dataToSave = {};

            for (const [k, v] of Object.entries(externalData)) {
                const entry = { ...v, updated_at: timeStr };
                dataToSave[k] = entry;
                dbResult[k] = entry; // 写入返回 map
            }

            // 异步持久化到存储层
            await saveQuotes(dataToSave);
            console.log(`[QuoteSync] Success sync ${Object.keys(externalData).length} codes.`);
        }
    }

    return dbResult;
}
