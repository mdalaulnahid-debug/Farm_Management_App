// Security settings check from the server console: prints what is not set up safely and how to fix it.
// Read-only. Exit code 1 when there is a problem (not just a warning), so a deploy script can stop on it.
//   npm run security:check -w apps/api      (or double-click security-check.bat on the server)
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../db.js';
import { securityCheck } from '../services/security-check.js';

const MARK = { ok: 'OK     ', warn: 'WARNING', fail: 'PROBLEM' } as const;

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const r = await securityCheck(prisma);
    console.log('\nFarmLedger security check\n');
    for (const c of r.checks) {
      console.log(`  ${MARK[c.level]}  ${c.title.en}`);
      if (c.fix) console.log(`           -> ${c.fix.en}`);
    }
    const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
    console.log(`\n${n(r.failures, 'problem')}, ${n(r.warnings, 'warning')}.${r.failures ? ' Fix the problems before the farm team uses FarmLedger.' : ''}\n`);
    if (r.failures) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
