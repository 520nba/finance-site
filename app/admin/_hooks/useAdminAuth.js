'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 管理员身份认证 hook
 * 职责：密钥管理、sessionStorage 持久化、登出
 */
export function useAdminAuth() {
    const [secretKey, setSecretKey] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const router = useRouter();

    const authenticate = useCallback((key) => {
        setSecretKey(key);
        sessionStorage.setItem('tracker_admin_secret', key);
        setIsAuthenticated(true);
    }, []);

    const restoreFromStorage = useCallback(() => {
        return sessionStorage.getItem('tracker_admin_secret') || '';
    }, []);

    const handleLogout = useCallback(() => {
        sessionStorage.removeItem('tracker_admin_secret');
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
