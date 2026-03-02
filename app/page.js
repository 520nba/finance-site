'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, PieChart, RefreshCw, X, Eye, Activity } from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import AssetCard from '@/components/AssetCard';
import AdminPanel from '@/components/AdminPanel';
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
      } catch (e) {
        console.error('Sync failed:', e);
      }
    };
    sync();
  }, [assetCodesStr, userId, isLogged, isSessionReady, loadedUserId]);

  // 实时数据自动轮询 (60秒)
  useEffect(() => {
    if (activeTab !== 'watchlist' || !isLogged || assets.length === 0) return;

    const tick = async () => {
      if (isSyncing) return;
      const stockItems = assets.filter(a => a.type === 'stock');
      const quoteMap = await fetchBulkStockData(stockItems);
      const intradayMap = await fetchBulkIntradayData(assets.map(a => ({ code: a.code, type: a.type })));

      setAssets(prev => prev.map(a => {
        const q = quoteMap[a.code];
        const intra = intradayMap[a.code];
        const newAsset = { ...a };
        if (q) {
          newAsset.price = q.price;
          newAsset.changePercent = q.changePercent;
        }
        if (intra) {
          newAsset.intraday = intra;
          newAsset.price = intra.price;
          newAsset.changePercent = intra.changePercent;
        }
        return newAsset;
      }));
    };

    const timer = setInterval(tick, 60000);
    tick();
    return () => clearInterval(timer);
  }, [activeTab, isLogged, assets.length, isSyncing]);

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
      if (type === 'fund') {
        const [nameMap, historyRes] = await Promise.all([
          fetchBulkNames([{ code, type }]),
          fetchFundHistory(code, 250),
        ]);
        const name = nameMap[`${type}:${code}`] ?? `基金 ${code}`;
        const historyData = historyRes || { history: [], summary: { perf5d: 0, perf22d: 0, perf250d: 0 } };
        const history = historyData.history || [];
        const summary = historyData.summary;
        const price = history.length > 0 ? history[history.length - 1].value : 0;
        return { name, price, code, type, history, summary };
      } else {
        const [assetInfo, historyRes] = await Promise.all([
          fetchStockData(code),
          fetchStockHistory(code, 250),
        ]);
        const historyData = historyRes || { history: [], summary: { perf5d: 0, perf22d: 0, perf250d: 0 } };
        const history = historyData.history || [];
        const summary = historyData.summary;
        const nameMap = await fetchBulkNames([{ code, type }]);
        const name = assetInfo?.name || nameMap[`${type}:${code}`];
        if (name) {
          return { ...assetInfo, name, code, type, history, summary };
        }
      }
    } catch (e) {
      console.error(`Failed to fetch details for ${code} (${type}):`, e);
    }
    return null;
  };

  const addAsset = async (code, typeHint) => {
    setIsSyncing(true);
    try {
      // 优先根据 typeHint，否则先试 stock 再试 fund
      let asset = null;
      if (typeHint) {
        asset = await getAssetDetails(code, typeHint);
      } else {
        // 先假设为股票/ETF
        asset = await getAssetDetails(code, 'stock');
        // 如果股票没抓到有效的名称，尝试作为基金抓取
        if (!asset || !asset.name || asset.name === code) {
          const fundAsset = await getAssetDetails(code, 'fund');
          if (fundAsset && fundAsset.name && fundAsset.name !== code) {
            asset = fundAsset;
          }
        }
      }

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

    // 1. 获取基础名称与股票实时信息
    const stockItems = list.filter(a => a.type === 'stock');
    const [stockQuoteMap, nameMap] = await Promise.all([
      fetchBulkStockData(stockItems),
      fetchBulkNames(list.map(a => ({ code: a.code, type: a.type }))),
    ]);

    // 立刻渲染初始无历史的资产卡片 (UI 不会卡死)
    const initialAssets = list.map(({ code, type }) => {
      const histKey = `${type}:${code}`;
      const name = nameMap[histKey];
      if (type === 'stock') {
        const q = stockQuoteMap[code];
        const resolvedName = (q?.name || name) ?? code;
        return q ? { ...q, name: q.name || resolvedName, code, type, history: [], summary: null }
          : { name: resolvedName, price: 0, code, type, history: [], summary: null };
      } else {
        const resolvedName = name ?? `基金 ${code}`;
        return { name: resolvedName, price: 0, code, type, history: [], summary: null };
      }
    });

    setAssets(initialAssets);

    // 2. 分段获取历史数据，成功一组就更新一组，实现“流式”加载效果
    const HISTORY_CHUNK_SIZE = 12;
    const historyChunks = [];
    for (let i = 0; i < list.length; i += HISTORY_CHUNK_SIZE) {
      historyChunks.push(list.slice(i, i + HISTORY_CHUNK_SIZE));
    }

    for (const chunk of historyChunks) {
      try {
        const chunkMap = await fetchBulkHistory(chunk.map(a => ({ code: a.code, type: a.type })));
        setAssets(prev => prev.map(a => {
          const histKey = `${a.type}:${a.code}`;
          if (chunkMap[histKey]) {
            const histData = chunkMap[histKey];
            const price = a.type === 'fund' && histData.history && histData.history.length > 0
              ? histData.history[histData.history.length - 1].value
              : a.price;
            return { ...a, history: histData.history, summary: histData.summary, price };
          }
          return a;
        }));
        // === 核心优化：流式加载节奏控制 ===
        // 降低延迟，因为后端已经 D1 Batch 优化过，返回极快
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        console.error('[Frontend] History chunk load failed:', e);
      }
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
                {userId === 'admin' && (
                  <AdminPanel adminId={userId} onToast={showToast} />
                )}
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
