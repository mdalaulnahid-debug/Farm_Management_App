# Security settings

FarmLedger checks its own setup. The check only reads; it never changes a setting.

- **On the server:** run `npm run security:check -w apps/api`, or double-click **security-check.bat** on Windows. It exits with code 1 when it finds a problem.
- **In the app:** the owner sees the same list in **Settings → Organization → Security settings**.
- **At start-up:** any problem is written to the server log.

## Recommended setup: Linux VM with Tailscale

People reach FarmLedger only through `tailscale serve` (`https://<vm-name>.<tailnet>.ts.net`). FarmLedger itself
answers only inside the VM. Every phone and PC that uses it needs the Tailscale app, signed in to the tailnet.

Make sure that is true **before step 2**, because step 2 closes the plain `http://<address>:4000` addresses.

Run the check after each restart.

1. **Remove the starting password.** Delete the `ADMIN_PASSWORD` line from `.env`, along with any file the
   setup left holding the starting password.
2. **HTTPS only.** Set `HOST=127.0.0.1` and `TRUST_PROXY=127.0.0.1`, then restart the service.
   - Check that the HTTPS address still signs in. The `:4000` addresses now stop answering. That is intended.
   - If a deploy script health-checks the app, it must call `127.0.0.1:4000`.
3. **Secure cookie.** Set `NODE_ENV=production`, restart, and sign in again over HTTPS.
   - Never do this before step 2. Over plain HTTP nobody could sign in, and the check reports that as a problem.
4. **A backup copy off the host PC.** A VM's disk lives on its host PC, so a copy inside the VM, or on that PC,
   dies with it.
   - Mount a USB drive in the VM, writable by the service account.
   - Set `BACKUP_COPY_DIR` to a folder on it, then restart.
5. **Firewall (ufw).** Allow ports 443 (`tailscale serve`) and 22 (SSH) only on `tailscale0`, and deny everything
   else incoming, including 4000. Before you start, check that SSH works over Tailscale and that you have a
   console way back in.
   ```sh
   sudo ufw status verbose
   sudo ufw default deny incoming
   sudo ufw allow in on tailscale0 to any port 443 proto tcp
   sudo ufw allow in on tailscale0 to any port 22 proto tcp
   sudo ufw delete allow 22/tcp          # only if a rule open to every network exists
   sudo ufw deny 4000/tcp
   sudo ufw status verbose
   ```
6. **Spare owner account.** Add one (Users → Add user, role Owner) and seal its password in the office safe.

The setup is done when every line of the check says OK.

## What each check means

| Check | OK when | Why it matters |
|---|---|---|
| HTTPS proxy | `TRUST_PROXY` is set | Passwords never cross the office network unencrypted |
| Listen address | `HOST` is 127.0.0.1, or the Tailscale address (100.x) | Nobody on the office network can reach the app or skip HTTPS |
| Sign-in cookie | `NODE_ENV=production` is not used over plain HTTP | Otherwise no one can sign in |
| Starting password | Nobody uses `ChangeMe!2026` or the `.env` `ADMIN_PASSWORD` | Those passwords are written in files |
| Password in .env | There is no `ADMIN_PASSWORD` line | Anyone who can read the file learns it |
| Owner accounts | 2 or more owners, none on a temporary password | A spare owner can let the main owner back in |
| Sign-in lifetime | `SESSION_HOURS` is 12 or less | A forgotten browser does not stay signed in for days |
| Recent backup | There is a backup from the last 2 days | FarmLedger takes one a day while running |
| Off-computer copy | `BACKUP_COPY_DIR` is set and writable | A dead or stolen PC does not take the books with it |
| Audit trail | The hash chain is intact | Nobody edited the history behind the app's back |

The app does **not** check the firewall, SSH, or leftover password files. Steps 1 and 5 cover them.

## Single Windows PC

Use the same `.env` settings, run `tailscale serve --bg 4000`, and point `BACKUP_COPY_DIR` at a USB drive (for example
`E:\FarmLedger`). Run `security-check.bat`, and block port 4000 in Windows Firewall.
