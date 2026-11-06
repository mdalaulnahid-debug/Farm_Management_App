// The owner's rule (6 Nov 2026): "no expense or spendings can be passed through the site without the real voucher
// of the spending and the voucher must match the app spending".
// Every bill or expense and every payment out of the farm's cash, bank or mobile accounts is saved together with
// its voucher: at least one photo of the paper, and the number, date and amount as written on it. The amount must
// equal the entry, or nothing is saved. The owner or accountant then checks each voucher against its entry.
// Exempt: transfers between the farm's own accounts (not spending), imports of past records, and voids.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { money } from '../lib/money.js';
import { zDate, zMoney, zOptText } from '../lib/validate.js';
import { audit, type Actor } from './common.js';

export type OwnerType = 'PAYMENT' | 'BILL' | 'JOURNAL';
/** How many days before the entry the voucher's own date may be (a slip written a few days earlier). */
export const BACKDATE_DAYS = Number(process.env.VOUCHER_BACKDATE_DAYS || 30);
/** Photo uploads per person per minute, across every form. */
export const UPLOADS_PER_MINUTE = 20;

const recent = new Map<string, number[]>();
/** Count `n` photo uploads for a person; refuses when that passes the per-minute limit. */
export function photoRateLimit(userId: string | undefined, n = 1, now = Date.now()) {
  if (!userId) return;
  const times = (recent.get(userId) ?? []).filter(t => now - t < 60_000);
  if (times.length + n > UPLOADS_PER_MINUTE) { recent.set(userId, times); throw badRequest(`Too many photos at once. Wait a minute (${UPLOADS_PER_MINUTE} per minute at most).`); }
  for (let i = 0; i < n; i++) times.push(now);
  recent.set(userId, times);
}

/** Is the record behind a voucher or photo still live (not void)? */
export async function isLive(db: Db, ownerType: string, ownerId: string) {
  const r = ownerType === 'BILL' ? await db.bill.findUnique({ where: { id: ownerId }, select: { status: true } })
    : ownerType === 'PAYMENT' ? await db.payment.findUnique({ where: { id: ownerId }, select: { status: true } })
    : await db.journalEntry.findUnique({ where: { id: ownerId }, select: { status: true } });
  return !!r && r.status !== 'VOID';
}

/** The go-live date of the voucher rule (VOUCHER_RULE_FROM, else the date stored on first start), or null. */
export async function voucherRuleFrom(db: Db): Promise<Date | null> {
  if (process.env.VOUCHER_RULE_FROM) return new Date(`${process.env.VOUCHER_RULE_FROM.slice(0, 10)}T00:00:00Z`);
  return (await db.organization.findUnique({ where: { id: 'org' }, select: { voucherRuleFrom: true } }))?.voucherRuleFrom ?? null;
}
/** Start-up, once: remember today (Bangladesh) as the go-live date if none is set. */
export async function ensureVoucherRuleFrom(db: Db, today: string) {
  const org = await db.organization.findUnique({ where: { id: 'org' }, select: { voucherRuleFrom: true } });
  if (org && !org.voucherRuleFrom && !process.env.VOUCHER_RULE_FROM) await db.organization.update({ where: { id: 'org' }, data: { voucherRuleFrom: new Date(`${today}T00:00:00Z`) } });
}
/** Imports of past records stop at the go-live date: anything newer must be entered with its voucher. */
export async function importCutoffError(db: Db, latest: Date | null) {
  const from = await voucherRuleFrom(db);
  if (!from || !latest || latest < from) return null;
  return `Records dated ${from.toISOString().slice(0, 10)} or later cannot be imported as past records. Enter them in FarmLedger with their vouchers.`;
}
/** Phones send about 100–400 KB (1600 px JPEG); 1.5 MB leaves room for a PNG from a computer. */
export const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;
export const PHOTOS_PER_RECORD = 10;
/** Paisa rounding between "total ÷ quantity" and the line amount is the only difference allowed. */
const TOLERANCE = 0.011;

/** The voucher as sent with a new bill or payment out. */
export const zVoucher = z.object({
  number: zOptText(40),
  date: zDate,
  amount: zMoney,
  photos: z.array(z.string().max(2.1 * 1024 * 1024)).min(1, 'Attach the photo of the voucher.').max(3),
});
export type VoucherInput = z.infer<typeof zVoucher>;

