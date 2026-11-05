// Page structure: page header (optionally a photo band), cards and KPI tiles.
import type { CSSProperties, ReactNode } from 'react';

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

export function Kpi({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: ReactNode; sub?: ReactNode; tone?: 'amber' | 'blue' | 'red' }) {
  return (
    <div className="card kpi">
      <div className="kpi-label"><span className={`kpi-icon ${tone ?? ''}`}><Icon size={16} /></span>{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
