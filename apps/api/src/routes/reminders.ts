// Daily reminders: the owner/admin sets the times; each phone subscribes to notifications; staff can answer
// "none today" for feed, medicine or expenses so the evening job counts as done.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { actorOf, can } from '../auth/auth.js';
import { parse } from '../lib/validate.js';
import { farmYmd } from '../lib/farm-time.js';
import { audit } from '../services/common.js';
import { pushSender, reminderConfig, vapidKeys } from '../services/reminders.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 10:00.');

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
    for (const s of subs) await send({ userId: s.userId, endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth }, payload: { title: 'FarmLedger', body: 'Reminders work on this device.', url: '/' } });
    return { sent: subs.length };
  });

  app.get('/push/key', { preHandler: can() }, async () => ({ publicKey: vapidKeys().publicKey }));

  const subscription = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }) });
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

  app.post('/me/today/none', { preHandler: can() }, async req => {
    const { what } = parse(z.object({ what: z.enum(['feed', 'medicine', 'expenses']) }), req.body);
    const day = farmYmd();
    const slot = `none-${what}`;
    await prisma.reminderLog.upsert({ where: { day_slot: { day, slot } }, create: { day, slot, kind: 'none', userId: req.user!.id }, update: {} });
    return { ok: true };
  });
}
