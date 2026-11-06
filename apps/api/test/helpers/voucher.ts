// Tests that make spending (bills, payments out, journals paying money out, side-project transfers out) need a
// voucher, as the owner's rule requires. `withVoucher` adds a matching one: amount = the money spent, the entry's
// date, a unique small JPEG and a unique number (a voucher can be used only once). A payload that already has
// `voucher` (even null) is left alone, so the voucher-rule tests can check refusals.
import { prisma } from '../../src/db.js';

let n = 0;
/** A small JPEG that is different every time (so its SHA-256 is never reused). */
export function uniquePhoto() {
  const body = Buffer.alloc(64, 7);
  body.writeUInt32BE(++n, 0);
  body.writeUInt32BE(Date.now() % 0xffffffff, 4);
  return `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), body]).toString('base64')}`;
}
/** Kept for older tests: one fixed photo (use only once per database). */
export const testVoucherPhoto = uniquePhoto();
const r2 = (v: number) => Math.round(v * 100) / 100;

async function journalMoneyOut(lines: { accountId: string; debit?: number; credit?: number }[]) {
  const accounts = await prisma.account.findMany({ where: { id: { in: lines.map(l => l.accountId) } }, select: { id: true, subtype: true } });
  const money = (id: string) => ['CASH', 'BANK'].includes(accounts.find(a => a.id === id)?.subtype ?? '');
  const out = r2(lines.filter(l => money(l.accountId)).reduce((a, l) => a + Number(l.credit ?? 0) - Number(l.debit ?? 0), 0));
  return out > 0 && lines.some(l => !money(l.accountId) && Number(l.debit ?? 0) > 0) ? out : 0;
}

export async function withVoucher(method: string, url: string, payload: any) {
  if (method !== 'POST' || !payload || typeof payload !== 'object' || 'voucher' in payload) return payload;
  const path = url.replace(/^\/api\/v1/, '').split('?')[0];
  let total = 0;
  if (path === '/bills') total = r2((payload.lines ?? []).reduce((a: number, l: any) => a + r2(Number(l.quantity) * Number(l.unitPrice ?? 0)), 0));
  else if ((path === '/payments' || path === '/project-transfers') && payload.direction === 'OUT') total = r2(Number(payload.amount));
  else if (path === '/journals' && !payload.opening && Array.isArray(payload.lines)) total = await journalMoneyOut(payload.lines);
  else return payload;
  if (path !== '/bills' && !(total > 0)) return payload;
  return { ...payload, voucher: { number: `T-${++n}`, date: payload.date, amount: total, photos: [uniquePhoto()] } };
}
