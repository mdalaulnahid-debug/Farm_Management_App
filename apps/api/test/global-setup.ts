import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Fresh throwaway database for every run (prisma/test.db); the prisma CLI is invoked through node directly.
export default function setup() {
  const dbFile = fileURLToPath(new URL('../prisma/test.db', import.meta.url));
  rmSync(dbFile, { force: true });
  rmSync(`${dbFile}-journal`, { force: true });
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [cli, 'db', 'push', '--skip-generate'], {
    env: { ...process.env, DATABASE_URL: 'file:./test.db', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });
}
