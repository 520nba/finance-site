'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const CACHE_PREFIX = 'tracker_cache_';

/**
 * 通用 SWR 数据获取 Hook
 * @param {string} key 缓存键 (如 history:stock:600519)
 * @param {Function} fetcher 获取数据的异步函数
 * @param {Object} options 选项 { refreshInterval: ms, enabled: boolean }
 */
export function useAssetData(key, fetcher, options = {}) {
    const { refreshInterval = 0, enabled = true } = options;
    const [data, setData] = useState(() => {
        if (typeof window === 'undefined') return null;
        const cached = localStorage.getItem(CACHE_PREFIX + key);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                // 防御：拒绝格式不合法的旧版本缓存（如字符串或 null）
                // 这类异常数据可能在账号切换或版本升级后残留
                if (parsed === null || parsed === undefined) return null;
                return parsed;
            } catch (e) {
                // JSON 解析失败时清理损坏的缓存
                localStorage.removeItem(CACHE_PREFIX + key);
                return null;
            }
        }
        return null;
    });
    const [error, setError] = useState(null);
    const [isValidating, setIsValidating] = useState(false);

    // 使用 ref 存储最新的 fetcher 以避免 effect 重复执行
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    const revalidate = useCallback(async () => {
        if (!key || !enabled) return;
        setIsValidating(true);
        try {
            const result = await fetcherRef.current();
            // 防御：只有结果非空且可序列化时才更新缓存和状态
            if (result !== null && result !== undefined) {
                setData(result);
                try {
                    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(result));
                } catch (storageErr) {
                    // localStorage 写入失败（如隐私模式或存储满）不影响内存状态
                    console.warn(`[SWR] localStorage write failed for ${key}:`, storageErr?.message);
                }
            }
            setError(null);
        } catch (err) {
            console.error(`[SWR] Fetch failed for ${key}:`, err);
            setError(err);
        } finally {
            setIsValidating(false);
        }
    }, [key, enabled]);

    useEffect(() => {
        if (enabled) {
            revalidate();
        }
    }, [revalidate, enabled]);

    useEffect(() => {
        if (enabled && refreshInterval > 0) {
            const timer = setInterval(revalidate, refreshInterval);
            return () => clearInterval(timer);
        }
    }, [revalidate, enabled, refreshInterval]);

    return {
        data,
        error,
        isValidating,
        mutate: revalidate
    };
}
