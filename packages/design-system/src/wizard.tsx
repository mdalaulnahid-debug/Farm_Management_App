// Step-by-step forms for people who are not at home with computers: one question per screen, big buttons,
// a number pad, a "?" that explains the step, and a plain sentence to check before anything is saved.
// Keyboard (office PC): digits type into the pad, Enter = Next, Esc = Back.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, Delete, X } from 'lucide-react';
import { useDSText } from './text';

export interface WizardStep<D> {
  key: string;
  /** The question, e.g. "How many eggs today?" */
  title: string;
  /** Plain-words explanation shown by the "?" button. */
  help: string;
  picture?: ReactNode;
  render: (data: D, set: (p: Partial<D>) => void, next: () => void) => ReactNode;
  /** Next stays disabled until this is true. */
  valid?: (data: D) => boolean;
  /** Steps the answers make unnecessary (e.g. choosing a flock when there is only one). */
  skip?: (data: D) => boolean;
}

export function Wizard<D>({ title, steps, initial, sentence, onSave, onCancel, busy, error }: {
  title: string; steps: WizardStep<D>[]; initial: D;
  /** The check sentence for the last screen, e.g. "You collected 420 eggs from Flock A today." */
  sentence: (data: D) => ReactNode;
  onSave: (data: D) => void; onCancel: () => void; busy?: boolean; error?: ReactNode;
}) {
  const t = useDSText();
  const [data, setData] = useState(initial);
  const [at, setAt] = useState(0);
  const [help, setHelp] = useState(false);
  const live = steps.filter(s => !s.skip?.(data));
  const confirming = at >= live.length;
  const step = live[Math.min(at, live.length - 1)];
  const ok = confirming || !step?.valid || step.valid(data);
  const set = (p: Partial<D>) => setData(d => { const n = { ...d, ...p }; latest.current = n; return n; });
  // Next reads the newest answers (a picture choice moves on right after it is tapped, before a re-render).
  const latest = useRef(data);
  latest.current = data;
  const next = () => {
    const d = latest.current;
    const steps2 = steps.filter(s => !s.skip?.(d));
    setAt(i => {
      const s = steps2[i];
      if (s && s.valid && !s.valid(d)) return i;
      setHelp(false);
      return Math.min(i + 1, steps2.length);
    });
  };
  const back = () => { setHelp(false); if (at === 0) onCancel(); else setAt(i => i - 1); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); back(); }
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); if (confirming) { if (!busy) onSave(data); } else next(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <section className="wizard" aria-label={title}>
      <header className="wizard-head">
        <button type="button" className="btn ghost icon" onClick={onCancel} aria-label={t('Close', 'বন্ধ করুন')}><X size={20} /></button>
        <div>
          <small>{title}</small>
          <b>{confirming ? t('Check and save', 'যাচাই করে সংরক্ষণ') : t(`Step ${at + 1} of ${live.length}`, `ধাপ ${at + 1} / ${live.length}`)}</b>
        </div>
        <div className="wizard-dots" aria-hidden="true">{live.map((s, i) => <i key={s.key} className={i < at ? 'done' : i === at ? 'on' : ''} />)}</div>
      </header>

      {confirming ? (
        <div className="wizard-body">
          <span className="wizard-pic ok"><Check size={34} /></span>
          <p className="wizard-sentence">{sentence(data)}</p>
          <p className="wizard-q small">{t('Is this correct?', 'এটা কি ঠিক আছে?')}</p>
          {error && <div className="wizard-error" role="alert">{error}</div>}
        </div>
      ) : (
        <div className="wizard-body">
          {step.picture && <span className="wizard-pic">{step.picture}</span>}
          <div className="wizard-title">
            <h2>{step.title}</h2>
            <button type="button" className={`help-btn ${help ? 'on' : ''}`} onClick={() => setHelp(h => !h)} aria-expanded={help} aria-label={t('What is this?', 'এটা কী?')}><CircleHelp size={22} /></button>
          </div>
          {help && <p className="wizard-help">{step.help}</p>}
          <div className="wizard-control">{step.render(data, set, next)}</div>
        </div>
      )}

      <footer className="wizard-foot">
        <button type="button" className="btn lg" onClick={confirming ? () => setAt(0) : back} disabled={busy}>
          <ArrowLeft size={20} />{confirming ? t('Change', 'বদলান') : at === 0 ? t('Cancel', 'বাতিল') : t('Back', 'পেছনে')}
        </button>
        {confirming
          ? <button type="button" className="btn primary lg" onClick={() => onSave(data)} disabled={busy}><Check size={20} />{busy ? t('Saving…', 'সংরক্ষণ হচ্ছে…') : t('Yes, save', 'হ্যাঁ, সংরক্ষণ')}</button>
          : <button type="button" className="btn primary lg" onClick={next} disabled={!ok}>{t('Next', 'পরের')}<ArrowRight size={20} /></button>}
      </footer>
    </section>
  );
}

/** Big on-screen number pad. Typing digits on a keyboard works too. */
export function NumberPad({ value, onChange, allowDecimal, unit, label }: { value: string; onChange: (v: string) => void; allowDecimal?: boolean; unit?: string; label: string }) {
  const t = useDSText();
  const press = (k: string) => {
    if (k === 'del') return onChange(value.slice(0, -1));
    if (k === '.' && (!allowDecimal || value.includes('.'))) return;
    if (value.replace('.', '').length >= 9) return;
    onChange(value === '0' && k !== '.' ? k : value + k);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === '.' || e.key === ',') press('.');
      else if (e.key === 'Backspace') press('del');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="numpad">
      <output className="numpad-value" aria-label={label} aria-live="polite">{value || '0'}{unit && <small>{unit}</small>}</output>
      <div className="numpad-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', allowDecimal ? '.' : '', '0', 'del'].map((k, i) => k === ''
          ? <span key={i} />
          : <button key={k} type="button" onClick={() => press(k)} aria-label={k === 'del' ? t('Delete', 'মুছুন') : k}>{k === 'del' ? <Delete size={24} /> : k}</button>)}
      </div>
    </div>
  );
}

/** A few big picture buttons; picking one can move straight on (`onPick`). */
export function ChoiceButtons<V extends string>({ options, value, onChange, onPick }: {
  options: { value: V; label: string; sub?: string; picture?: ReactNode }[]; value: V | undefined; onChange: (v: V) => void; onPick?: () => void;
}) {
  return (
    <div className="choices" role="radiogroup">
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`choice ${value === o.value ? 'on' : ''}`}
          onClick={() => { onChange(o.value); onPick && setTimeout(onPick, 120); }}>
          {o.picture && <span className="choice-pic">{o.picture}</span>}
          <span><b>{o.label}</b>{o.sub && <small>{o.sub}</small>}</span>
        </button>
      ))}
    </div>
  );
}
