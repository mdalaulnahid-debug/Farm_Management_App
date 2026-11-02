# Security settings for the office VM

FarmLedger checks its own setup. On the server, double-click **security-check.bat** (or run
`npm run security:check -w apps/api`). The owner sees the same list in **Settings → Organization →
Security settings**. Each start-up also writes any problem to the server log. The check only reads; it
never changes a setting.

## Recommended settings

How people reach the app: through `tailscale serve` (HTTPS at `https://<vm-name>.<tailnet>.ts.net`), with
FarmLedger answering only inside the VM.

`apps/api/.env` on the VM:

```ini
HOST=127.0.0.1
PORT=4000
NODE_ENV=production
TRUST_PROXY=127.0.0.1
SESSION_HOURS=12
BACKUP_COPY_DIR=G:\My Drive\FarmLedger     # or a USB drive, e.g. E:\FarmLedger
# ADMIN_PASSWORD deleted after the first setup
```

Then, on the VM:

```bat
tailscale serve --bg 4000
```

Restart FarmLedger after changing `.env`, then run **security-check.bat** again. Every line should say OK.

### The order matters

1. Start `tailscale serve` first. Check that `https://<vm-name>.<tailnet>.ts.net` opens the sign-in page.
2. Set `TRUST_PROXY=127.0.0.1` and `HOST=127.0.0.1`, then restart.
   - After this, the old `http://<ip>:4000` address stops working. That is the point: everyone uses the
     HTTPS address.
3. Only then set `NODE_ENV=production`.
   - It marks the sign-in cookie HTTPS-only. Over plain HTTP, nobody could sign in. The check reports this
     as a problem if the order is wrong.

## What each check means

| Check | OK when | Why |
|---|---|---|
| HTTPS proxy | `TRUST_PROXY` set | Passwords never cross the office network unencrypted |
| Listen address | `HOST` is 127.0.0.1 or the VM's Tailscale address (100.x) | Nobody on the office network can reach the app without Tailscale, or skip HTTPS |
| Sign-in cookie | not `NODE_ENV=production` over plain HTTP | Otherwise no one can sign in |
| Starting password | nobody uses `ChangeMe!2026` or the `.env` `ADMIN_PASSWORD` | Those passwords are written in files |
| Password in .env | no `ADMIN_PASSWORD` line | Anyone who can read the file learns it |
| Owner accounts | 2 or more owners, none on a temporary password | A spare owner (password sealed in the office safe) can let the main owner back in |
| Sign-in lifetime | `SESSION_HOURS` 12 or less | A forgotten browser does not stay signed in for days |
| Recent backup | one in the last 2 days | FarmLedger takes one a day while running |
| Off-computer copy | `BACKUP_COPY_DIR` set and writable | A dead or stolen VM does not take the books with it |
| Audit trail | hash chain intact | Nobody edited the history behind the app's back |

## Also on the VM (not checked by the app)

- Windows Firewall: allow port 4000 only from localhost (or not at all, once `HOST=127.0.0.1`).
- Windows Update on; a standard (non-admin) Windows account runs FarmLedger.
- `apps/api/.env` and `apps/api/prisma/` readable only by that account and the administrators.
- Practise one restore with `restore-backup.bat` on a spare copy.
