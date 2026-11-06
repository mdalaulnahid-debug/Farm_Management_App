// Getting the 10:00 and 17:00 reminders on this phone: a short, picture-led card that explains the one step the
// phone needs (on iPhone: add FarmLedger to the home screen first), then asks permission. Hidden once it is on.
import { useEffect, useState } from 'react';
import { BellRing, Share, SquarePlus } from 'lucide-react';
import { useToast } from '../components/ui';
import { usePrefs } from '../lib/i18n';
import { enableReminders, reminderState, type ReminderState } from '../lib/push';

export function TurnOnReminders() {
  const { t } = usePrefs();
  const toast = useToast();
  const [state, setState] = useState<ReminderState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { reminderState().then(setState, () => setState('unsupported')); }, []);
  if (!state || state === 'on' || state === 'unsupported') return null;

  const turnOn = async () => {
    setBusy(true);
    try {
      const s = await enableReminders();
      setState(s);
      if (s === 'on') toast(t('Reminders are on for this phone.', 'এই ফোনে মনে করিয়ে দেওয়া চালু হয়েছে।'));
    } catch {
      toast(t('Could not turn on reminders. Try again later.', 'মনে করিয়ে দেওয়া চালু করা গেল না। পরে আবার চেষ্টা করুন।'), 'error');
    } finally { setBusy(false); }
  };

  return (
    <section className="card card-pad easy-remind">
      <span className="easy-remind-pic"><BellRing size={28} /></span>
      <div className="stack gap-6">
        <h2>{t('Get a reminder on this phone', 'এই ফোনে মনে করিয়ে দেওয়া পান')}</h2>
        {state === 'needs-install' ? <>
          <p>{t('On an iPhone, first put FarmLedger on the home screen:', 'আইফোনে আগে ফার্মলেজার হোম স্ক্রিনে রাখুন:')}</p>
          <ol className="steps">
            <li><Share size={18} />{t('Tap the Share button at the bottom of Safari.', 'সাফারির নিচের শেয়ার বোতামে চাপুন।')}</li>
            <li><SquarePlus size={18} />{t('Choose “Add to Home Screen”, then open FarmLedger from there.', '“Add to Home Screen” বেছে নিন, তারপর সেখান থেকে ফার্মলেজার খুলুন।')}</li>
          </ol>
        </> : state === 'denied' ? (
          <p>{t('Notifications are blocked for FarmLedger. Allow them in the phone’s settings (Site settings › Notifications), then come back.', 'ফার্মলেজারের নোটিফিকেশন বন্ধ আছে। ফোনের সেটিংসে (Site settings › Notifications) চালু করে আবার আসুন।')}</p>
        ) : <>
          <p>{t('The phone will remind you each morning to record the eggs and each evening for feed, medicine and expenses.', 'ফোন প্রতিদিন সকালে ডিম আর সন্ধ্যায় খাদ্য, ওষুধ ও খরচ লেখার কথা মনে করিয়ে দেবে।')}</p>
          <div><button type="button" className="btn primary lg" disabled={busy} onClick={turnOn}><BellRing size={20} />{t('Turn on reminders', 'মনে করিয়ে দেওয়া চালু করুন')}</button></div>
        </>}
      </div>
    </section>
  );
}
