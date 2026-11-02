// The short wait between "password correct" and "code correct" during sign-in. The browser gets a
// one-time ticket instead of a session; only a right code within 5 minutes turns it into a session.
// Kept in memory: a server restart just means typing the password again.
import { randomBytes } from 'node:crypto';

const TICKET_MINUTES = 5;
/** Wrong codes allowed on one ticket before the password must be typed again. */
export const TICKET_ATTEMPTS = 5;

interface Ticket { userId: string; expires: number; attempts: number }
const tickets = new Map<string, Ticket>();

export function issueTicket(userId: string) {
  const now = Date.now();
  for (const [k, t] of tickets) if (t.expires < now || t.userId === userId) tickets.delete(k);
  const id = randomBytes(24).toString('base64url');
  tickets.set(id, { userId, expires: now + TICKET_MINUTES * 60_000, attempts: 0 });
  return id;
}

/**
 * Use one try of the ticket: the ticket if it is still valid, otherwise null. The try is counted at once,
 * before the code is checked, so guesses sent in parallel cannot all slip under the limit.
 */
export function useTicketAttempt(id: string) {
  const t = tickets.get(id);
  if (!t || t.expires < Date.now() || t.attempts >= TICKET_ATTEMPTS) {
    tickets.delete(id);
    return null;
  }
  t.attempts++;
  return t;
}

export const endTicket = (id: string) => tickets.delete(id);
