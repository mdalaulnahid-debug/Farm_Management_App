// Mobile numbers as the API reads them: Bangla digits, spaces, dashes and +880/880 all become 01XXXXXXXXX.
// A buyer is known by this number; it stays their identity even if the name is typed differently.
const BN = '০১২৩৪৫৬৭৮৯';
export function normalizePhone(raw: string | null | undefined): string {
  let d = (raw ?? '').replace(/[০-৯]/g, c => String(BN.indexOf(c))).replace(/\D/g, '');
  if (d.startsWith('880')) d = d.slice(2);
  else if (d.length === 10 && d.startsWith('1')) d = `0${d}`;
  return d;
}
/** 11 digits starting 01. */
export const isMobile = (raw: string | null | undefined) => /^01\d{9}$/.test(normalizePhone(raw));
