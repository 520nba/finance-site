/**
 * lib/proxy/normalizer.js
 * 
 * 代理响应归约处理
 */

/**
 * 读取响应体并进行归一化处理
 * 
 * @param {Response} response 原始 fetch 响应
 * @param {boolean} isGbk 是否需要执行 GBK 解码
 * @returns {{ text: string, json: any | null, contentType: string }}
 */
export async function normalizeProxyResponse(response, isGbk) {
    let text;

    if (isGbk) {
        // 关键修复：处理腾讯财经等 GBK 编码数据
        const buffer = await response.arrayBuffer();
        text = new TextDecoder('gbk').decode(buffer);
    } else {
        text = await response.text();
    }

    // BOM (Byte Order Mark) 清理
    const cleanText = text.replace(/^\uFEFF/, '').trim();

    // 内容类型嗅探
    const contentType = response.headers.get('content-type') || 'text/plain';

    // JSON 特征探测
    const looksLikeJson =
        contentType.includes('application/json') ||
        (cleanText.startsWith('{') && cleanText.endsWith('}')) ||
        (cleanText.startsWith('[') && cleanText.endsWith(']'));

    if (looksLikeJson) {
        try {
            const json = JSON.parse(cleanText);
            return { text: cleanText, json, contentType };
        } catch (e) {
            // JSON 解析失败，fallthrough 到返回清洗后的文本
            // 修复 Bug：即使解析失败，也应返回 cleanText 而非原始 text
        }
    }

    return { text: cleanText, json: null, contentType };
}
