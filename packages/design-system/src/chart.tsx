// A small chart for bars, lines and shaded areas over a category axis (months, days), with an optional second
// axis on the right (e.g. a % rate). Plain SVG and a few lines of code instead of a charting library, so the
// first screen loads fast on slow connections. Fills its parent's size (give the parent a height).
import { useEffect, useMemo, useRef, useState } from 'react';

export interface ChartSeries {
  key: string;
  name: string;
  kind: 'bar' | 'line' | 'area';
  color: string;
  /** Which axis the series is measured on; `right` needs `rightDomain`. */
  axis?: 'left' | 'right';
  dots?: boolean;
}

/** A round step so axis labels read 0, 50, 100… rather than 0, 47, 94… */
function niceStep(max: number, ticks: number) {
  const raw = max / ticks || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
}

export function ComboChart<T extends Record<string, any>>({ data, xKey, series, formatLeft = String, formatRight = String, rightDomain, format, leftWidth = 56 }: {
  data: T[]; xKey: keyof T & string; series: ChartSeries[];
  formatLeft?: (v: number) => string; formatRight?: (v: number) => string; rightDomain?: [number, number];
  /** Tooltip value text for one series. */
  format?: (v: number, s: ChartSeries) => string;
  leftWidth?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const right = series.some(s => s.axis === 'right');
  const pad = { l: leftWidth, r: right ? 44 : 8, t: 12, b: 26 };
  const W = Math.max(size.w - pad.l - pad.r, 1);
  const H = Math.max(size.h - pad.t - pad.b, 1);
  const left = series.filter(s => s.axis !== 'right');
  const { step, top, bottom } = useMemo(() => {
    const vals = data.flatMap(d => left.map(s => Number(d[s.key] ?? 0)));
    const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
    const st = niceStep(Math.max(max - min, 1), 4);
    return { step: st, top: Math.ceil(max / st) * st || st, bottom: Math.floor(min / st) * st };
  }, [data, left]);
  const y = (v: number) => pad.t + H - ((v - bottom) / (top - bottom)) * H;
  const [r0, r1] = rightDomain ?? [0, 100];
  const yr = (v: number) => pad.t + H - ((v - r0) / (r1 - r0)) * H;
  const band = W / Math.max(data.length, 1);
  const x = (i: number) => pad.l + band * i + band / 2;
  const bars = series.filter(s => s.kind === 'bar');
  const barW = Math.min(26, (band * 0.7) / Math.max(bars.length, 1));
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v);
  // Only as many category labels as fit without overlapping.
  const every = Math.max(1, Math.ceil(46 / band));
  const path = (s: ChartSeries) => data.map((d, i) => d[s.key] == null ? null : `${x(i)},${(s.axis === 'right' ? yr : y)(Number(d[s.key]))}`).filter(Boolean) as string[];

  return (
    <div ref={box} className="ds-chart" onPointerLeave={() => setHover(null)}>
      {size.w > 0 && (
        <svg width={size.w} height={size.h} role="img" aria-label={series.map(s => s.name).join(', ')}
          onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.floor((e.clientX - r.left - pad.l) / band); setHover(i >= 0 && i < data.length ? i : null); }}>
          {ticks.map(v => <g key={v}>
            <line x1={pad.l} x2={pad.l + W} y1={y(v)} y2={y(v)} className="ds-grid" />
            <text x={pad.l - 8} y={y(v)} className="ds-tick" textAnchor="end" dominantBaseline="middle">{formatLeft(v)}</text>
          </g>)}
          {right && [r0, (r0 + r1) / 2, r1].map(v => <text key={v} x={pad.l + W + 6} y={yr(v)} className="ds-tick" dominantBaseline="middle">{formatRight(v)}</text>)}
          {hover !== null && <rect x={pad.l + band * hover} y={pad.t} width={band} height={H} className="ds-hover" />}
          {series.filter(s => s.kind === 'area').map(s => {
            const p = path(s);
            return p.length ? <g key={s.key}>
              <path d={`M${p[0].split(',')[0]},${y(Math.max(bottom, 0))} L${p.join(' L')} L${p[p.length - 1].split(',')[0]},${y(Math.max(bottom, 0))} Z`} fill={s.color} opacity={0.15} />
              <polyline points={p.join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
            </g> : null;
          })}
          {data.map((d, i) => bars.map((s, j) => {
            const v = Number(d[s.key] ?? 0);
            const bx = x(i) - (barW * bars.length) / 2 + j * barW;
            const y0 = y(0), y1 = y(v);
            return <rect key={`${s.key}${i}`} x={bx + 1} width={Math.max(barW - 2, 1)} y={Math.min(y0, y1)} height={Math.abs(y0 - y1)} rx={Math.min(4, barW / 4)} fill={s.color} />;
          }))}
          {series.filter(s => s.kind === 'line').map(s => <g key={s.key}>
            <polyline points={path(s).join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.dots && data.map((d, i) => d[s.key] == null ? null : <circle key={i} cx={x(i)} cy={(s.axis === 'right' ? yr : y)(Number(d[s.key]))} r={3} fill={s.color} />)}
          </g>)}
          {data.map((d, i) => (i % every === 0 ? <text key={i} x={x(i)} y={pad.t + H + 17} className="ds-tick" textAnchor="middle">{String(d[xKey])}</text> : null))}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <div className="ds-tip" style={{ left: Math.min(Math.max(x(hover) - 70, 0), size.w - 150), top: 4 }} role="status">
          <b>{String(data[hover][xKey])}</b>
          {series.map(s => data[hover][s.key] == null ? null : (
            <span key={s.key}><i style={{ background: s.color }} />{s.name}<b>{format ? format(Number(data[hover][s.key]), s) : String(data[hover][s.key])}</b></span>
          ))}
        </div>
      )}
    </div>
  );
}
