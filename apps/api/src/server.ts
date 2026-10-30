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
import masterRoutes from './routes/master.js';
import transactionRoutes from './routes/transactions.js';
import reportRoutes from './routes/reports.js';
import importRoutes from './routes/import.js';
import projectRoutes from './routes/projects.js';
import { ensureReferenceData } from './services/reference.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info') },
    trustProxy: true,
    bodyLimit: 1_000_000,
  });

  // Decimal columns are sent to the client as plain numbers.
  app.setReplySerializer(payload =>
    JSON.stringify(payload, function (this: any, key, value) {
      const raw = key === '' ? value : this[key];
      return raw instanceof Prisma.Decimal ? raw.toNumber() : value;
    }),
  );

  await app.register(helmet, { contentSecurityPolicy: false });
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
    await api.register(masterRoutes);
    await api.register(transactionRoutes);
    await api.register(reportRoutes);
    await api.register(importRoutes);
    await api.register(projectRoutes);
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
}
