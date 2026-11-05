// Shown for an address that is not a page in FarmLedger (an old bookmark, a typo), instead of silently
// jumping to the dashboard.
import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { EmptyState } from '../components/ui';
import { useT } from '../lib/i18n';

export default function NotFound() {
  const t = useT();
  return (
    <div className="card">
      <EmptyState icon={SearchX} title={t('This page doesn’t exist', 'এই পাতাটি নেই')}
        body={t('The link may be old or mistyped. Everything in FarmLedger is reachable from the menu.', 'লিংকটি পুরোনো বা ভুল হতে পারে। ফার্মলেজারের সবকিছু মেনু থেকে পাওয়া যায়।')}
        action={<Link className="btn primary" to="/">{t('Go to the start page', 'শুরুর পাতায় যান')}</Link>} />
    </div>
  );
}
