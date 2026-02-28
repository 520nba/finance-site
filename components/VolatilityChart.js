'use client';

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

export default function VolatilityChart({ data, title, color = '#3b82f6', height = 250, compact = false }) {
    const option = useMemo(() => ({
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(10, 14, 20, 0.8)',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            textStyle: { color: '#fff' },
            formatter: (params) => {
                const item = params[0];
                return `${item.name}<br/>收益率: <span style="color:${item.color}">${item.value.toFixed(2)}%</span>`;
            },
        },
        grid: {
            top: compact ? 10 : 20,
            left: compact ? 0 : 10,
            right: compact ? 0 : 10,
            bottom: compact ? 0 : 10,
            containLabel: !compact,
        },
        xAxis: {
            type: 'category',
            data: data.map(d => d.date),
            axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.1)' } },
            axisLabel: { show: false },
        },
        yAxis: {
            type: 'value',
            axisLine: { show: false },
            splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
            axisLabel: {
                show: !compact,
                color: 'rgba(255, 255, 255, 0.5)',
                formatter: '{value}%',
            },
        },
        series: [
            {
                name: title,
                type: 'line',
                data: data.map(d => d.performance),
                smooth: true,
                showSymbol: false,
                lineStyle: { width: 3, color },
                areaStyle: {
                    color: {
                        type: 'linear',
                        x: 0, y: 0, x2: 0, y2: 1,
                        colorStops: [
                            { offset: 0, color: `${color}44` },
                            { offset: 1, color: `${color}00` },
                        ],
                    },
                },
            },
        ],
        animationDuration: 1200,
    }), [data, color, compact, title]);

    return (
        <div className="w-full" style={{ height: `${height}px` }}>
            <ReactECharts
                option={option}
                style={{ height: '100%', width: '100%' }}
                notMerge={true}
                lazyUpdate={true}
            />
        </div>
    );
}
