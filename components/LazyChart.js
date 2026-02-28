'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * 延迟渲染容器
 * 只有当内容进入视口时，才渲染子组件
 */
export default function LazyChart({ children, height = 60, placeholder = null }) {
    const [isVisible, setIsVisible] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    observer.disconnect(); // 渲染后停止监听
                }
            },
            { rootMargin: '100px' } // 提前 100px 开始加载，优化体验
        );

        if (containerRef.current) {
            observer.observe(containerRef.current);
        }

        return () => observer.disconnect();
    }, []);

    return (
        <div ref={containerRef} style={{ minHeight: height }}>
            {isVisible ? children : (placeholder || <div style={{ height }} className="w-full bg-white/5 animate-pulse rounded-lg" />)}
        </div>
    );
}
