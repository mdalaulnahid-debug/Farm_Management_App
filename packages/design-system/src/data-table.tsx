// Table of records with optional paging. On phones each row becomes a card (components.css › .table.cards):
// the first column is its title and the rest are labelled by data-label.
import type { ReactNode } from 'react';
import { Empty, Loading } from './feedback';
import { useDSText } from './text';

export interface Column<T> { key: string; label: string; render: (row: T) => ReactNode; num?: boolean; className?: string; hideSm?: boolean }

export function DataTable<T extends { id: string; status?: string }>({ rows, columns, onRow, empty, footer, page, pageSize, total, onPage }: {
  rows: T[] | undefined; columns: Column<T>[]; onRow?: (r: T) => void; empty?: ReactNode; footer?: ReactNode;
  page?: number; pageSize?: number; total?: number; onPage?: (p: number) => void;
}) {
  const t = useDSText();
  if (!rows) return <Loading />;
  if (!rows.length) return <Empty>{empty ?? t('Nothing recorded for this period yet.', 'এই সময়ে এখনো কিছু লেখা হয়নি।')}</Empty>;
  const pages = total && pageSize ? Math.ceil(total / pageSize) : 1;
  return (
    <>
      <div className="table-wrap">
        <table className="table cards">
          <thead><tr>{columns.map(c => <th key={c.key} className={`${c.num ? 'num' : ''} ${c.hideSm ? 'hide-sm' : ''}`}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className={`${onRow ? 'clickable' : ''} ${r.status === 'VOID' ? 'void' : ''}`} onClick={() => onRow?.(r)}>
                {columns.map(c => <td key={c.key} data-key={c.key} data-label={c.label || undefined} className={`${c.num ? 'num' : ''} ${c.className ?? ''} ${c.hideSm ? 'hide-sm' : ''}`}>{c.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
      {pages > 1 && onPage && page && (
        <div className="pager">
          <span>{t(`Page ${page} of ${pages} · ${total} records`, `পৃষ্ঠা ${page} / ${pages} · ${total}টি রেকর্ড`)}</span>
          <div className="row">
            <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('Previous', 'আগের')}</button>
            <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('Next', 'পরের')}</button>
          </div>
        </div>
      )}
    </>
  );
}
