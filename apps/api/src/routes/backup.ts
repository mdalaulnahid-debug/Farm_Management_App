import type { FastifyInstance } from 'fastify';
import { createReadStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit } from '../services/common.js';
import { badRequest, notFound } from '../lib/errors.js';
import { today } from '../lib/dates.js';
import { actorOf, can } from '../auth/auth.js';
import { securityCheck } from '../services/security-check.js';
import { BACKUP_NAME, backupDir, backupPath, checkBackup, copyDir, isSqlite, keepDays, listBackups, runBackup } from '../services/backup.js';
import { keyProblem } from '../services/backup-crypto.js';
import { rcloneRemote, readOffsiteStatus } from '../services/offsite.js';

const sqliteOnly = () => {
  if (!isSqlite()) throw badRequest('Backups for PostgreSQL are taken with pg_dump / your hosting provider.');
};

export default async function backupRoutes(app: FastifyInstance) {
  // Consistent point-in-time copy of the whole database, streamed straight to the browser.
  app.get('/admin/backup', { preHandler: can('settings.manage') }, async (req, reply) => {
    sqliteOnly();
    const dir = mkdtempSync(join(tmpdir(), 'farmledger-'));
    const file = join(dir, 'backup.db');
    try {
      await prisma.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const data = readFileSync(file);
      await audit(prisma, actorOf(req), 'backup', 'settings', 'org', 'Downloaded a database backup');
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="farmledger-backup-${today()}.db"`);
      return reply.send(data);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Backups kept on this computer (automatic daily ones and "Back up now").
  app.get('/admin/backups', { preHandler: can('settings.manage') }, async () => {
    sqliteOnly();
    // Where copies leaving this computer go, and how the last run went. Never the key itself.
    const offsite = { usbDir: copyDir(), driveRemote: rcloneRemote(), keyProblem: keyProblem(process.env.BACKUP_ENCRYPTION_KEY), last: readOffsiteStatus() };
    return { data: listBackups(), dir: backupDir(), keepDays: keepDays(), copyDir: copyDir(), offsite };
  });

  app.post('/admin/backups', { preHandler: can('settings.manage') }, async req => {
    sqliteOnly();
    const b = await runBackup('manual', req.log);
    await audit(prisma, actorOf(req), 'backup', 'settings', b.name, `Took a manual database backup ${b.name}${b.check.ok ? ' (checked OK)' : ` that FAILED its check: ${b.check.problems.join(' ')}`}`);
    return b;
  });

  // Restore drill: open a backup on its own and check it would work as the farm's database.
  app.post('/admin/backups/:name/check', { preHandler: can('settings.manage') }, async req => {
    sqliteOnly();
    const r = z.object({ name: z.string().max(64).regex(BACKUP_NAME) }).safeParse(req.params);
    if (!r.success) throw badRequest('That is not a backup file name.');
    const file = backupPath(r.data.name);
    if (!file) throw notFound('Backup file');
    const check = await checkBackup(file);
    await audit(prisma, actorOf(req), 'backup', 'settings', r.data.name,
      `Checked backup ${r.data.name}: ${check.ok ? `OK (${check.counts.journalEntries} journal entries, books balance)` : `FAILED: ${check.problems.join(' ')}`}`);
    return check;
  });

  app.get('/admin/backups/:name', { preHandler: can('settings.manage') }, async (req, reply) => {
    sqliteOnly();
    // Strict name check: only our own backup files, never a path.
    const r = z.object({ name: z.string().max(64).regex(BACKUP_NAME) }).safeParse(req.params);
    if (!r.success) throw badRequest('That is not a backup file name.');
    const file = backupPath(r.data.name);
    if (!file) throw notFound('Backup file');
    await audit(prisma, actorOf(req), 'backup', 'settings', r.data.name, `Downloaded backup ${r.data.name}`);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${r.data.name}"`);
    return reply.send(createReadStream(file));
  });

  // Is this install set up the safe way (network, passwords, backups)? Read-only. Only for whoever
  // manages users (the owner by default), since it names accounts that still use a starting password.
  app.get('/admin/security-check', { preHandler: can('users.manage') }, async () => securityCheck(prisma));
}
