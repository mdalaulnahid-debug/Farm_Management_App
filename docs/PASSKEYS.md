# Passkeys: sign in with fingerprint, face or PIN

A passkey lets a person sign in to FarmLedger with one touch: the fingerprint reader or face unlock on their
phone, Windows Hello on a PC, or the device's own PIN. No password and no 6-digit code to type.

- **The device checks the fingerprint, face or PIN.** FarmLedger never sees it. The device only signs the
  sign-in with a key that never leaves it, and FarmLedger checks that signature.
- **Every passkey sign-in needs that check.** A device that skips it is refused.
- **Password plus the 2-step code keeps working.** It is the backup way in when a phone is lost or flat.
- **Works on** Android phones, iPhones, Windows PCs and laptops, and Macs, in a current browser.

## 1. Set the address first

A passkey belongs to one web address. If the address changes later, every passkey stops working and people
must add them again. So:

1. **Rename the address first**, if you plan to (for example the Tailscale machine name).
2. Then, on the server, set the final address in `apps/api/.env`:

   ```
   PASSKEY_ORIGIN=https://farm-name.your-tailnet.ts.net
   ```

   Use the exact address people type in the browser: `https://`, the full name, no `/` at the end. This is
   needed behind `tailscale serve`, because the server itself only sees `127.0.0.1`.
3. Restart FarmLedger.

Passkeys need HTTPS. On a plain `http://` address the sign-in page hides the passkey button and shows a short
note instead. (`http://localhost` also works, for development on the server itself.)

## 2. Add a passkey (each person, on each device)

1. Sign in as usual, with the password and the 2-step code.
2. Open **My settings → Password & security**.
3. **2-step sign-in must be on.** The Passkeys card says "Turn on 2-step sign-in first" until it is.
4. In **Passkeys (fingerprint, face, PIN)**, choose **Add a passkey on this device**, type the password, and
   touch the fingerprint reader, look at the camera or type the device PIN when the device asks.

Add one on each device the person uses: their own phone, their own laptop, and the office PC **only if
they sign in to Windows with their own account**.

> **Never add a passkey on a shared login.** The device only checks that whoever is unlocking it knows its
> fingerprint, face or PIN. On a Windows account several staff share, anyone who knows that PIN could sign in to
> FarmLedger as the person who added the passkey, with no password and no code. On a shared office PC, use the
> password and the 2-step code instead.

The list shows each passkey's name (guessed from the device, and it can be renamed), when it was added and when
it was last used.

Next time, on the sign-in page, choose **Sign in with fingerprint / face**.

## 3. Lost or replaced phone

- **The person still has another way in:** they sign in with the password and the 2-step code (or a printed
  recovery code), then remove the lost phone's passkey in **My settings → Password & security**.
- **They cannot sign in at all:** an admin opens **Admin → Users**, chooses the person and uses **Reset 2-step
  sign-in**. This also removes all their passkeys and signs them out everywhere. They sign in with their
  password and set up 2-step and passkeys again.
- **The owner is locked out:** use `reset-password.bat` on the server. It also turns off 2-step sign-in and
  removes the owner's passkeys.

Turning off 2-step sign-in yourself also removes your passkeys; the screen warns you first. A passkey only
exists while 2-step sign-in is on, so the backup way in always exists.

## 4. Synced passkeys

Google Password Manager and iCloud Keychain may copy a passkey to the same person's other phones or tablets.
That is allowed: it is the same person, the copy still needs that device's own fingerprint, face or PIN, and
Tailscale device approval still keeps out any device the owner has not approved.

## What is recorded

The activity log records each passkey added, renamed or removed, and each sign-in, marked "(passkey)". A failed
passkey check is recorded as a failed sign-in. It does not count toward the account lock, because a passkey
cannot be guessed.
