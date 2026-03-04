import { useState, useEffect } from 'react';

export function useAuthSession() {
    const [userId, setUserId] = useState('');
    const [loginInput, setLoginInput] = useState('');
    const [isLogged, setIsLogged] = useState(false);

    // 自动恢复登录状态
    useEffect(() => {
        const savedId = localStorage.getItem('tracker_user_id');
        if (savedId) {
            setTimeout(() => {
                setUserId(savedId);
                setIsLogged(true);
            }, 0);
        }
    }, []);

    const handleLogin = () => {
        const id = loginInput.trim();
        if (id) {
            setUserId(id);
            setIsLogged(true);
            localStorage.setItem('tracker_user_id', id);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('tracker_user_id');
        window.location.reload(); // 强制刷新以彻底清理所有状态
    };

    return { userId, isLogged, loginInput, setLoginInput, handleLogin, handleLogout };
}
