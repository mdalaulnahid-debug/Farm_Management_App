// Daily reminders: the owner/admin sets the times; each phone subscribes to notifications; staff can answer
// "none today" for feed, medicine or expenses so the evening job counts as done.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { actorOf, can } from '../auth/auth.js';
import { parse } from '../lib/validate.js';
import { farmYmd } from '../lib/farm-time.js';
import { audit } from '../services/common.js';
import { forbidden } from '../lib/errors.js';
import { isPushEndpoint, NONE_ITEMS, pushSender, reminderConfig, vapidKeys } from '../services/reminders.js';

// Reminder times end by 21:59 so the second reminder and the owner's (+1 h, +2 h) stay on the same farm day.
const hhmm = z.string().regex(/^([01]\d|2[01]):[0-5]\d$/, 'Use a time between 00:00 and 21:59, like 10:00.');

export default async function reminderRoutes(app: FastifyInstance) {
  app.get('/settings/reminders', { preHandler: can('settings.manage') }, async () => reminderConfig(prisma));

  app.put('/settings/reminders', { preHandler: can('settings.manage') }, async req => {
    const body = parse(z.object({ on: z.boolean(), morning: hhmm, evening: hhmm }), req.body);
    await prisma.organization.update({ where: { id: 'org' }, data: { remindersOn: body.on, reminderMorning: body.morning, reminderEvening: body.evening } });
    await audit(prisma, actorOf(req), 'update', 'organization', 'org', `Daily reminders ${body.on ? `on at ${body.morning} and ${body.evening}` : 'off'}`);
    return { ok: true };
  });

  /** Sends a test notification to the signed-in person's own phones. */
  app.post('/settings/reminders/test', { preHandler: can('settings.manage') }, async req => {
    const subs = await prisma.pushSubscription.findMany({ where: { userId: req.user!.id } });
    const send = pushSender(prisma);
    let sent = 0;
    for (const s of subs) {
      try { await send({ userId: s.userId, endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth }, payload: { title: 'FarmLedger', body: 'Reminders work on this device.', url: '/' } }); sent++; }
      catch (e) { req.log.error(`Test reminder to one phone failed: ${(e as Error).message}`); }
    }
    return { sent, phones: subs.length };
  });

  app.get('/push/key', { preHandler: can() }, async () => ({ publicKey: (await vapidKeys(prisma)).publicKey }));

  const subscription = z.object({ endpoint: z.string().url().max(1000).refine(isPushEndpoint, 'Not a browser push service address.'), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }) });
  app.post('/push/subscribe', { preHandler: can() }, async req => {
    const body = parse(subscription, req.body);
    const data = { userId: req.user!.id, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) };
    await prisma.pushSubscription.upsert({ where: { endpoint: body.endpoint }, create: { endpoint: body.endpoint, ...data }, update: data });
    return { ok: true };
  });
  app.delete('/push/subscribe', { preHandler: can() }, async req => {
    const body = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
    await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: req.user!.id } });
    return { ok: true };
  });

  // Data-entry staff only: feed and medicine need production rights, expenses need purchase rights. Audited.
  app.post('/me/today/none', {
    preHandler: async (req, reply) => {
      await can()(req, reply);
      const p = req.user!.permissions as readonly string[];
      if (!p.includes('production.manage') && !p.includes('purchases.create') && !p.includes('sales.create')) throw forbidden();
    },
  }, async req => {
    const { what } = parse(z.object({ what: z.enum(NONE_ITEMS) }), req.body);
    const perms = req.user!.permissions as readonly string[];
    if (!perms.includes(what === 'expenses' ? 'purchases.create' : what === 'sales' ? 'sales.create' : 'production.manage')) throw forbidden();
    const day = farmYmd();
    const slot = `none-${what}`;
    const existing = await prisma.reminderLog.findUnique({ where: { day_slot: { day, slot } } });
    if (!existing) {
      await prisma.reminderLog.create({ data: { day, slot, kind: 'none', userId: req.user!.id } });
      await audit(prisma, actorOf(req), 'update', 'reminder', slot, `Marked no ${what} today (${day})`);
    }
    return { ok: true };
  });
}
