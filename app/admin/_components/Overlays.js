'use client';

import { motion, AnimatePresence } from 'framer-motion';

// ── Toast ─────────────────────────────────────────────────────────────────

export function Toast({ toast, onClose }) {
    return (
        <AnimatePresence>
            {toast && (
                <motion.div
                    initial={{ opacity: 0, y: -20, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.9 }}
                    className={`fixed top-8 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-6 py-4 rounded-2xl
                        shadow-[0_20px_50px_rgba(0,0,0,0.5)] font-mono text-sm border backdrop-blur-2xl
                        whitespace-pre-wrap max-w-lg
                        ${toast.type === 'error'
                            ? 'bg-red-500/20 text-red-400 border-red-500/20'
                            : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/20'}`}
                >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 animate-pulse
                        ${toast.type === 'error'
                            ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                            : 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]'}`}
                    />
                    <span className="leading-relaxed">{toast.msg}</span>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

// ── ConfirmModal ──────────────────────────────────────────────────────────

export function ConfirmModal({ confirmAction, onCancel }) {
    return (
        <AnimatePresence>
            {confirmAction && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/80 backdrop-blur-md"
                        onClick={onCancel}
                    />
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        className="relative bg-black/90 border border-white/10 p-10 rounded-[3rem]
                            max-w-md w-full shadow-[0_0_100px_rgba(0,0,0,1)] overflow-hidden"
                    >
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 to-amber-500" />
                        <h3 className="text-xl font-black italic uppercase mb-6 tracking-tighter">指令授权确认</h3>
                        <p className="text-white/40 text-sm mb-10 whitespace-pre-wrap leading-relaxed font-medium uppercase tracking-wider">
                            {confirmAction.message}
                        </p>
                        <div className="flex gap-4">
                            <button
                                onClick={onCancel}
                                className="flex-1 px-6 py-4 rounded-2xl bg-white/5 hover:bg-white/10
                                    font-bold text-[10px] uppercase tracking-widest transition-all"
                            >
                                返回
                            </button>
                            <button
                                onClick={confirmAction.onConfirm}
                                className="flex-1 px-6 py-4 rounded-2xl bg-red-600 hover:bg-red-500
                                    font-black uppercase tracking-[0.2em] text-[10px]
                                    shadow-xl shadow-red-600/10 transition-all text-white"
                            >
                                确认执行
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