/** The image type from its first bytes, so a file is what it says it is. */
function sniff(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** A photo sent as a data URL, checked: a real JPEG/PNG/WebP of the type it claims, at most 1.5 MB. */
export function decodePhoto(dataUrl: string) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw badRequest('Send a JPEG, PNG or WebP photo.');
  const bytes = Buffer.from(m[2], 'base64');
  const mime = sniff(bytes);
  if (!mime || mime !== m[1]) throw badRequest('That file is not a photo.');
  if (bytes.length > MAX_PHOTO_BYTES) throw badRequest('The photo is too large (1.5 MB at most).');
  return { mime, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Store one checked photo on a record and audit it. `isVoucher` marks the photos the record was saved with. */
export async function addPhoto(db: Db, actor: Actor | null, ownerType: OwnerType, owner: { id: string; number: string }, photo: ReturnType<typeof decodePhoto>, isVoucher = false) {
  if (await db.attachment.count({ where: { ownerType, ownerId: owner.id, removedAt: null } }) >= PHOTOS_PER_RECORD) throw badRequest(`At most ${PHOTOS_PER_RECORD} photos per record.`);
  const made = await db.attachment.create({
    data: { ownerType, ownerId: owner.id, mime: photo.mime, size: photo.bytes.length, sha256: photo.sha256, isVoucher, data: photo.bytes, createdById: actor?.id ?? null },
    select: { id: true, mime: true, size: true, createdAt: true, createdById: true },
  });
  await audit(db, actor, 'ATTACH', ownerType, owner.id, `Photo added to ${owner.number}`, { attachmentId: made.id, size: made.size, sha256: photo.sha256 });
  return made;
}

/** Save the voucher of a new spending record, inside the same transaction as the record, so a record never exists
 *  without its voucher. Refuses (and so undoes the record) when the amount or date does not match, or when the
 *  voucher was already used: the same photo, or the same number with the same supplier, on another live record. */
export async function saveVoucher(db: Db, actor: Actor | null, ownerType: OwnerType,
  owner: { id: string; number: string; total: number; date: Date; partyId?: string | null }, v: VoucherInput) {
  const amount = money(v.amount);
  if (Math.abs(amount - money(owner.total)) > TOLERANCE) {
    throw badRequest(`The voucher says ৳${amount.toLocaleString('en-IN')} but the entry is ৳${money(owner.total).toLocaleString('en-IN')}. Correct the entry or the voucher amount so they match.`);
  }
  const day = (d: Date) => Math.floor(d.getTime() / 86_400_000);
  if (day(v.date) > day(owner.date)) throw badRequest('The voucher is dated after the entry. Enter the spending on the voucher’s date.');
  if (day(owner.date) - day(v.date) > BACKDATE_DAYS) throw badRequest(`The voucher is more than ${BACKDATE_DAYS} days older than the entry. The dates must match.`);
  photoRateLimit(actor?.id, v.photos.length);
  const photos = v.photos.map(decodePhoto);
  for (const p of photos) {
    const used = await db.attachment.findMany({ where: { sha256: p.sha256, removedAt: null, NOT: { ownerId: owner.id } }, select: { ownerType: true, ownerId: true } });
    for (const u of used) if (await isLive(db, u.ownerType, u.ownerId)) throw badRequest('This voucher photo is already used on another entry. Each voucher can be used once.');
  }
  const number = v.number?.trim() || null;
  if (number && owner.partyId) {
    const same = await db.voucher.findMany({ where: { partyId: owner.partyId, number, NOT: { ownerId: owner.id } }, select: { ownerType: true, ownerId: true } });
    for (const u of same) if (await isLive(db, u.ownerType, u.ownerId)) throw badRequest(`Voucher no. ${number} from this supplier is already entered. Each voucher can be used once.`);
  }
  for (const p of photos) await addPhoto(db, actor, ownerType, owner, p, true);
  await db.voucher.create({ data: { ownerType, ownerId: owner.id, partyId: owner.partyId ?? null, number, date: v.date, amount, createdById: actor?.id ?? null } });
  await audit(db, actor, 'create', 'voucher', owner.id, `Voucher${v.number ? ` ${v.number}` : ''} for ${owner.number}: ${amount}`);
}

/** Missing voucher on a money-out record: the plain message staff see. */
export const voucherMissing = () => badRequest('Attach the photo of the real voucher, and write its amount as on the paper. Spending cannot be saved without it.');
