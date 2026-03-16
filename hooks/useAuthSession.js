'use client';

import { useState, useEffect } from 'react';

export function useAuthSession() {
    const [userId, setUserId] = useState('');
    const [isLogged, setIsLogged] = useState(false);

    const [loginInput, setLoginInput] = useState('');
    const [passwordInput, setPasswordInput] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);

    // SaaS 化改造: 服务端验证会话
    useEffect(() => {
        const checkSession = async () => {
            try {
                const res = await fetch('/api/auth/me');
                if (res.ok) {
                    const data = await res.json();
                    if (data?.userId) {
                        setUserId(data.userId);
                        setIsLogged(true);
                    }
                }
            } catch (e) {
                console.error('[SessionCheck] Failed:', e);
            }
        };
        checkSession();
    }, []);

    const handleLogin = async () => {
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: loginInput.trim(), password: passwordInput }),
            });
            const data = await res.json();
            if (res.ok) {
                setUserId(data.userId);
                setIsLogged(true);
                return { ok: true };
            }
            return { ok: false, error: data.error };
        } catch (e) {
            return { ok: false, error: 'Network error during login' };
        }
    };

    const handleRegister = async () => {
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: loginInput.trim(), password: passwordInput }),
            });
            const data = await res.json();
            if (res.ok) {
                setUserId(data.userId);
                setIsLogged(true);
                return { ok: true };
            }
            return { ok: false, error: data.error };
        } catch (e) {
            return { ok: false, error: 'Network error during registration' };
        }
    };

    const handleLogout = async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } finally {
            // 无条件清理前端状态或强刷页面
            setUserId('');
            setIsLogged(false);
            window.location.reload();
        }
    };

    return {
        userId,
        isLogged,
        loginInput,
        setLoginInput,
        passwordInput,
        setPasswordInput,
        isRegistering,
        setIsRegistering,
        handleLogin,
        handleRegister,
        handleLogout,
    };
}
