// Messages and states: toasts, alerts, badges, empty and loading.
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Inbox, Info, Loader2, XCircle } from 'lucide-react';
import { useDSText } from './text';

type ToastFn = (message: string, kind?: 'ok' | 'error') => void;
const ToastContext = createContext<ToastFn>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; message: string; kind: 'ok' | 'error' }[]>([]);
  const push = useCallback<ToastFn>((message, kind = 'ok') => {
    const id = Date.now() + Math.random();
    setItems(xs => [...xs, { id, message, kind }]);
    setTimeout(() => setItems(xs => xs.filter(x => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(i => (
          <div key={i.id} className={`toast ${i.kind === 'error' ? 'error' : ''}`}>
            {i.kind === 'error' ? <XCircle size={18} /> : <CheckCircle2 size={18} />}<span>{i.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

export function Badge({ children, tone }: { children: ReactNode; tone?: 'green' | 'amber' | 'red' | 'blue' }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

export function Alert({ children, tone }: { children: ReactNode; tone?: 'warn' | 'error' }) {
  const Icon = tone === 'error' ? XCircle : tone === 'warn' ? AlertTriangle : Info;
  return <div className={`alert ${tone ?? ''}`}><Icon size={18} /><div>{children}</div></div>;
}

export function Empty({ children, icon: Icon = Inbox }: { children: ReactNode; icon?: any }) {
  return <div className="empty"><Icon size={28} />{children}</div>;
}

export function Loading() {
  const t = useDSText();
  return <div className="empty"><Loader2 size={22} className="spin" />{t('Loading…', 'লোড হচ্ছে…')}</div>;
}
