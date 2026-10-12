'use client';

/**
 * components/AddAssetModal.js
 *
 * 添加资产弹窗。
 *
 * 背景：原先搜索框（输入 + 添加 + 批量）常驻在主页顶栏，占掉了整行空间，
 * 手机上尤其挤。现在改成顶栏只留一个「添加资产」按钮，表单收进弹窗。
 *
 * 弹窗内部直接复用 SearchBar，因此单条添加与批量粘贴两种方式都保留。
 */

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PlusCircle } from 'lucide-react';
import SearchBar from '@/components/SearchBar';

export default function AddAssetModal({ isOpen, onClose, onAdd, tabLabel = '股票' }) {
    const bodyRef = useRef(null);

    // Esc 关闭 + 打开后自动聚焦输入框
    useEffect(() => {
        if (!isOpen) return;

        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);

        const timer = setTimeout(() => {
            bodyRef.current?.querySelector('input')?.focus();
        }, 80);

        return () => {
            window.removeEventListener('keydown', onKey);
            clearTimeout(timer);
        };
    }, [isOpen, onClose]);

    return (
        <AnimatePresence>
            {isOpen && (
                <div
                    className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-4 sm:p-6"
                    role="dialog"
                    aria-modal="true"
                    aria-label="添加资产"
                >
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                    />

                    <motion.div
                        initial={{ scale: 0.96, opacity: 0, y: 16 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.96, opacity: 0, y: 16 }}
                        className="relative w-full max-w-lg mt-20 sm:mt-0 bg-[#0c0c0e] border border-white/10 rounded-3xl shadow-2xl p-6 sm:p-8"
                    >
                        <div className="flex items-start justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-400">
                                    <PlusCircle size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-black italic tracking-tighter uppercase">添加资产</h2>
                                    <p className="text-[10px] text-white/45 uppercase tracking-widest font-bold">
                                        当前分类：{tabLabel}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                title="关闭"
                                aria-label="关闭"
                                className="p-2 hover:bg-white/5 rounded-full transition-all opacity-50 hover:opacity-100"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div ref={bodyRef}>
                            <SearchBar onAdd={onAdd} stacked />
                        </div>

                        <p className="mt-6 text-[11px] text-white/40 leading-relaxed">
                            股票需带市场前缀（如 <span className="text-white/60 font-mono">SH600036</span>），
                            基金为 6 位数字；也可以点「批量」一次粘贴多个代码。
                        </p>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
