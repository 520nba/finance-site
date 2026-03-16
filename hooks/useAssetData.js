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
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [isValidating, setIsValidating] = useState(false);

    // Hydration fix: Load from cache after mount
    useEffect(() => {
        if (!key || typeof window === 'undefined') return;
        const cached = localStorage.getItem(CACHE_PREFIX + key);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (parsed !== null && parsed !== undefined) {
                    setData(parsed);
                }
            } catch (e) {
                if (typeof window !== 'undefined') {
                    localStorage.removeItem(CACHE_PREFIX + key);
                }
            }
        }
    }, [key]);

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
                if (typeof window !== 'undefined') {
                    try {
                        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(result));
                    } catch (storageErr) {
                        // localStorage 写入失败（如隐私模式或存储满）不影响内存状态
                        console.warn(`[SWR] localStorage write failed for ${key}:`, storageErr?.message);
                    }
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
