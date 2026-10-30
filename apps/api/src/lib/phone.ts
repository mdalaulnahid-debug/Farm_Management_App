// Phone numbers are matched in one canonical form so a customer is recognised however the number was typed:
// Bangla digits, spaces, dashes and a +880/880 prefix all normalise to 01XXXXXXXXX.
const BN = '০১২৩৪৫৬৭৮৯';

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[০-৯]/g, c => String(BN.indexOf(c))).replace(/\D/g, '');
  if (d.startsWith('880')) d = d.slice(2);
  else if (d.length === 10 && d.startsWith('1')) d = `0${d}`;
  return d || null;
}
