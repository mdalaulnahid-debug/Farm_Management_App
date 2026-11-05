// A calm notice when the phone or computer loses its connection, so nobody thinks their entry was saved.
import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useT } from '../lib/i18n';

export function OfflineBanner() {
  const t = useT();
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!offline) return null;
  return (
    <div className="offline-banner" role="status">
      <WifiOff size={16} />
      <span>{t('No internet. You can look around, but nothing can be saved until the connection is back.', 'ইন্টারনেট নেই। দেখতে পারবেন, কিন্তু সংযোগ ফিরে না আসা পর্যন্ত কিছু সংরক্ষণ হবে না।')}</span>
    </div>
  );
}
