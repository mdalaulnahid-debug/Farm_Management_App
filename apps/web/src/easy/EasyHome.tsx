// The simple workspace: for staff who are not at home with computers. A greeting, today's checklist, four big
// picture buttons for the everyday jobs, and what this person recorded today (with Fix until midnight).
// Data-entry staff get it automatically; anyone can switch it on in My settings › Start-up.
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { fmtLongDate } from '../lib/format';
import { usePrefs } from '../lib/i18n';
import { BoughtFlow, EggsFlow, EveningFlow, SaleFlow } from './flows';
import { RecordedToday } from './RecordedToday';
import { TodayChecklist } from './TodayChecklist';
import { TurnOnReminders } from './TurnOnReminders';
import { Pic, type Flow } from './shared';

export default function EasyHome() {
  const { t, lang } = usePrefs();
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const flow = params.get('flow') as Flow | null;
  const open = (f: Flow) => setParams({ flow: f });
  const close = () => setParams({});
  const hour = new Date().getHours();
  const hello = hour < 12 ? t('Good morning', 'শুভ সকাল') : hour < 17 ? t('Good afternoon', 'শুভ অপরাহ্ন') : t('Good evening', 'শুভ সন্ধ্যা');

  if (flow === 'eggs') return <EggsFlow onClose={close} />;
  if (flow === 'evening') return <EveningFlow onClose={close} />;
  if (flow === 'sale') return <SaleFlow onClose={close} />;
  if (flow === 'bought') return <BoughtFlow onClose={close} />;

  const jobs: { flow: Flow; label: string; sub: string; pic: Parameters<typeof Pic>[0]['name'] }[] = [
    { flow: 'eggs', label: t('Eggs collected', 'ডিম সংগ্রহ'), sub: t('Morning count', 'সকালের গণনা'), pic: 'eggs' },
    { flow: 'sale', label: t('Sale & money received', 'বিক্রি ও টাকা আদায়'), sub: t('Eggs, ducks, old dues', 'ডিম, হাঁস, আগের বাকি'), pic: 'sale' },
    { flow: 'bought', label: t('Bought feed / medicine', 'খাদ্য / ওষুধ কেনা'), sub: t('Paid now or on credit', 'এখন বা বাকিতে'), pic: 'bought' },
    { flow: 'evening', label: t('Deaths & feed used', 'মৃত্যু ও খাদ্য'), sub: t('Evening entries', 'সন্ধ্যার হিসাব'), pic: 'deaths' },
  ];

  return (
    <div className="easy">
      <header className="easy-hello">
        <small>{fmtLongDate(new Date(), lang)}</small>
        <h1>{hello}, {me?.user.name.split(' ')[0]}</h1>
        <p>{t('What do you want to record?', 'কী লিখতে চান?')}</p>
      </header>
      <div className="easy-jobs">
        {jobs.map(j => (
          <button key={j.flow} type="button" className="easy-job" onClick={() => open(j.flow)}>
            <span className="easy-job-pic"><Pic name={j.pic} size={40} /></span>
            <b>{j.label}</b>
            <small>{j.sub}</small>
          </button>
        ))}
      </div>
      <TodayChecklist onOpen={open} />
      <RecordedToday onReenter={open} />
      <TurnOnReminders />
    </div>
  );
}
