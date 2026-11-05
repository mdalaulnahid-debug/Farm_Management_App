import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { AppError } from './lib/errors.js';
import { loadUser } from './auth/auth.js';
import authRoutes from './routes/auth.js';
import passkeyRoutes from './routes/passkeys.js';
import masterRoutes from './routes/master.js';
import transactionRoutes from './routes/transactions.js';
import reportRoutes from './routes/reports.js';
import importRoutes from './routes/import.js';
import projectRoutes from './routes/projects.js';
import backupRoutes from './routes/backup.js';
import myDayRoutes from './routes/my-day.js';
import reminderRoutes from './routes/reminders.js';
import { startReminderScheduler } from './services/reminders.js';
import { ensureReferenceData } from './services/reference.js';
import { startBackupScheduler } from './services/backup.js';
import { sealAudit } from './services/audit-chain.js';
import { securityCheck } from './services/security-check.js';
import { buildRedirectApp } from './lib/https-redirect.js';

/**
 * Which proxy may tell us the client's address and whether the browser used HTTPS (X-Forwarded-*).
 * Unset: none, the address is taken from the connection, so a client cannot fake it to dodge the
 * login limit. Behind `tailscale serve` or Caddy on the same machine set TRUST_PROXY=127.0.0.1.
 */
export function trustProxySetting(value = process.env.TRUST_PROXY): false | string {
  const v = (value ?? '').trim();
  if (!v || v === 'false') return false;
  if (v === 'true') throw new Error('TRUST_PROXY=true would trust any client. Set it to the proxy address, e.g. 127.0.0.1.');
  return v.split(',').map(s => s.trim()).filter(Boolean).join(',');
}

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info') },
    trustProxy: trustProxySetting(),
    bodyLimit: 1_000_000,
  });

  // Decimal columns are sent to the client as plain numbers.
  app.setReplySerializer(payload =>
    JSON.stringify(payload, function (this: any, key, value) {
      const raw = key === '' ? value : this[key];
      return raw instanceof Prisma.Decimal ? raw.toNumber() : value;
    }),
  );

  // Only the app's own scripts may run. No upgrade-insecure-requests: the office address is plain HTTP.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: 'REQUEST_ERROR', message: err.message });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return reply.status(409).send({ error: 'CONFLICT', message: 'A record with these details already exists.' });
    req.log.error(err);
    return reply.status(500).send({ error: 'SERVER_ERROR', message: 'Something went wrong on the server. The action was not saved.' });
  });

  await app.register(async api => {
    api.addHook('onRequest', async req => loadUser(req));
    api.get('/health', async () => ({ ok: true, time: new Date().toISOString() }));
    await api.register(authRoutes);
    await api.register(passkeyRoutes);
    await api.register(masterRoutes);
    await api.register(transactionRoutes);
    await api.register(reportRoutes);
    await api.register(importRoutes);
    await api.register(projectRoutes);
    await api.register(backupRoutes);
    await api.register(myDayRoutes);
    await api.register(reminderRoutes);
  }, { prefix: '/api/v1' });

  // In production the API also serves the built web app.
  const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      cacheControl: false,
      // Hashed bundles never change; index.html must always be revalidated so new releases load.
      setHeaders: (res, path) => res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/assets/')) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Not found.' });
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => prisma.$disconnect());
  return app;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await ensureReferenceData();
  const app = await buildApp();
  const port = Number(process.env.PORT || 4000);
  await app.listen({ port, host: process.env.HOST || '0.0.0.0' });
  // Plain-http visits behind `tailscale serve --http=80` are sent on to https. Never serves the app itself.
  const redirectPort = Number(process.env.HTTPS_REDIRECT_PORT || 0);
  if (redirectPort) {
    await buildRedirectApp().listen({ port: redirectPort, host: '127.0.0.1' });
    app.log.info(`Plain http on 127.0.0.1:${redirectPort} redirects to https.`);
  }
  // Daily automatic database copy (SQLite only). Never started by tests.
  startBackupScheduler(app.log);
  // Seal new audit-trail rows into the hash chain every few minutes.
  const seal = () => sealAudit(prisma).catch(e => app.log.error(`Sealing the audit trail failed: ${(e as Error).message}`));
  void seal();
  setInterval(seal, 5 * 60_000).unref();
  // Daily reminders to data-entry staff at the farm's chosen times (Settings → Organization).
  startReminderScheduler(prisma, app.log);
  // Say at start-up what is not set up safely, so it shows in the server window and log.
  securityCheck(prisma).then(r => {
    for (const c of r.checks) if (c.level !== 'ok') app.log.warn(`Security ${c.level === 'fail' ? 'PROBLEM' : 'warning'}: ${c.title.en} ${c.fix?.en ?? ''}`);
    app.log.info(`Security check: ${r.failures} problems, ${r.warnings} warnings (details: Settings → Organization, or npm run security:check -w apps/api).`);
  }).catch(e => app.log.error(`The security check could not run: ${(e as Error).message}`));
}
