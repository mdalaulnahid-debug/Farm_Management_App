// Messages and states: toasts, alerts, badges, empty and loading.
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertTriangle, Inbox, Info, XCircle } from 'lucide-react';
import { Skeleton } from './states';

/** `action` adds one button to the toast, e.g. Undo for a setting (never for money records). */
export interface ToastAction { label: string; onClick: () => void }
type ToastFn = (message: string, kind?: 'ok' | 'error', action?: ToastAction) => void;
const ToastContext = createContext<ToastFn>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; message: string; kind: 'ok' | 'error'; action?: ToastAction }[]>([]);
  const drop = (id: number) => setItems(xs => xs.filter(x => x.id !== id));
  const push = useCallback<ToastFn>((message, kind = 'ok', action) => {
    const id = Date.now() + Math.random();
    setItems(xs => [...xs, { id, message, kind, action }]);
    setTimeout(() => drop(id), kind === 'error' ? 7000 : action ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(i => (
          <div key={i.id} className={`toast ${i.kind === 'error' ? 'error' : ''}`}>
            {i.kind === 'error' ? <XCircle size={18} /> : <SavedTick />}<span>{i.message}</span>
            {i.action && <button className="toast-action" onClick={() => { i.action!.onClick(); drop(i.id); }}>{i.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
/** The tick on a "saved" message: the ring draws itself, then the check (components.css › .tick). */
export function SavedTick({ size = 18 }: { size?: number }) {
  return (
    <svg className="tick" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="10" pathLength={1} />
      <path d="M7.5 12.4l3 3 6-6.4" pathLength={1} />
    </svg>
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

/** Placeholder while data loads (grey lines, not a spinner). */
export function Loading() {
  return <Skeleton lines={4} />;
}
