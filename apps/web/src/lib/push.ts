// Installable app and phone reminders. The service worker (public/sw.js) is registered in production builds;
// reminders need the person's permission once, and on an iPhone FarmLedger must first be on the home screen.
import { api } from './api';

export function registerSW() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export type ReminderState = 'on' | 'off' | 'denied' | 'unsupported' | 'needs-install';

/** Where this device stands with reminders, without asking anything. */
export async function reminderState(): Promise<ReminderState> {
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

const keyBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};

/** Asks permission (once) and registers this device for the farm's reminders. */
export async function enableReminders(): Promise<ReminderState> {
  const before = await reminderState();
  if (before === 'needs-install' || before === 'unsupported' || before === 'denied') return before;
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const { publicKey } = await api.get<{ publicKey: string }>('/push/key');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api.post('/push/subscribe', sub.toJSON());
  return 'on';
}

export async function disableReminders() {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.del('/push/subscribe', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}
