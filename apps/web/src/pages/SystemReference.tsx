// Design reference: every token and component of @farmledger/design-system as it looks in this theme.
// Admins (settings.manage) use it to check the look; future sites copy from it.
import { Fragment, useState } from 'react';
import { CircleDollarSign, Egg, FileText, Wallet } from 'lucide-react';
import tokens from '@farmledger/design-system/tokens.json';
import { Alert, Badge, Card, DataTable, Empty, EmptyState, ErrorState, Field, Input, Kpi, Loading, PageHeader, SearchBox, Segmented, Select, Switch, Tabs, useToast } from '../components/ui';
import { usePrefs } from '../lib/i18n';

const COLOR_GROUPS: { title: string; names: string[] }[] = [
  { title: 'Brand', names: ['--brand', '--brand-2', '--brand-soft', '--gold', '--side-bg'] },
  { title: 'Surfaces', names: ['--bg', '--surface', '--surface-2', '--surface-3', '--border', '--border-strong'] },
  { title: 'Text', names: ['--text', '--text-2', '--text-3'] },
  { title: 'Status', names: ['--success', '--warning', '--danger', '--info', '--accent'] },
  { title: 'Charts', names: ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'] },
];

const rows = [
  { id: '1', number: 'INV-000011', party: 'Karim Mia', total: '৳1,250', status: 'PAID' },
  { id: '2', number: 'INV-000012', party: 'Walk-in customers', total: '৳480', status: 'POSTED' },
];

export default function SystemReference() {
  const { t, dark } = usePrefs();
  const toast = useToast();
  const [seg, setSeg] = useState<'a' | 'b'>('a');
  const [tab, setTab] = useState<'one' | 'two'>('one');
  const [on, setOn] = useState(true);
  const theme = dark ? { ...tokens.themes.bdp.light, ...tokens.themes.bdp.dark } : tokens.themes.bdp.light;

  return (
    <>
      <PageHeader crumb={t('Design system', 'ডিজাইন সিস্টেম')} title={t('Design reference', 'ডিজাইন রেফারেন্স')}
        subtitle={t('Every colour, size and building block of the shared design system, in the BDP Agrofarm theme.', 'শেয়ার করা ডিজাইন সিস্টেমের প্রতিটি রং, মাপ ও অংশ — বিডিপি অ্যাগ্রোফার্ম থিমে।')} />

      <Card title={t('Colours', 'রং')} pad>
        <div className="stack">
          {COLOR_GROUPS.map(g => (
            <div key={g.title} className="ref-swatches">
              <b className="small">{g.title}</b>
              <div className="row">
                {g.names.map(n => (
                  <div key={n} className="ref-swatch">
                    <i style={{ background: `var(${n})` }} />
                    <code className="small">{n}</code>
                    <span className="small muted mono">{(theme as Record<string, string>)[n]}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid g2">
        <Card title={t('Type', 'লেখা')} pad>
          <div className="stack">
            <h1>Heading 1 · শিরোনাম</h1>
            <h2>Heading 2 · উপশিরোনাম</h2>
            <h3>Heading 3</h3>
            <p>Body text for reading. ৪২০টি ডিম সংগ্রহ হয়েছে।</p>
            <p className="small muted">Small muted text for hints.</p>
            <p className="mono">INV-000011 · 1,08,640.00</p>
          </div>
        </Card>
        <Card title={t('Sizes and layers', 'মাপ ও স্তর')} pad>
          <dl className="desc-list">
            {Object.entries(tokens.base).filter(([, v]) => typeof v === 'string').map(([k, v]) => <Fragment key={k}><dt><code>{k}</code></dt><dd className="mono">{v as string}</dd></Fragment>)}
          </dl>
        </Card>
      </div>

      <Card title={t('Buttons and controls', 'বোতাম ও নিয়ন্ত্রণ')} pad>
        <div className="stack">
          <div className="row">
            <button className="btn primary">{t('Primary', 'প্রধান')}</button>
            <button className="btn">{t('Default', 'সাধারণ')}</button>
            <button className="btn ghost">{t('Ghost', 'হালকা')}</button>
            <button className="btn danger">{t('Danger', 'বিপদ')}</button>
            <button className="btn sm">{t('Small', 'ছোট')}</button>
            <button className="btn" disabled>{t('Disabled', 'নিষ্ক্রিয়')}</button>
            <button className="btn" onClick={() => toast(t('Theme changed to dark.', 'থিম অন্ধকার করা হয়েছে।'), 'ok', { label: t('Undo', 'ফিরিয়ে নিন'), onClick: () => {} })}>{t('Show a toast', 'টোস্ট দেখান')}</button>
          </div>
          <div className="form-grid">
            <Field label={t('Text field', 'লেখার ঘর')} hint={t('A hint under the field.', 'ঘরের নিচে একটি ইঙ্গিত।')}><Input placeholder="Karim Mia" /></Field>
            <Field label={t('With an error', 'ভুলসহ')} error={t('Enter an amount.', 'পরিমাণ লিখুন।')}><Input type="number" /></Field>
            <Field label={t('Choice', 'পছন্দ')}><Select options={[{ value: 'a', label: 'Flock A' }, { value: 'b', label: 'Flock B' }]} /></Field>
            <Field label={t('Search', 'খুঁজুন')}><SearchBox value="" onChange={() => {}} /></Field>
          </div>
          <div className="row">
            <Segmented value={seg} onChange={setSeg} options={[{ value: 'a', label: 'All' }, { value: 'b', label: 'Unpaid' }]} />
            <Switch checked={on} onChange={setOn} label={t('A switch', 'একটি সুইচ')} />
          </div>
          <Tabs value={tab} onChange={setTab} options={[{ value: 'one', label: 'Stock on hand' }, { value: 'two', label: 'Items' }]} />
        </div>
      </Card>

      <div className="grid g3">
        <Kpi icon={CircleDollarSign} label="Sales revenue" value="৳1,08,640" sub="Total income ৳1,12,000" />
        <Kpi icon={Wallet} tone="blue" label="Cash & bank" value="৳15,897" />
        <Kpi icon={Egg} tone="amber" label="Eggs collected" value="420" sub="26 sold" />
      </div>

      <Card title={t('Messages', 'বার্তা')} pad>
        <div className="stack">
          <Alert>{t('Information for the reader.', 'পাঠকের জন্য তথ্য।')}</Alert>
          <Alert tone="warn">{t('Something to check.', 'যাচাই করার মতো কিছু।')}</Alert>
          <Alert tone="error">{t('Something went wrong.', 'কিছু ভুল হয়েছে।')}</Alert>
          <div className="row"><Badge>Neutral</Badge><Badge tone="green">Paid</Badge><Badge tone="amber">Partly paid</Badge><Badge tone="blue">Unpaid</Badge><Badge tone="red">Void</Badge></div>
        </div>
      </Card>

      <Card title={t('Table', 'টেবিল')} subtitle={t('On phones each row becomes a card.', 'ফোনে প্রতিটি সারি একটি কার্ড হয়ে যায়।')}>
        <DataTable rows={rows} columns={[
          { key: 'number', label: 'Invoice', render: r => <b className="mono">{r.number}</b> },
          { key: 'party', label: 'Customer', render: r => r.party },
          { key: 'status', label: 'Status', render: r => <Badge tone={r.status === 'PAID' ? 'green' : 'blue'}>{r.status === 'PAID' ? 'Paid' : 'Unpaid'}</Badge> },
          { key: 'total', label: 'Total', num: true, render: r => r.total },
        ]} />
      </Card>

      <div className="grid g2">
        <Card title={t('Empty', 'খালি')}><Empty>{t('Nothing recorded for this period yet.', 'এই সময়ে এখনো কিছু লেখা হয়নি।')}</Empty></Card>
        <Card title={t('Loading', 'লোড হচ্ছে')}><Loading /></Card>
      </div>
      <div className="grid g2">
        <Card title={t('Nothing here yet', 'এখনো কিছু নেই')}><EmptyState icon={FileText} title={t('No invoices yet', 'এখনো কোনো চালান নেই')} body={t('Your first sale will appear here.', 'প্রথম বিক্রয় এখানে দেখা যাবে।')} action={<button className="btn primary">{t('New invoice', 'নতুন চালান')}</button>} /></Card>
        <Card title={t('Something went wrong', 'সমস্যা')}><ErrorState onRetry={() => {}} /></Card>
      </div>
    </>
  );
}
