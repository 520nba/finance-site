'use client';

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

export default function IntradayChart({ data, prevClose, height = 300 }) {
    const option = useMemo(() => {
        if (!data || data.length === 0) return {};

        const prices = data.map(d => d.value);
        const minPrice = Math.min(...prices, prevClose * 0.995);
        const maxPrice = Math.max(...prices, prevClose * 1.005);

        // 计算与昨收价的最大偏差，使 Y 轴对称
        const limit = Math.max(Math.abs(maxPrice - prevClose), Math.abs(prevClose - minPrice));
        const yMin = prevClose - limit;
        const yMax = prevClose + limit;

        return {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(10, 14, 20, 0.8)',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                textStyle: { color: '#fff', fontSize: 12 },
                formatter: (params) => {
                    const item = params[0];
                    const val = item.value;
                    const pc = ((val / prevClose - 1) * 100).toFixed(2);
                    const color = val >= prevClose ? '#ef4444' : '#10b981';
                    return `
                        <div style="font-family: monospace;">
                            <span style="opacity: 0.6">${item.name}</span><br/>
                            价格: <span style="font-weight: bold">${val.toFixed(2)}</span><br/>
                            涨跌: <span style="color: ${color}; font-weight: bold">${pc}%</span>
                        </div>
                    `;
                }
            },
            grid: {
                top: 20,
                left: 10,
                right: 50,
                bottom: 20,
                containLabel: true
            },
            xAxis: {
                type: 'category',
                data: data.map(d => d.time),
                axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.1)' } },
                axisLabel: {
                    color: 'rgba(255, 255, 255, 0.3)',
                    fontSize: 10,
                    interval: 60 // 约一小时显示一个刻度
                },
                splitLine: { show: false }
            },
            yAxis: {
                type: 'value',
                min: yMin,
                max: yMax,
                splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
                axisLabel: {
                    color: 'rgba(255, 255, 255, 0.5)',
                    fontSize: 10,
                    formatter: (value) => value.toFixed(2)
                },
                axisPointer: {
                    label: {
                        formatter: (params) => {
                            const val = params.value;
                            const pc = ((val / prevClose - 1) * 100).toFixed(2);
                            return `${val.toFixed(2)} (${pc}%)`;
                        }
                    }
                }
            },
            series: [
                {
                    name: '价格',
                    type: 'line',
                    data: prices,
                    smooth: false,
                    showSymbol: false,
                    lineStyle: { width: 1.5, color: '#3b82f6' },
                    areaStyle: {
                        color: {
                            type: 'linear',
                            x: 0, y: 0, x2: 0, y2: 1,
                            colorStops: [
                                { offset: 0, color: 'rgba(59, 130, 246, 0.2)' },
                                { offset: 1, color: 'transparent' }
                            ]
                        }
                    },
                    markLine: {
                        silent: true,
                        symbol: 'none',
                        label: { show: false },
                        data: [{ yAxis: prevClose, lineStyle: { color: 'rgba(255, 255, 255, 0.2)', type: 'dashed' } }]
                    }
                }
            ],
            animation: false // 实时行情关闭动画提高性能
        };
    }, [data, prevClose]);

    return (
        <div className="w-full" style={{ height: `${height}px` }}>
            {!data || data.length === 0 ? (
                <div className="h-full flex items-center justify-center text-white/20 italic text-sm">
                    暂无分时数据
                </div>
            ) : (
                <ReactECharts
                    option={option}
                    style={{ height: '100%', width: '100%' }}
                    notMerge={true}
                />
            )}
        </div>
    );
}
