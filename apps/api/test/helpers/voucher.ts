// Tests that make bills or payments out (spending) need a voucher, as the owner's rule requires. `withVoucher`
// adds a matching one (amount = the record's total, one small JPEG) unless the payload already has one or says
// `voucher: null`, which the voucher-rule tests use to check the refusal.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
export const testVoucherPhoto = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
const r2 = (v: number) => Math.round(v * 100) / 100;

export function withVoucher(method: string, url: string, payload: any) {
  if (method !== 'POST' || !payload || typeof payload !== 'object' || 'voucher' in payload) return payload;
  const path = url.replace(/^\/api\/v1/, '').split('?')[0];
  let total: number | null = null;
  if (path === '/bills') total = r2((payload.lines ?? []).reduce((a: number, l: any) => a + r2(Number(l.quantity) * Number(l.unitPrice ?? 0)), 0));
  else if (path === '/payments' && payload.direction === 'OUT') total = r2(Number(payload.amount));
  if (total === null) return payload;
  return { ...payload, voucher: { number: 'T-1', date: payload.date, amount: total, photos: [testVoucherPhoto] } };
}
