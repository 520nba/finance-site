'use client';

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

/**
 * 获取 A 股完整的分时时间序列 (09:30-11:30, 13:00-15:00)
 * 总计 242 个点 (121 + 121)
 */
function getFullTimePeriods() {
    const morning = [];
    const afternoon = [];

    // 09:30 - 11:30 (121个点)
    let start = new Date(2020, 0, 1, 9, 30);
    const mid = new Date(2020, 0, 1, 11, 30);
    while (start <= mid) {
        morning.push(start.toTimeString().substring(0, 5));
        start.setMinutes(start.getMinutes() + 1);
    }

    // 13:01 - 15:00 (120个点，避免与 11:30 重复或留白过多)
    // A股惯例分时图通常是 242 个点：09:30-11:30 (121点) + 13:00(实质是13:01)-15:00 (120/121点)
    start = new Date(2020, 0, 1, 13, 1);
    const end = new Date(2020, 0, 1, 15, 0);
    while (start <= end) {
        afternoon.push(start.toTimeString().substring(0, 5));
        start.setMinutes(start.getMinutes() + 1);
    }

    return [...morning, ...afternoon];
}

const FULL_TIME_AXIS = getFullTimePeriods();

export default function IntradayChart({ data, prevClose, height = 300 }) {
    const option = useMemo(() => {
        if (!data || !prevClose) return {};

        // 将原始数据根据时间映射到完整时间轴上
        const dataMap = new Map();
        data.forEach(d => {
            dataMap.set(d.time, d.value);
        });

        // 记录最后一个有效价格，用于辅助计算涨跌幅
        let lastValidPrice = null;
        const prices = FULL_TIME_AXIS.map(time => {
            const val = dataMap.get(time);
            if (val !== undefined) {
                lastValidPrice = val;
                return val;
            }
            return null;
        });

        // 计算百分比数据
        const percentData = prices.map(price => {
            if (price === null) return null;
            return ((price / prevClose - 1) * 100).toFixed(2);
        });

        // 计算 Y 轴范围 (百分比)，确保对称
        const validPercents = percentData.filter(p => p !== null).map(Number);
        const maxAbs = Math.max(...validPercents.map(Math.abs), 0.5); // 最小给 0.5% 范围
        const yMin = -maxAbs;
        const yMax = maxAbs;

        return {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(10, 14, 20, 0.8)',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                textStyle: { color: '#fff', fontSize: 12 },
                formatter: (params) => {
                    const item = params[0];
                    const time = item.name;
                    const percent = item.value;
                    if (percent === null || percent === undefined) return '';

                    const price = prices[item.dataIndex];
                    const color = percent >= 0 ? '#ef4444' : '#10b981';
                    return `
                        <div style="font-family: monospace; min-width: 120px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="opacity: 0.6">时间</span>
                                <span>${time}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="opacity: 0.6">价格</span>
                                <span style="font-weight: bold">${price?.toFixed(2)}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span style="opacity: 0.6">涨跌</span>
                                <span style="color: ${color}; font-weight: bold">${percent > 0 ? '+' : ''}${percent}%</span>
                            </div>
                        </div>
                    `;
                }
            },
            grid: {
                top: 20,
                left: 10,
                right: 50,
                bottom: 0,
                containLabel: true
            },
            xAxis: {
                type: 'category',
                data: FULL_TIME_AXIS,
                axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.1)' } },
                axisLabel: {
                    color: 'rgba(255, 255, 255, 0.3)',
                    fontSize: 10,
                    interval: (index, value) => {
                        return ['09:30', '10:30', '11:30', '13:00', '14:00', '15:00'].includes(value);
                    }
                },
                splitLine: {
                    show: true,
                    lineStyle: { color: 'rgba(255, 255, 255, 0.03)', type: 'dashed' },
                    interval: (index, value) => ['10:30', '11:30', '13:00', '14:00'].includes(value)
                }
            },
            yAxis: {
                type: 'value',
                min: yMin,
                max: yMax,
                splitNumber: 4,
                splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
                axisLabel: {
                    color: 'rgba(255, 255, 255, 0.5)',
                    fontSize: 10,
                    formatter: (value) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
                }
            },
            series: [
                {
                    name: '涨跌幅',
                    type: 'line',
                    data: percentData,
                    smooth: false,
                    showSymbol: false,
                    connectNulls: true,
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
                        data: [{ yAxis: 0, lineStyle: { color: 'rgba(255, 255, 255, 0.2)', type: 'dashed' } }]
                    }
                }
            ],
            animation: false
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
