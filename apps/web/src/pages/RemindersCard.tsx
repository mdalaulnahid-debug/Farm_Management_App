// Users & settings › Organization › Daily reminders (owner/admin only): when data-entry staff's phones are
// reminded, and a test button for the person setting it up. Hidden on a server without reminders.
import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Alert, Card, Field, Input, Switch, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useApi, useSave } from '../lib/hooks';
import { usePrefs } from '../lib/i18n';
import { enableReminders, reminderState } from '../lib/push';

interface Cfg { on: boolean; morning: string; evening: string }
const plus = (hhmm: string, h: number) => { const [a, b] = hhmm.split(':').map(Number); const m = (a * 60 + b + h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

export function RemindersCard() {
  const { t } = usePrefs();
  const toast = useToast();
  const q = useApi<Cfg>('/settings/reminders');
  const [cfg, setCfg] = useState<Cfg | null>(null);
  useEffect(() => { if (q.data) setCfg(q.data); }, [q.data]);
  const save = useSave<Cfg>('put', '/settings/reminders', t('Reminder times saved.', 'মনে করিয়ে দেওয়ার সময় সংরক্ষিত।'));
  if (q.isError || !cfg) return null;

  const test = async () => {
    const state = await reminderState().catch(() => 'unsupported' as const);
    if (state !== 'on') {
      const s = await enableReminders().catch(() => 'unsupported' as const);
      if (s !== 'on') { toast(t('Turn on notifications for FarmLedger on this device first.', 'আগে এই ডিভাইসে ফার্মলেজারের নোটিফিকেশন চালু করুন।'), 'error'); return; }
    }
    const r = await api.post<{ sent: number }>('/settings/reminders/test');
    toast(r.sent ? t('Test reminder sent. It should appear in a few seconds.', 'পরীক্ষার নোটিফিকেশন পাঠানো হয়েছে। কয়েক সেকেন্ডে দেখা যাবে।') : t('This device is not registered yet.', 'এই ডিভাইস এখনো নিবন্ধিত নয়।'));
  };

  return (
    <Card title={<span className="row gap-8"><BellRing size={18} />{t('Daily reminders', 'দৈনিক মনে করিয়ে দেওয়া')}</span>}
      subtitle={t('Data-entry staff get a phone notification to record the morning eggs and the evening feed, medicine and expenses (Bangladesh time).', 'ডেটা এন্ট্রির কর্মীরা সকালের ডিম এবং সন্ধ্যার খাদ্য, ওষুধ ও খরচ লেখার জন্য ফোনে নোটিফিকেশন পান (বাংলাদেশ সময়)।')} pad>
      <div className="stack">
        <Switch checked={cfg.on} onChange={on => setCfg({ ...cfg, on })} label={cfg.on ? t('Reminders are on', 'চালু আছে') : t('Reminders are off', 'বন্ধ আছে')} />
        <div className="form-grid">
          <Field label={t('Morning reminder (eggs)', 'সকালের মনে করানো (ডিম)')} hint={t(`Again at ${plus(cfg.morning, 1)}; you are told at ${plus(cfg.morning, 2)} if still not done.`, `${plus(cfg.morning, 1)}-এ আবার; ${plus(cfg.morning, 2)}-এও না হলে আপনাকে জানানো হবে।`)}>
            <Input type="time" value={cfg.morning} disabled={!cfg.on} onChange={e => setCfg({ ...cfg, morning: e.target.value })} />
          </Field>
          <Field label={t('Evening reminder (feed, medicine, expenses)', 'সন্ধ্যার মনে করানো (খাদ্য, ওষুধ, খরচ)')} hint={t(`Again at ${plus(cfg.evening, 1)}; you are told at ${plus(cfg.evening, 2)} if still not done.`, `${plus(cfg.evening, 1)}-এ আবার; ${plus(cfg.evening, 2)}-এও না হলে আপনাকে জানানো হবে।`)}>
            <Input type="time" value={cfg.evening} disabled={!cfg.on} onChange={e => setCfg({ ...cfg, evening: e.target.value })} />
          </Field>
        </div>
        <Alert>{t('Each staff phone turns reminders on once, from its own start screen. Reminders are not sent once the job is recorded.', 'প্রতিটি কর্মীর ফোনে নিজের শুরুর পাতা থেকে একবার চালু করতে হয়। কাজ লেখা হয়ে গেলে আর মনে করানো হয় না।')}</Alert>
        <div className="row">
          <button type="button" className="btn primary" disabled={save.isPending} onClick={() => save.mutate(cfg)}>{t('Save', 'সংরক্ষণ')}</button>
          <button type="button" className="btn" onClick={() => test().catch(e => toast(e.message, 'error'))}>{t('Send me a test', 'আমাকে পরীক্ষামূলক পাঠান')}</button>
        </div>
      </div>
    </Card>
  );
}
