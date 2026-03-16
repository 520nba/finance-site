'use client';

import { useState, useCallback } from 'react';

const EMPTY_STATS = {
    users: 0,
    stocks: 0,
    funds: 0,
    history_points: 0,
    intraday_points: 0,
    quotes_count: 0,
    recent_growth: 0,
    queue_count: 0,
    api_health: [],
};

/**
 * 管理员数据 hook
 * 职责：所有后端请求、数据状态管理、危险操作触发
 *
 * @param {string} secretKey   — 当前鉴权密钥
 * @param {Function} showToast — (msg, type?) => void
 * @param {Function} onAuthFailure — 鉴权失败时的回调
 */
export function useAdminData(secretKey, showToast, onAuthFailure) {
    const [users, setUsers] = useState([]);
    const [stats, setStats] = useState(EMPTY_STATS);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [queueData, setQueueData] = useState([]);
    const [queueLoading, setQueueLoading] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);

    // ── 基础请求 ──────────────────────────────────────────────────────────

    const fetchAllData = useCallback(async (keyToUse, forceSyncStats = false) => {
        const k = keyToUse || secretKey;
        if (!k) return;
        setLoading(true);

        try {
            const statsUrl = forceSyncStats ? '/api/admin/stats?sync=true' : '/api/admin/stats';
            const headers = { 'x-admin-key': k };

            const [usersRes, statsRes, logsRes] = await Promise.all([
                fetch('/api/user/list', { headers }),
                fetch(statsUrl, { headers }),
                fetch('/api/admin/logs?hours=72', { headers }),
            ]);

            if (statsRes.ok) {
                const data = await statsRes.json();
                setStats(prev => ({ ...prev, ...data }));
            }
            if (usersRes.ok) {
                setUsers(await usersRes.json());
            }
            if (logsRes.ok) {
                const data = await logsRes.json();
                setLogs(data.logs?.slice(0, 500) || []);
            }

            if (!statsRes.ok && !usersRes.ok) {
                showToast('鉴权失败: 密钥无效或无权限');
                onAuthFailure?.();
            }
        } catch (e) {
            console.error('[Admin] Fetch failed:', e);
            showToast('无法连接服务器');
        } finally {
            setLoading(false);
        }
    }, [secretKey, showToast, onAuthFailure]);

    const fetchQueue = useCallback(async () => {
        if (!secretKey) return;
        setQueueLoading(true);
        try {
            const res = await fetch('/api/admin/queue', {
                headers: { 'x-admin-key': secretKey },
            });
            if (res.ok) {
                const data = await res.json();
                setQueueData(data?.queue || []);
            }
        } catch (e) {
            console.error('Failed to fetch queue:', e);
            showToast('获取队列失败');
        } finally {
            setQueueLoading(false);
        }
    }, [secretKey, showToast]);

    // ── 危险操作（统一走 confirmAction 二次确认弹窗）─────────────────────

    const deleteUser = useCallback((targetUserId) => {
        setConfirmAction({
            message: `!! 危险警报 !!\n\n你即将对用户 "${targetUserId}" 及其相关的资产记录进行物理抹除。\n\n此操作不可逆。确认执行？`,
            onConfirm: async () => {
                setLoading(true);
                try {
                    const res = await fetch('/api/user/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-admin-key': secretKey },
                        body: JSON.stringify({ targetUserId }),
                    });
                    const data = await res.json();
                    if (res.ok) {
                        showToast(`主体 [${targetUserId}] 已被终止`, 'success');
                        fetchAllData(secretKey);
                    } else {
                        showToast(data.error || '抹除失败');
                    }
                } catch {
                    showToast('通信错误');
                } finally {
                    setLoading(false);
                    setConfirmAction(null);
                }
            },
        });
    }, [secretKey, fetchAllData, showToast]);

    const triggerForceSync = useCallback((type) => {
        const typeZh = type === 'fund' ? '基金' : '股票';
        setConfirmAction({
            message: `!! 协议强制覆盖 !!\n\n系统将调用同步内核全量重新抓取所有 ${typeZh} 的历史 K 线，并使用最新的“时区修复逻辑”覆盖数据库记录。\n\n执行指令？`,
            onConfirm: async () => {
                setLoading(true);
                try {
                    // 全量历史重刷使用 task=history&force=1
                    const url = `/api/cron/sync?task=history&force=1&secret=${secretKey}`;
                    const res = await fetch(url);
                    const data = await res.json();
                    if (res.ok && data.success) {
                        showToast(`[成功] 全量刷新任务已启动\n日期偏移已修正`, 'success');
                        await fetchAllData(secretKey, true);
                    } else {
                        showToast(data.error || '指令被拒绝');
                    }
                } catch {
                    showToast('API 链路中断');
                } finally {
                    setLoading(false);
                    setConfirmAction(null);
                }
            },
        });
    }, [secretKey, fetchAllData, showToast]);

    const triggerCleanup = useCallback(() => {
        setConfirmAction({
            message: `!! 环境全量洗消 !!\n\n系统将扫描并清理 D1 数据库中所有失效的无主行情数据，以优化背板性能。\n\n继续执行？`,
            onConfirm: async () => {
                setLoading(true);
                try {
                    const res = await fetch('/api/admin/cleanup', {
                        method: 'POST',
                        headers: { 'x-admin-key': secretKey },
                    });
                    const data = await res.json();
                    if (res.ok) {
                        showToast(`区域清理完成！\n历史: -${data.deleted_hist}, 名称: -${data.deleted_names}`, 'success');
                        fetchAllData(secretKey);
                    } else {
                        showToast(data.error || '洗消任务失败');
                    }
                } catch {
                    showToast('链路请求超时');
                } finally {
                    setLoading(false);
                    setConfirmAction(null);
                }
            },
        });
    }, [secretKey, fetchAllData, showToast]);

    return {
        users,
        stats,
        logs,
        loading,
        queueData,
        queueLoading,
        confirmAction,
        setConfirmAction,
        fetchAllData,
        fetchQueue,
        deleteUser,
        triggerForceSync,
        triggerCleanup,
    };
}
