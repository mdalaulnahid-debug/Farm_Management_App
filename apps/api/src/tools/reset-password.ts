// Password reset from the server console, for when the owner (or anyone) is locked out.
// It only runs on the computer that holds the database; there is deliberately no web route for it.
//   npm run user:reset-password -w apps/api -- owner@farm.local
// (or double-click reset-password.bat on the farm PC).
import { randomInt } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma, tx } from '../db.js';
import { hashPassword } from '../auth/auth.js';
import { audit } from '../services/common.js';

// No look-alike characters (0/O, 1/l/I), so it can be read out over the phone.
const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
const DIGITS = '23456789';

/** e.g. "k7Pm-x3Rt-9wHa": letters and digits, so it passes the password rule. */
export function temporaryPassword() {
  for (;;) {
    const chars = Array.from({ length: 12 }, () => (LETTERS + DIGITS)[randomInt(LETTERS.length + DIGITS.length)]);
    const pw = [0, 4, 8].map(i => chars.slice(i, i + 4).join('')).join('-');
    if (/\d/.test(pw) && /[A-Za-z]/.test(pw)) return pw;
  }
}

/**
 * Give the user a new temporary password, unlock and re-enable the account, turn off 2-step sign-in
 * (for a lost phone) and end every sign-in.
 * They must choose their own password at the next sign-in. Returns null if no user has this email.
 */
export async function resetPasswordFromConsole(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, include: { role: true } });
  if (!user) return null;
  const temporary = temporaryPassword();
  const passwordHash = await hashPassword(temporary);
  const by = `${userInfo().username} on ${hostname()}`;
  await tx(async db => {
    await db.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null, active: true, totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: null } });
    await db.session.deleteMany({ where: { userId: user.id } });
    await audit(db, null, 'update', 'user', user.id, `Password reset from the server console for ${user.email} (by ${by})${user.totpEnabledAt ? '; 2-step sign-in was turned off' : ''}`);
  });
  return { user, temporary };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const email = process.argv[2];
  try {
    const result = email ? await resetPasswordFromConsole(email) : null;
    if (!result) {
      const owners = await prisma.user.findMany({ where: { role: { key: 'owner' } }, select: { email: true } });
      console.error(email ? `No user with the email ${email}.` : 'Give the email of the account to reset.');
      console.error(`Owner accounts: ${owners.map(o => o.email).join(', ') || '(none)'}`);
      process.exitCode = 1;
    } else {
      console.log(`\nPassword reset for ${result.user.name} <${result.user.email}> (${result.user.role.name}).`);
      console.log(`Temporary password:  ${result.temporary}`);
      console.log('Sign in with it now; FarmLedger will ask for a new password. All old sign-ins were ended.');
      if (result.user.totpEnabledAt) console.log('2-step sign-in was turned off (lost phone): set it up again in My settings → Password & security.');
      console.log('');
    }
  } finally {
    await prisma.$disconnect();
  }
}
