// Side drawer (forms) and centred dialog (short questions). Esc or a click outside closes the drawer.
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDSText } from './text';

export function Drawer({ title, subtitle, onClose, children, footer, narrow }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; narrow?: boolean }) {
  const t = useDSText();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`drawer ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="btn ghost icon" onClick={onClose} aria-label={t('Close', 'বন্ধ করুন')}><X size={18} /></button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const t = useDSText();
  return (
    <div className="overlay center" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head"><h2>{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label={t('Close', 'বন্ধ করুন')}><X size={18} /></button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}
