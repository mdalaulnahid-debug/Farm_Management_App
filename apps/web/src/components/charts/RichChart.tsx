// The full charts (Recharts) for WiFi and 4G: smooth curves, soft gradient fills, rounded bars, animated
// entry and a rich tooltip. Same props as the design system's light ComboChart, which is used instead in
// Lite mode and on slow connections (see Chart.tsx). Loaded in its own file, after the first screen.
import { useId } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ChartProps } from './Chart';

const tick = { fontSize: 12, fill: 'var(--text-3)' };

export default function RichChart<T extends Record<string, any>>({ data, xKey, series, formatLeft = String, formatRight = String, rightDomain, format, leftWidth = 56 }: ChartProps<T>) {
  const uid = useId().replace(/:/g, '');
  const right = series.some(s => s.axis === 'right');
  const motion = document.documentElement.dataset.motion !== 'reduced';
  const bars = series.filter(s => s.kind === 'bar').length;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ left: 4, right: right ? 4 : 12, top: 14, bottom: 0 }} barGap={4} barCategoryGap={bars > 1 ? '22%' : '28%'}>
        <defs>
          {series.map(s => (
            <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={s.kind === 'area' ? 0.32 : 1} />
              <stop offset="100%" stopColor={s.color} stopOpacity={s.kind === 'area' ? 0.02 : 0.72} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey={xKey as string} tick={tick} axisLine={false} tickLine={false} minTickGap={14} dy={6} />
        <YAxis yAxisId="left" tick={tick} axisLine={false} tickLine={false} width={leftWidth} tickFormatter={formatLeft} allowDecimals={false} />
        {right && <YAxis yAxisId="right" orientation="right" domain={rightDomain ?? [0, 100]} tick={tick} axisLine={false} tickLine={false} width={44} tickFormatter={formatRight} />}
        <Tooltip cursor={{ fill: 'var(--surface-3)', opacity: 0.6, radius: 6 } as any} content={({ active, payload, label }: any) => {
          if (!active || !payload?.length) return null;
          return (
            <div className="rich-tip">
              <div className="rich-tip-label">{label}</div>
              {payload.map((p: any) => {
                const s = series.find(x => x.key === p.dataKey)!;
                return <div key={p.dataKey} className="rich-tip-row"><i style={{ background: s.color }} /><span>{s.name}</span><b>{format ? format(Number(p.value), s) : String(p.value)}</b></div>;
              })}
            </div>
          );
        }} />
        {series.map(s => {
          const common = { key: s.key, dataKey: s.key, name: s.name, yAxisId: s.axis === 'right' ? 'right' : 'left', isAnimationActive: motion, animationDuration: 700, animationEasing: 'ease-out' as const };
          if (s.kind === 'bar') return <Bar {...common} fill={`url(#${uid}-${s.key})`} radius={[6, 6, 2, 2]} maxBarSize={bars > 1 ? 22 : 28} />;
          if (s.kind === 'area') return <Area {...common} type="monotone" stroke={s.color} strokeWidth={2.25} fill={`url(#${uid}-${s.key})`} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} />;
          return <Line {...common} type="monotone" stroke={s.color} strokeWidth={2.5} connectNulls
            dot={s.dots ? { r: 3.5, strokeWidth: 2, stroke: 'var(--surface)', fill: s.color } : false} activeDot={{ r: 5.5, strokeWidth: 2, stroke: 'var(--surface)' }} />;
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
