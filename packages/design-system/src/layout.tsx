// Page structure: page header (optionally a photo band), cards and KPI tiles.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/** `photo` turns the header into a photo band (components.css › .page-head.photo); phones load `photoSmall`
 *  instead when given. `tall` is a larger banner. */
export function PageHeader({ title, subtitle, crumb, actions, photo, photoSmall, photoPos, tall }: { title: string; subtitle?: string; crumb?: string; actions?: ReactNode; photo?: string; photoSmall?: string; photoPos?: string; tall?: boolean }) {
  const style = photo ? ({ '--photo': `url(${photo})`, '--photo-sm': `url(${photoSmall ?? photo})`, '--photo-pos': photoPos ?? 'center' } as CSSProperties) : undefined;
  return (
    <div className={`page-head${photo ? ' photo' : ''}${tall ? ' tall' : ''}`} style={style}>
      <div>{crumb && <div className="crumb">{crumb}</div>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, pad, className = '' }: { title?: ReactNode; subtitle?: string; actions?: ReactNode; children: ReactNode; pad?: boolean; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <div className="card-head"><div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="row">{actions}</div>}</div>}
      {pad ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

const BN = '০১২৩৪৫৬৭৮৯';
/** Counts the figure in `ref` up from zero when it first appears (about 0.7 s, easing out), keeping its exact
 *  formatting: currency sign, brackets, grouping, Bangla digits. Skipped when motion is reduced or in Lite mode,
 *  and it stops at once if React changes the text meanwhile. */
function useCountUp(ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el || root.dataset.motion === 'reduce' || root.dataset.lite === 'true' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    while (walker.nextNode()) { const n = walker.currentNode as Text; if (/[0-9০-৯]/.test(n.data)) { node = n; break; } }
    if (!node) return;
    const final = node.data;
    const m = final.match(/[0-9০-৯][0-9০-৯,.]*/);
    if (!m) return;
    const bangla = /[০-৯]/.test(m[0]);
    const plain = m[0].replace(/[০-৯]/g, c => String(BN.indexOf(c))).replace(/,/g, '');
    const target = Number(plain);
    if (!isFinite(target) || target === 0) return;
    const decimals = plain.includes('.') ? plain.split('.')[1].length : 0;
    const fmt = new Intl.NumberFormat(bangla ? 'bn-BD' : 'en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: m[0].includes(',') });
    const t0 = performance.now(), dur = 700;
    let raf = 0, last = final;
    const frame = (now: number) => {
      if (node!.data !== last) return; // React re-rendered the figure: leave it alone.
      const p = Math.min((now - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 4);
      last = p < 1 ? final.replace(m[0], fmt.format(target * e)) : final;
      node!.data = last;
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); if (node!.data === last) node!.data = final; };
  }, []);
}

/** A tiny trend line of recent values (no axes), drawn in the current text colour of `.kpi-spark`. */
export function Sparkline({ values, label }: { values: number[]; label?: string }) {
  if (values.length < 2) return null;
  const w = 76, h = 28, max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)]);
  const line = pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label}>
      <polygon points={`0,${h} ${line} ${w},${h}`} className="kpi-spark-fill" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="2.6" fill="currentColor" />
    </svg>
  );
}

/** Change against an earlier period: the arrow follows the number, the colour says whether that is good. */
export interface KpiDelta { text: string; dir: 'up' | 'down' | 'flat'; good: boolean | null; title?: string }

export function Kpi({ icon: Icon, label, value, sub, tone, delta, spark }: { icon: any; label: string; value: ReactNode; sub?: ReactNode; tone?: 'amber' | 'blue' | 'red'; delta?: KpiDelta | null; spark?: number[] }) {
  const fig = useRef<HTMLDivElement>(null);
  useCountUp(fig);
  return (
    <div className="card kpi">
      <div className="kpi-label"><span className={`kpi-icon ${tone ?? ''}`}><Icon size={16} /></span>{label}</div>
      <div className="kpi-value-row">
        <div className="kpi-value" ref={fig}>{value}</div>
        {delta && <span className={`kpi-delta ${delta.dir} ${delta.good === null ? 'neutral' : delta.good ? 'good' : 'bad'}`} title={delta.title}>
          <i aria-hidden="true">{delta.dir === 'up' ? '↑' : delta.dir === 'down' ? '↓' : '→'}</i>{delta.text}
        </span>}
      </div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {spark && <Sparkline values={spark} label={label} />}
    </div>
  );
}
