// Backup copies that leave the farm's computer: the USB drive (BACKUP_COPY_DIR) and Google Drive
// (BACKUP_RCLONE_REMOTE, uploaded with rclone). Both are always encrypted with BACKUP_ENCRYPTION_KEY;
// without a usable key nothing leaves the computer. Problems here never stop the local backup.
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { backupDir, copyDir, keepDays } from './backup.js';
import { ENC_SUFFIX, encryptFile, keyProblem } from './backup-crypto.js';

export const ENC_NAME = /^farmledger-(\d{4})-(\d{2})-(\d{2})-\d{4}\.db\.enc$/;

export type Outcome = { state: 'ok' | 'off' | 'skipped-no-key' | 'failed'; detail?: string };
export interface OffsiteStatus { at: string; name: string; usb: Outcome; drive: Outcome }
interface Log { info: (msg: string) => void; error: (msg: string) => void }
type Runner = (args: string[]) => Promise<{ ok: boolean; output: string }>;

const STATUS_FILE = '.offsite-status.json';

export const rcloneRemote = () => process.env.BACKUP_RCLONE_REMOTE?.trim() || null;

/** Runs rclone with an argument list (never through a shell). */
const execRclone: Runner = args => new Promise(done => {
  execFile(process.env.BACKUP_RCLONE_BIN || 'rclone', args, { timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (e, stdout, stderr) => {
    if (!e) return done({ ok: true, output: String(stdout) });
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
    done({ ok: false, output: missing ? 'rclone not found' : (String(stderr).trim() || e.message).slice(-400) });
  });
});
let runRclone: Runner = execRclone;

/** For tests: replace the rclone runner; null puts the real one back. */
export function setRcloneRunner(fn: Runner | null) {
  runRclone = fn ?? execRclone;
}

/** The result of the last off-site run, or null if there has been none. */
export function readOffsiteStatus(): OffsiteStatus | null {
  try {
    return JSON.parse(readFileSync(join(backupDir(), STATUS_FILE), 'utf8')) as OffsiteStatus;
  } catch {
    return null;
  }
}

/**
 * Delete encrypted copies older than BACKUP_KEEP_DAYS (by the date in the name) from the USB folder,
 * always keeping the newest 7. Plain .db files and anything else are never touched.
 */
function pruneEncrypted(dir: string, log: Log) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - keepDays());
  for (const name of readdirSync(dir).filter(n => ENC_NAME.test(n)).sort().reverse().slice(7)) {
    const [, y, m, d] = ENC_NAME.exec(name)!;
    if (new Date(Number(y), Number(m) - 1, Number(d)) >= cutoff) continue;
    try {
      rmSync(join(dir, name));
    } catch (e) {
      log.error(`Could not delete old encrypted copy ${name}: ${(e as Error).message}`);
    }
  }
}

async function toUsb(temp: string, encName: string, log: Log): Promise<Outcome> {
  const dir = copyDir()!;
  const part = join(dir, `.${encName}.part`);
  try {
    mkdirSync(dir, { recursive: true });
    // Written under a hidden name first, so a drive pulled out mid-copy never leaves a file that looks like a backup.
    copyFileSync(temp, part);
    renameSync(part, join(dir, encName));
    pruneEncrypted(dir, log);
    log.info(`Encrypted backup copied to ${dir}`);
    return { state: 'ok' };
  } catch (e) {
    try { rmSync(part, { force: true }); } catch { /* the drive is gone */ }
    const detail = `Could not write to the USB folder (${dir}): ${(e as Error).message}`;
    log.error(detail);
    return { state: 'failed', detail };
  }
}

async function toDrive(temp: string, encName: string, log: Log): Promise<Outcome> {
  const remote = rcloneRemote()!;
  const up = await runRclone(['copyto', temp, `${remote}/${encName}`]);
  if (!up.ok) {
    const detail = `Google Drive upload failed: ${up.output}`;
    log.error(detail);
    return { state: 'failed', detail };
  }
  log.info(`Encrypted backup uploaded to ${remote}`);
  const prune = await runRclone(['delete', remote, '--min-age', `${keepDays()}d`, '--include', 'farmledger-*.db.enc']);
  if (!prune.ok) {
    const detail = `Uploaded, but old copies on Google Drive could not be removed: ${prune.output}`;
    log.error(detail);
    return { state: 'ok', detail };
  }
  return { state: 'ok' };
}

/** Send encrypted copies of a checked backup to the USB folder and Google Drive. Never throws. */
export async function sendOffsite(backupFile: string, log: Log, skipReason?: string): Promise<OffsiteStatus> {
  const name = basename(backupFile);
  const encName = `${name}${ENC_SUFFIX}`;
  const usbOn = Boolean(copyDir());
  const driveOn = Boolean(rcloneRemote());
  const status: OffsiteStatus = { at: new Date().toISOString(), name, usb: { state: 'off' }, drive: { state: 'off' } };
  const problem = keyProblem(process.env.BACKUP_ENCRYPTION_KEY);
  if ((usbOn || driveOn) && problem) {
    const skipped: Outcome = { state: 'skipped-no-key', detail: `${problem} No copy left this computer.` };
    if (usbOn) status.usb = skipped;
    if (driveOn) status.drive = skipped;
    log.error(`Backup copies were NOT sent off this computer: ${problem} Set BACKUP_ENCRYPTION_KEY (npm run backup:new-key).`);
  } else if ((usbOn || driveOn) && skipReason) {
    const failed: Outcome = { state: 'failed', detail: skipReason };
    if (usbOn) status.usb = failed;
    if (driveOn) status.drive = failed;
  } else if (usbOn || driveOn) {
    const temp = join(backupDir(), `.tmp-${randomBytes(6).toString('hex')}.db.enc`);
    try {
      await encryptFile(backupFile, temp, process.env.BACKUP_ENCRYPTION_KEY!);
      if (usbOn) status.usb = await toUsb(temp, encName, log);
      if (driveOn) status.drive = await toDrive(temp, encName, log).catch(e => ({ state: 'failed' as const, detail: `Google Drive upload failed: ${(e as Error).message}` }));
    } catch (e) {
      const failed: Outcome = { state: 'failed', detail: `The backup could not be encrypted: ${(e as Error).message}` };
      log.error(failed.detail!);
      if (usbOn && status.usb.state === 'off') status.usb = failed;
      if (driveOn && status.drive.state === 'off') status.drive = failed;
    } finally {
      rmSync(temp, { force: true });
    }
  }
  try {
    if (existsSync(backupDir())) writeFileSync(join(backupDir(), STATUS_FILE), JSON.stringify(status, null, 2));
  } catch (e) {
    log.error(`Could not record the off-site backup result: ${(e as Error).message}`);
  }
  return status;
}
