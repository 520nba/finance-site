/**
 * lib/services/quoteSyncService.js
 * 
 * 职责：处理批量实时行情的同步逻辑。
 * 包括：多源抓取（腾讯 → 新浪）、内存缓存逻辑 及 D1 存储层的交互。
 *
 * 多源策略：腾讯批量接口（主源）→ 新浪（兜底源）。
 * 两个源都拿不到时返回 D1 里已有的缓存行情（降级，不报错）。
 */

import { getBulkQuotes, saveQuotes } from '@/lib/storage/quoteRepo';
import { parseTencentQuotes, parseSinaQuotes } from './marketParsers';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CHUNK_SIZE = 50; // 两个源都支持较长 URL，取保守值以保证稳定性

/**
 * 腾讯财经批量行情（主源，极速且支持大量代码单次请求）
 * 内部实现 GBK 解码与解析流程。
 */
async function fetchTencentBulkQuotes(stocks) {
    if (!stocks?.length) return {};
    const result = {};

    for (let i = 0; i < stocks.length; i += CHUNK_SIZE) {
        const chunk = stocks.slice(i, i + CHUNK_SIZE);
        const q_params = chunk.map(code => code.toLowerCase()).join(',');

        try {
            const url = `https://qt.gtimg.cn/q=${q_params}`;
            const res = await fetch(url, {
                headers: { Referer: 'https://gu.qq.com/', 'User-Agent': UA }
            });
            if (!res.ok) continue;

            // 核心逻辑：处理腾讯财经的 GBK 编码
            const text = new TextDecoder('gbk').decode(await res.arrayBuffer());
            Object.assign(result, parseTencentQuotes(text));
        } catch (e) {
            console.error(`[QuoteSync] Tencent Fetch failed for chunk:`, e.message);
        }
    }
    return result;
}

/**
 * 新浪财经批量行情（兜底源）
 * 注意：该接口强依赖 Referer，缺失会返回 403。
 */
async function fetchSinaBulkQuotes(stocks) {
    if (!stocks?.length) return {};
    const result = {};

    for (let i = 0; i < stocks.length; i += CHUNK_SIZE) {
        const chunk = stocks.slice(i, i + CHUNK_SIZE);
        const list = chunk.map(code => code.toLowerCase()).join(',');

        try {
            const url = `https://hq.sinajs.cn/list=${list}`;
            const res = await fetch(url, {
                headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': UA }
            });
            if (!res.ok) continue;

            const text = new TextDecoder('gbk').decode(await res.arrayBuffer());
            Object.assign(result, parseSinaQuotes(text));
        } catch (e) {
            console.error(`[QuoteSync] Sina Fetch failed for chunk:`, e.message);
        }
    }
    return result;
}

/**
 * 批量抓取行情：主源腾讯，逐代码补齐缺失项用新浪兜底。
 *
 * @returns {Promise<Object>} { code: {name, code, price, change, changePercent, prevClose} }
 */
async function fetchExternalBulkQuotes(stocks) {
    if (!stocks?.length) return {};

    const merged = await fetchTencentBulkQuotes(stocks);

    const missing = stocks.filter(c => !merged[String(c).toLowerCase()]);
    if (missing.length > 0) {
        const fb = await fetchSinaBulkQuotes(missing);
        const filled = Object.keys(fb).length;
        if (filled > 0) {
            Object.assign(merged, fb);
            console.warn(`[QuoteSync] Tencent missing ${missing.length}, Sina filled ${filled}`);
        } else {
            console.warn(`[QuoteSync] Tencent missing ${missing.length}, Sina returned nothing`);
        }
    }

    return merged;
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
        } else {
            // 所有源都拿不到：返回 D1 缓存（降级），并留下可观测痕迹
            console.warn(`[QuoteSync] All quote sources failed for ${toFetch.length} codes, serving D1 cache`);
        }
    }

    return dbResult;
}
