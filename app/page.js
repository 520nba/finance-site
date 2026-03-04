'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, PieChart, RefreshCw, X, Eye, Activity } from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import AssetCard from '@/components/AssetCard';
import WatchlistSidebar from '@/components/WatchlistSidebar';
import LogsModal from '@/components/LogsModal';
import { fetchStockData, fetchStockHistory, fetchFundHistory, fetchFundInfo, fetchBulkHistory, fetchBulkStockData, fetchBulkNames, fetchIntradayData, fetchBulkIntradayData } from '@/lib/api';

// 简单 Toast 状态，避免 alert() 阻断 UI
function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg, type = 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);
  return { toast, show };
}

export default function Home() {
  const [activeTab, setActiveTab] = useState('stock');
  const [assets, setAssets] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [userId, setUserId] = useState('');
  const [loginInput, setLoginInput] = useState('');
  const [isLogged, setIsLogged] = useState(false);
  const [selectedCode, setSelectedCode] = useState(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [loadedUserId, setLoadedUserId] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const { toast, show: showToast } = useToast();

  // 自动恢复登录状态
  useEffect(() => {
    const savedId = localStorage.getItem('tracker_user_id');
    if (savedId) {
      setUserId(savedId);
      setIsLogged(true);
    }
  }, []);

  // 登录后加载服务端数据
  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      setIsSyncing(true);
      setIsSessionReady(false);
      try {
        const res = await fetch(`/api/user/assets?userId=${userId}`);
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0) {
          await refreshAssets(list);
        } else {
          setAssets([]);
        }
      } catch (e) {
        console.error('Failed to load user assets:', e);
      }
      setIsSessionReady(true);
      setLoadedUserId(userId);
      setIsSyncing(false);
    };
    load();
    localStorage.setItem('tracker_user_id', userId);
  }, [userId]);

  // 使用 code 拼接的字符串作为依赖，避免轮询引发价格变动导致持续的高频 KV 覆写
  const assetCodesStr = assets.map(a => `${a.type}:${a.code}`).sort().join(',');

  // 数据变化后同步到服务端（禁止初始化阶段覆盖）
  useEffect(() => {
    if (!isLogged || !userId || !isSessionReady || userId !== loadedUserId) return;
    const sync = async () => {
      const skeleton = assets.map(a => ({ code: a.code, type: a.type }));
      try {
        await fetch('/api/user/assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, assets: skeleton }),
        });
        // 广播事件通知同浏览器的其他 Tab 页面
        localStorage.setItem('tracker_assets_updated', Date.now().toString());
      } catch (e) {
        console.error('Sync failed:', e);
      }
    };
    sync();
  }, [assetCodesStr, userId, isLogged, isSessionReady, loadedUserId]);

  // 使用 useRef 透传最新的 assets 到闭包内容
  const assetsRef = useRef(assets);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  // 监听多标签页同步防冲突 (跨 Tab 数据漂移保护)
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'tracker_assets_updated' && isLogged && userId) {
        // 其他页面同步了新配置，读取远端执行无感对齐
        fetch(`/api/user/assets?userId=${userId}`).then(r => r.json()).then(list => {
          if (Array.isArray(list)) {
            const newStr = list.map(a => `${a.type}:${a.code}`).sort().join(',');
            const oldStr = assetsRef.current.map(a => `${a.type}:${a.code}`).sort().join(',');
            if (newStr !== oldStr) refreshAssets(list);
          }
        }).catch(() => { });
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLogged, userId]);

  // 实时数据自动轮询 (只轮询 Quotes 报价，历史/分时由组件内部按需分发)
  useEffect(() => {
    if (activeTab !== 'watchlist' || !isLogged || assets.length === 0) return;

    let isInitialTick = true;
    const tick = async () => {
      if (isSyncing) return;

      // 1. 每隔一分钟执行轮询时，检测云端用户的实际结构是否发生变更（针对跨设备数据防冲突保护）
      if (!isInitialTick) {
        try {
          const res = await fetch(`/api/user/assets?userId=${userId}`);
          const remoteList = await res.json();
          if (Array.isArray(remoteList)) {
            const newCodes = remoteList.map(a => `${a.type}:${a.code}`).sort().join(',');
            const oldCodes = assetsRef.current.map(a => `${a.type}:${a.code}`).sort().join(',');
            if (newCodes !== oldCodes) {
              refreshAssets(remoteList);
              return; // 直接交给重加载进程接管
            }
          }
        } catch (e) { /* ignore */ }
      }
      isInitialTick = false;

      // 2. 如果资产结构没变，继续原有的报价刷新流程
      // 从 ref 拿到最准的映射
      const stockItems = assetsRef.current.filter(a => a.type === 'stock');
      // 只更新轻量级的 Quotes
      const quoteMap = await fetchBulkStockData(stockItems);

      setAssets(prev => prev.map(a => {
        const q = quoteMap[a.code.toLowerCase()] || quoteMap[a.code];
        const newAsset = { ...a };
        if (q) {
          newAsset.price = q.price;
          newAsset.changePercent = q.changePercent;
        }
        return newAsset;
      }));
    };

    const timer = setInterval(tick, 60000);
    tick();
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isLogged, assets.length, isSyncing, userId]);

  const handleLogin = () => {
    const id = loginInput.trim();
    if (id) {
      setUserId(id);
      setIsLogged(true);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('tracker_user_id');
    window.location.reload(); // 强制刷新以彻底清理所有状态
  };

  const getAssetDetails = async (code, type) => {
    try {
      // 获取名称
      const nameMap = await fetchBulkNames([{ code, type }], true);
      const name = nameMap[`${type}:${code}`] ?? (type === 'fund' ? `基金 ${code}` : `股票 ${code}`);

      fetchBulkHistory([{ code, type }], true, 250).catch(() => { });

      if (type === 'stock') {
        const quoteMap = await fetchBulkStockData([{ code, type }], true);
        const q = quoteMap[code.toLowerCase()] || quoteMap[code];
        return { ...q, name: q?.name || name, code, type };
      }
      return { name, price: 0, code, type };
    } catch (e) {
      console.error(`Failed to fetch details for ${code} (${type}):`, e);
    }
    return null;
  };

  const addAsset = async (rawCode, typeHint) => {
    setIsSyncing(true);
    const code = rawCode.trim().toLowerCase();
    try {
      if (typeHint === 'stock' || activeTab === 'watchlist') {
        if (!/^[a-zA-Z]{2}\d{6}$/i.test(code)) {
          showToast('股票代码必须包含市场前缀 (如 sh600036、sz000001)');
          setIsSyncing(false);
          return;
        }
      } else if (typeHint === 'fund') {
        if (!/^\d{6}$/.test(code)) {
          showToast('基金代码必须为 6 位纯数字');
          setIsSyncing(false);
          return;
        }
      }

      const asset = await getAssetDetails(code, typeHint);

      if (asset) {
        setAssets(prev => {
          const list = Array.isArray(prev) ? prev : [];
          if (list.find(a => a.code === code)) return list;
          return [...list, asset];
        });
      } else {
        showToast('加载失败，该代码可能不存在或数据暂时不可用');
      }
    } catch (e) {
      console.error(`[Frontend] Error adding asset ${code}:`, e);
      showToast('添加资产时发生错误');
    }
    setIsSyncing(false);
  };

  const removeAsset = (code) => {
    setAssets(prev => prev.filter(a => a.code !== code));
    if (selectedCode === code) setSelectedCode(null);
  };



  const refreshAssets = async (list) => {
    if (!list || list.length === 0) return;
    setIsSyncing(true);

    // 1. 立刻渲染骨架，消除阻塞感。
    const skeletonAssets = list.map(({ code, type }) => ({
      name: `加载中...`, price: 0, code, type, history: [], summary: null, changePercent: 0
    }));
    setAssets(skeletonAssets);

    // 2. 仅获取基础名称与股票实时报价
    try {
      const stockItems = list.filter(a => a.type === 'stock');
      const [stockQuoteMap, nameMap] = await Promise.all([
        fetchBulkStockData(stockItems, true),
        fetchBulkNames(list.map(a => ({ code: a.code, type: a.type })), true),
      ]);

      const initialAssets = list.map(({ code, type }) => {
        const histKey = `${type}:${code}`;
        const name = nameMap[histKey];
        if (type === 'stock') {
          const q = stockQuoteMap[code.toLowerCase()] || stockQuoteMap[code];
          const resolvedName = q?.name || (name && name !== code ? name : `股票 ${code}`);
          return { ...q, name: resolvedName, code, type };
        } else {
          return { name: (name && name !== code ? name : `基金 ${code}`), price: 0, code, type };
        }
      });

      setAssets(initialAssets);
    } catch (e) {
      console.error('[Frontend] Refresh failed:', e);
    }

    setIsSyncing(false);
  };

  const filteredAssets = assets.filter(a => activeTab === 'watchlist' ? a.type === 'stock' : a.type === activeTab);

  const handleSelectAsset = async (code) => {
    if (activeTab === 'watchlist') return;
    setSelectedCode(code);
  };

  return (
    <main className="container mx-auto px-4 py-12 max-w-[1400px] min-h-screen">
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl text-sm font-bold
              ${toast.type === 'error' ? 'bg-red-500/90 text-white' : 'bg-green-500/90 text-white'}`}
          >
            {toast.msg}
            <button onClick={() => { }} className="opacity-60 hover:opacity-100"><X size={14} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col lg:flex-row items-center lg:items-start justify-between mb-8 lg:mb-12 gap-6 lg:gap-8">
        <div className="flex w-full lg:w-auto glass-effect p-1 bg-white/5 border-white/5 flex-shrink-0">
          <button
            onClick={() => setActiveTab('stock')}
            className={`flex-1 lg:px-8 py-2.5 rounded-lg transition-all flex items-center justify-center lg:justify-start gap-2 font-bold text-sm ${activeTab === 'stock' ? 'bg-blue-600 shadow-lg text-white' : 'hover:bg-white/5 opacity-50'}`}
          >
            <PieChart size={18} /> 股票
          </button>
          <button
            onClick={() => setActiveTab('fund')}
            className={`flex-1 lg:px-8 py-2.5 rounded-lg transition-all flex items-center justify-center lg:justify-start gap-2 font-bold text-sm ${activeTab === 'fund' ? 'bg-cyan-600 shadow-lg text-white' : 'hover:bg-white/5 opacity-50'}`}
          >
            <TrendingUp size={18} /> 基金
          </button>
          <button
            onClick={() => setActiveTab('watchlist')}
            className={`flex-1 lg:px-8 py-2.5 rounded-lg transition-all flex items-center justify-center lg:justify-start gap-2 font-bold text-sm ${activeTab === 'watchlist' ? 'bg-indigo-600 shadow-lg text-white' : 'hover:bg-white/5 opacity-50'}`}
          >
            <Activity size={18} /> 实时
          </button>
        </div>

        <div className="flex-1 w-full lg:max-w-xl">
          <SearchBar onAdd={(code) => addAsset(code, activeTab === 'watchlist' ? 'stock' : activeTab)} />
        </div>

        <div className="flex items-center justify-between w-full lg:w-auto gap-4 flex-shrink-0 pt-1">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-[10px] font-mono opacity-40 uppercase tracking-widest">{userId}</span>
            </div>
            <button
              onClick={handleLogout}
              className="text-[10px] font-bold opacity-20 hover:opacity-100 hover:text-red-400 uppercase tracking-widest transition-all"
            >
              退出
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLogs(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 opacity-40 hover:opacity-100 transition-all"
            >
              <Activity size={14} />
              <span className="text-xs font-bold uppercase tracking-widest hidden sm:inline">日志</span>
            </button>
            <button
              onClick={() => refreshAssets(assets.map(a => ({ code: a.code, type: a.type })))}
              disabled={isSyncing}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 opacity-40 hover:opacity-100 transition-all disabled:cursor-not-allowed ${isSyncing ? 'animate-pulse' : ''}`}
            >
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
              <span className="text-xs font-bold uppercase tracking-widest hidden sm:inline">同步数据</span>
            </button>
          </div>
        </div>
      </div>

      <LogsModal isOpen={showLogs} onClose={() => setShowLogs(false)} />

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">
        {isLogged && assets.length > 0 && (
          <WatchlistSidebar
            key={userId}
            assets={filteredAssets}
            mode={activeTab === 'watchlist' ? 'realtime' : 'volatility'}
            selectedCode={selectedCode}
            onSelect={handleSelectAsset}
          />
        )}

        <div className="flex-1 min-w-0 min-h-[400px]">
          <AnimatePresence mode="popLayout">
            {!isLogged ? (
              <motion.div
                key="login"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-md mx-auto py-24 text-center"
              >
                <h2 className="text-2xl font-black italic mb-2 tracking-tighter">账户登录</h2>
                <p className="text-white/30 text-sm mb-8">输入您的 ID 以保存和同步自选列表</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter User ID"
                    value={loginInput}
                    onChange={(e) => setLoginInput(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-blue-500/50 transition-all text-sm font-mono"
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  />
                  <button
                    onClick={handleLogin}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold text-sm transition-all"
                  >
                    进入
                  </button>
                </div>
              </motion.div>
            ) : (
              <>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  {filteredAssets.length > 0 ? (
                    filteredAssets.map(asset => (
                      <AssetCard
                        key={asset.code}
                        asset={asset}
                        onRemove={removeAsset}
                        mode={activeTab === 'watchlist' ? 'realtime' : 'volatility'}
                      />
                    ))
                  ) : (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="col-span-full text-center py-24 glass-effect border-dashed border-white/5"
                    >
                      <p className="text-white/20 italic tracking-widest">
                        暂无相关数据，输入代码开启追踪
                      </p>
                    </motion.div>
                  )}
                </div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      <footer className="mt-24 pt-12 border-t border-white/5 text-center text-white/20 text-sm">
        <p>&copy; 2026 Antigravity Financial Labs. Data provided by Tencent &amp; EastMoney.</p>
      </footer>
    </main>
  );
}
