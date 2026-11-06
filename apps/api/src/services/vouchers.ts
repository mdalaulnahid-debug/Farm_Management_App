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

export type OwnerType = 'PAYMENT' | 'BILL';
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

/** Store one checked photo on a record and audit it. */
export async function addPhoto(db: Db, actor: Actor | null, ownerType: OwnerType, owner: { id: string; number: string }, photo: ReturnType<typeof decodePhoto>) {
  if (await db.attachment.count({ where: { ownerType, ownerId: owner.id, removedAt: null } }) >= PHOTOS_PER_RECORD) throw badRequest(`At most ${PHOTOS_PER_RECORD} photos per record.`);
  const made = await db.attachment.create({
    data: { ownerType, ownerId: owner.id, mime: photo.mime, size: photo.bytes.length, sha256: photo.sha256, data: photo.bytes, createdById: actor?.id ?? null },
    select: { id: true, mime: true, size: true, createdAt: true, createdById: true },
  });
  await audit(db, actor, 'ATTACH', ownerType, owner.id, `Photo added to ${owner.number}`, { attachmentId: made.id, size: made.size, sha256: photo.sha256 });
  return made;
}

/** Save the voucher of a new bill or payment out, inside the same transaction as the record, so a record never
 *  exists without its voucher. Refuses (and so undoes the record) when the amounts differ. */
export async function saveVoucher(db: Db, actor: Actor | null, ownerType: OwnerType, owner: { id: string; number: string; total: number }, v: VoucherInput) {
  const amount = money(v.amount);
  if (Math.abs(amount - money(owner.total)) > TOLERANCE) {
    throw badRequest(`The voucher says ৳${amount.toLocaleString('en-IN')} but the entry is ৳${money(owner.total).toLocaleString('en-IN')}. Correct the entry or the voucher amount so they match.`);
  }
  const photos = v.photos.map(decodePhoto);
  for (const p of photos) await addPhoto(db, actor, ownerType, owner, p);
  await db.voucher.create({ data: { ownerType, ownerId: owner.id, number: v.number ?? null, date: v.date, amount, createdById: actor?.id ?? null } });
  await audit(db, actor, 'create', 'voucher', owner.id, `Voucher${v.number ? ` ${v.number}` : ''} for ${owner.number}: ${amount}`);
}

/** Missing voucher on a money-out record: the plain message staff see. */
export const voucherMissing = () => badRequest('Attach the photo of the real voucher, and write its amount as on the paper. Spending cannot be saved without it.');
