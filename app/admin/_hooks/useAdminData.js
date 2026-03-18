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
    const [assetStatus, setAssetStatus] = useState([]);
    const [assetStatusLoading, setAssetStatusLoading] = useState(false);
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
        const k = secretKey || sessionStorage.getItem('tracker_admin_secret');
        if (!k) return;

        setQueueLoading(true);
        try {
            const res = await fetch('/api/admin/queue', {
                headers: { 'x-admin-key': k },
            });
            if (res.ok) {
                const data = await res.json();
                setQueueData(data?.queue || []);
            } else {
                const error = await res.json().catch(() => ({}));
                showToast(error.error || `队列获取失败 (${res.status})`);
            }
        } catch (e) {
            console.error('Failed to fetch queue:', e);
            showToast('同步队列无法访问');
        } finally {
            setQueueLoading(false);
        }
    }, [secretKey, showToast]);

    const fetchAssetStatus = useCallback(async () => {
        // 增加兜底检测：优先使用 state 里的 key，其次回退到 session 存储
        const k = secretKey || sessionStorage.getItem('tracker_admin_secret');
        if (!k) {
            console.warn('[AdminData] Missing secretKey for fetchAssetStatus');
            showToast('操作被拦截：未检出管理权限密钥');
            return;
        }

        setAssetStatusLoading(true);
        try {
            const res = await fetch('/api/admin/assets/status', {
                headers: { 'x-admin-key': k },
            });
            if (res.ok) {
                const data = await res.json();
                setAssetStatus(data?.assets || []);
                showToast('资产同步状态提取成功', 'success');
            } else {
                const error = await res.json().catch(() => ({}));
                showToast(error.error || `鉴权失败 (${res.status})`);
            }
        } catch (e) {
            console.error('Failed to fetch asset status:', e);
            showToast('网络链路异常，请检查后端运行状态');
        } finally {
            setAssetStatusLoading(false);
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
            message: `!! 协议强制覆盖 !!\n\n系统将针对 ${typeZh} 执行特定刷新逻辑：\n${type === 'fund' ? '• 基金：先拉取 250 天数据，确认成功后清空旧记录并重写 (流式进度)' : '• 股票：沿用旧版强制重写逻辑'}\n\n执行指令？`,
            onConfirm: async () => {
                setConfirmAction(null);
                setLoading(true);
                try {
                    const headers = { 'x-admin-key': secretKey };
                    if (type === 'fund') {
                        // ── 基金：调用异步队列接口 ──────────────────────
                        const res = await fetch(`/api/admin/refetch-fund-history?force=1`, { headers });
                        const data = await res.json();

                        if (res.ok && data.ok) {
                            showToast(`[任务提交] ${data.message}。由于每分钟限流处理 5 只，请稍后刷新页面查看。`, 'success', 8000);
                            await fetchAllData(secretKey, true);
                        } else {
                            throw new Error(data.error || '任务投递失败');
                        }
                    } else {
                        // ── 股票：改用 Header 传参，移除 URL 中的密钥 ──────────────
                        const url = `/api/cron/sync?task=history&force=1`;
                        const res = await fetch(url, { headers });
                        const data = await res.json();
                        if (res.ok && data.success) {
                            showToast(`[成功] 股票刷新任务已启动`, 'success');
                            await fetchAllData(secretKey, true);
                        } else {
                            showToast(data.error || '指令被拒绝');
                        }
                    }
                } catch (e) {
                    console.error('[Admin] ForceSync error:', e);
                    showToast(`API 链路中断: ${e.message}`);
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

    const triggerFullSync = useCallback(() => {
        setConfirmAction({
            message: `!! 生产者全量调度 !!\n\n系统将模拟 22:15 的 Cron 任务逻辑：\n• 扫描所有用户资产\n• 为每个资产生成一个同步 Job 并存入 D1 任务表\n\n该操作会瞬间增加任务负载，确认执行？`,
            onConfirm: async () => {
                setLoading(true);
                try {
                    const res = await fetch('/api/cron/sync?task=history', {
                        headers: { 'x-admin-key': secretKey },
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                        showToast(`模拟成功！已向队列投递 ${data.elapsed_ms ? '全量' : ''} 任务`, 'success');
                        await fetchAllData(secretKey, true);
                    } else {
                        showToast(data.error || '触发失败');
                    }
                } catch {
                    showToast('请求超时');
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
        triggerFullSync,
        assetStatus,
        assetStatusLoading,
        fetchAssetStatus,
    };
}
