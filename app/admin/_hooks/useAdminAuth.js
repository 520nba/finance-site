'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { readAdminKey, writeAdminKey, clearAdminKey } from '@/lib/client/adminKey';

/**
 * 管理员身份认证 hook
 * 职责：密钥管理、持久化（sessionStorage + localStorage 桥接新标签页）、登出
 *
 * 说明：不再支持从 URL `?key=` 取密钥——那会把全局 PSK 写进浏览器历史与
 * Cloudflare 日志。新标签页通过 localStorage 拿到密钥。
 */
export function useAdminAuth() {
    const [secretKey, setSecretKey] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const router = useRouter();

    const authenticate = useCallback((key) => {
        setSecretKey(key);
        writeAdminKey(key);
        setIsAuthenticated(true);
    }, []);

    const restoreFromStorage = useCallback(() => {
        return readAdminKey();
    }, []);

    const handleLogout = useCallback(() => {
        clearAdminKey();
        setIsAuthenticated(false);
        setSecretKey('');
    }, []);

    const handleAuthFailure = useCallback(() => {
        setIsAuthenticated(false);
    }, []);

    return {
        secretKey,
        setSecretKey,
        isAuthenticated,
        authenticate,
        restoreFromStorage,
        handleLogout,
        handleAuthFailure,
    };
}
