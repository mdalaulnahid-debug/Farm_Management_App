// Page states every app needs: loading placeholder, nothing-here-yet, and something-went-wrong (with an
// error boundary that shows it instead of a blank screen).
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { CloudOff, RotateCcw } from 'lucide-react';
import { useDSText } from './text';

/** Grey placeholder lines in the shape of the content that is on its way. */
export function Skeleton({ lines = 3, height }: { lines?: number; height?: number }) {
  const t = useDSText();
  return (
    <div className="skeleton" role="status" aria-busy="true">
      <span className="sr-only">{t('Loading…', 'লোড হচ্ছে…')}</span>
      {height ? <i style={{ height }} /> : Array.from({ length: lines }, (_, i) => <i key={i} />)}
    </div>
  );
}

/** Nothing here yet: a picture, one sentence, and the one action that fixes it. */
export function EmptyState({ icon: Icon, title, body, action }: { icon: ComponentType<{ size?: number }>; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <span className="state-pic"><Icon size={28} /></span>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action && <div className="state-action">{action}</div>}
    </div>
  );
}

/** Something failed: say so calmly and offer to try again. */
export function ErrorState({ title, body, onRetry }: { title?: string; body?: string; onRetry?: () => void }) {
  const t = useDSText();
  return (
    <div className="state error" role="alert">
      <span className="state-pic"><CloudOff size={28} /></span>
      <h3>{title ?? t('Something went wrong', 'কিছু একটা সমস্যা হয়েছে')}</h3>
      <p>{body ?? t('Nothing you entered is lost. Try again; if it keeps happening, tell the owner.', 'আপনার দেওয়া কিছুই হারায়নি। আবার চেষ্টা করুন; বারবার হলে মালিককে জানান।')}</p>
      {onRetry && <div className="state-action"><button className="btn primary" onClick={onRetry}><RotateCcw size={16} />{t('Try again', 'আবার চেষ্টা করুন')}</button></div>}
    </div>
  );
}

/** Catches a crash inside its children and shows `fallback` (default: ErrorState with a reload). */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode; resetKey?: unknown }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  componentDidUpdate(prev: { resetKey?: unknown }) { if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ?? <ErrorState onRetry={() => window.location.reload()} />;
  }
}
