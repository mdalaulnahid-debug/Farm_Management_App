// One chart component for the app's pages. On WiFi and 4G it shows the full charts (RichChart, Recharts),
// fetched just after the first screen so they never slow the first visit. In Lite mode, with the phone's
// data saver on, or on a 2G/3G line it keeps the light SVG chart from the design system, which also shows
// for the moment while the full charts load.
import { lazy, Suspense, useEffect, useState } from 'react';
import { ComboChart, type ChartSeries } from '@farmledger/design-system';
import { usePrefs } from '../../lib/i18n';

export interface ChartProps<T extends Record<string, any>> {
  data: T[]; xKey: keyof T & string; series: ChartSeries[];
  formatLeft?: (v: number) => string; formatRight?: (v: number) => string; rightDomain?: [number, number];
  format?: (v: number, s: ChartSeries) => string;
  leftWidth?: number;
}

const loadRich = () => import('./RichChart');
const RichChart = lazy(loadRich);

/** True on a slow line (2G/3G) or with data saver on. Browsers without this signal (e.g. iPhone Safari) count as fast. */
export function slowConnection() {
  const c = (navigator as any).connection;
  return !!c && (c.saveData || ['slow-2g', '2g', '3g'].includes(c.effectiveType));
}

export function Chart<T extends Record<string, any>>(props: ChartProps<T>) {
  const { lite } = usePrefs();
  const [slow, setSlow] = useState(slowConnection);
  useEffect(() => {
    const c = (navigator as any).connection;
    const on = () => setSlow(slowConnection());
    c?.addEventListener?.('change', on);
    return () => c?.removeEventListener?.('change', on);
  }, []);
  if (lite || slow) return <ComboChart {...props} />;
  return <Suspense fallback={<ComboChart {...props} />}><RichChart {...props} /></Suspense>;
}
