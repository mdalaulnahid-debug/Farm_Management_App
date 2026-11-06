// A printed business document (invoice, purchase bill) laid out like a company letterhead: crest and farm name,
// the document's title and number, a status stamp, the party and dates, the lines and totals, then a signature
// line and a QR code carrying the document's key facts. The same layout shows on screen and prints on A4.
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { usePrefs } from '../lib/i18n';
import { LogoMark } from '../brand/Logo';

/** A QR code (SVG) for `text`, drawn once the small QR library has loaded. */
function Qr({ text, label }: { text: string; label: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    import('qrcode').then(q => q.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0e3b2c', light: '#0000' } }))
      .then(s => { if (live) setSvg(s); }, () => {});
    return () => { live = false; };
  }, [text]);
  return <div className="doc-qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function DocPaper({ kind, number, status, party, meta, qr, thanks, signLabel, children }: {
  /** The document's name, e.g. "Invoice". */
  kind: string; number: string;
  status?: { label: string; tone: 'paid' | 'open' | 'void' };
  party: { label: string; name: ReactNode; lines?: (string | null | undefined)[] };
  meta: [string, ReactNode][];
  /** Plain text for the QR code; leave out for no code. */
  qr?: string;
  /** The closing line; the farm's invoice footer or a thank-you when left out, none when null. */
  thanks?: string | null;
  /** Under the signature line; "Authorised signature" when left out. */
  signLabel?: string;
  children: ReactNode;
}) {
  const { me } = useAuth();
  const { t } = usePrefs();
  const org = me?.organization;
  const contact = [org?.address, org?.phone].filter(Boolean).join(' · ');
  return (
    <article className="doc-paper">
      <header className="doc-top">
        <div className="doc-org">
          <LogoMark size={52} />
          <div>
            <b>{org?.nameBn || org?.name}</b>
            {org?.nameBn && <span>{org.name}</span>}
            {contact && <small>{contact}</small>}
          </div>
        </div>
        <div className="doc-title">
          <h2>{kind}</h2>
          <span className="doc-number">{number}</span>
          {status && <span className={`doc-stamp ${status.tone}`}>{status.label}</span>}
        </div>
      </header>
      <div className="doc-rule" />
      <section className="doc-meta">
        <div className="doc-party">
          <small>{party.label}</small>
          <b>{party.name}</b>
          {party.lines?.filter(Boolean).map((l, i) => <span key={i}>{l}</span>)}
        </div>
        <dl>{meta.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </section>
      <div className="doc-content">{children}</div>
      <footer className="doc-foot">
        <div className="doc-thanks">
          {thanks !== null && <p>{thanks ?? (org?.invoiceFooter || t('Thank you for your business.', 'আপনার সাথে ব্যবসার জন্য ধন্যবাদ।'))}</p>}
          <div className="doc-sign"><i />{signLabel ?? t('Authorised signature', 'অনুমোদিত স্বাক্ষর')}</div>
        </div>
        {qr && <Qr text={qr} label={t('QR code with this document’s details', 'এই কাগজের তথ্যসহ কিউআর কোড')} />}
      </footer>
    </article>
  );
}

/** The stamp on a document: Paid (green), Void (red) or still owed (gold). */
export function docStatus(t: (en: string, bn: string) => string, status: string): { label: string; tone: 'paid' | 'open' | 'void' } {
  if (status === 'PAID') return { label: t('Paid', 'পরিশোধিত'), tone: 'paid' };
  if (status === 'VOID') return { label: t('Void', 'বাতিল'), tone: 'void' };
  if (status === 'PARTIAL') return { label: t('Part paid', 'আংশিক পরিশোধ'), tone: 'open' };
  return { label: t('Unpaid', 'বাকি'), tone: 'open' };
}

/** The QR code's text: farm, document and amounts, in plain English so any phone camera shows it readably. */
export function docQr(org: string | undefined, kind: string, number: string, date: string, total: number, balance: number, status: string) {
  const tk = (v: number) => `Tk ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  return [org, `${kind} ${number}`, `Date ${String(date).slice(0, 10)}`, `Total ${tk(total)}`, status === 'VOID' ? 'VOID' : `Balance due ${tk(Math.max(balance, 0))}`].filter(Boolean).join('\n');
}
