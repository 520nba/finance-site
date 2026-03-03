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
                return JSON.parse(cached);
            } catch (e) {
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
            if (result) {
                setData(result);
                localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(result));
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
