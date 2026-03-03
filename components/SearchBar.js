'use client';

import { useState } from 'react';
import { Search, Plus, ListPlus, ChevronUp, Loader2 } from 'lucide-react';

const CODE_REGEX = /^([a-zA-Z]{2})?\d{6}$/i;

// 解析批量输入：逗号/空格/换行/顿号 分隔，过滤无效代码，去重
function parseCodes(raw) {
    const tokens = raw.split(/[\s,，、]+/).map(s => s.trim()).filter(Boolean);
    const valid = [...new Set(tokens.filter(t => CODE_REGEX.test(t)))];
    const invalid = tokens.filter(t => !CODE_REGEX.test(t));
    return { valid, invalid };
}

export default function SearchBar({ onAdd }) {
    const [query, setQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    // 批量面板状态
    const [showBatch, setShowBatch] = useState(false);
    const [batchInput, setBatchInput] = useState('');
    const [batchProgress, setBatchProgress] = useState(null); // null | { done, total, msg }

    // ─── 单个添加 ───────────────────────────────────────
    const handleSearch = async (e) => {
        e.preventDefault();
        const code = query.trim();
        if (!code) return;

        if (!CODE_REGEX.test(code)) {
            setError('请输入正确的代码（如 SH600028、SZ000001 或基金代码 110011）');
            return;
        }

        setError('');
        setIsLoading(true);
        await onAdd(code);
        setQuery('');
        setIsLoading(false);
    };

    // ─── 批量添加 ───────────────────────────────────────
    const handleBatch = async () => {
        const { valid, invalid } = parseCodes(batchInput);
        if (valid.length === 0) {
            setBatchProgress({ done: 0, total: 0, msg: '未检测到有效的代码', isError: true });
            return;
        }

        setBatchProgress({ done: 0, total: valid.length, msg: '' });

        let success = 0;
        for (let i = 0; i < valid.length; i++) {
            setBatchProgress({ done: i, total: valid.length, msg: `正在添加 ${valid[i]}…` });
            await onAdd(valid[i]);
            success++;
        }

        const skippedMsg = invalid.length > 0 ? `，${invalid.length} 个无效代码已跳过` : '';
        setBatchProgress({
            done: valid.length,
            total: valid.length,
            msg: `✓ 全部完成，共 ${success} 个${skippedMsg}`,
            isDone: true,
        });
        setBatchInput('');
        setTimeout(() => {
            setBatchProgress(null);
            setShowBatch(false);
        }, 2500);
    };

    return (
        <div className="w-full space-y-2">
            {/* 单个添加 */}
            <form onSubmit={handleSearch} className="relative">
                <div className="flex gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40" size={20} />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); setError(''); }}
                            placeholder="输入代码 (如 SZ000001、SH600028、110011)"
                            className={`w-full glass-effect bg-white/5 pl-12 pr-4 py-3 outline-none transition-all
                                ${error ? 'border-red-500/60 focus:border-red-500' : 'border-white/10 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50'}`}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="glass-effect bg-blue-600/20 border-blue-500/30 px-6 py-3 hover:bg-blue-600/40 transition-all flex items-center gap-2 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? <Loader2 size={18} className="animate-spin" /> : <><Plus size={20} /> 添加</>}
                    </button>
                    {/* 批量切换按钮 */}
                    <button
                        type="button"
                        onClick={() => { setShowBatch(v => !v); setBatchProgress(null); }}
                        title="批量添加"
                        className={`glass-effect px-4 py-3 transition-all flex items-center gap-1.5 font-bold text-sm
                            ${showBatch
                                ? 'bg-cyan-600/30 border-cyan-500/50 text-cyan-300'
                                : 'bg-white/5 border-white/10 opacity-60 hover:opacity-100'}`}
                    >
                        {showBatch ? <ChevronUp size={18} /> : <ListPlus size={18} />}
                        批量
                    </button>
                </div>
                {error && <p className="mt-2 ml-1 text-xs text-red-400">{error}</p>}
            </form>

            {/* 批量面板（折叠） */}
            {showBatch && (
                <div className="glass-effect border-white/10 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <p className="text-xs text-white/40 font-mono">
                        粘贴多个代码，支持 <span className="text-white/60">逗号 / 空格 / 换行</span> 分隔
                    </p>
                    <textarea
                        rows={3}
                        value={batchInput}
                        onChange={(e) => { setBatchInput(e.target.value); setBatchProgress(null); }}
                        placeholder={"SH600036, SZ000001\\n012831 024423\\n110011"}
                        disabled={batchProgress && !batchProgress.isDone}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none resize-none font-mono text-sm focus:border-cyan-500/50 transition-all disabled:opacity-40"
                    />

                    {/* 进度 / 结果 */}
                    {batchProgress && (
                        <div className={`flex items-center gap-2 text-sm font-mono px-1
                            ${batchProgress.isError ? 'text-red-400' : batchProgress.isDone ? 'text-green-400' : 'text-cyan-300'}`}>
                            {!batchProgress.isDone && !batchProgress.isError && (
                                <Loader2 size={14} className="animate-spin flex-shrink-0" />
                            )}
                            <span>{batchProgress.msg}</span>
                            {batchProgress.total > 0 && !batchProgress.isDone && !batchProgress.isError && (
                                <span className="ml-auto opacity-60">{batchProgress.done}/{batchProgress.total}</span>
                            )}
                        </div>
                    )}

                    <div className="flex gap-3 justify-end">
                        <button
                            type="button"
                            onClick={() => { setShowBatch(false); setBatchProgress(null); setBatchInput(''); }}
                            className="text-xs opacity-40 hover:opacity-80 transition-all px-3 py-1.5 rounded-lg"
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            onClick={handleBatch}
                            disabled={!batchInput.trim() || (batchProgress && !batchProgress.isDone)}
                            className="glass-effect bg-cyan-600/20 border-cyan-500/30 px-5 py-2 text-sm font-bold hover:bg-cyan-600/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            <ListPlus size={16} />
                            开始添加
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
