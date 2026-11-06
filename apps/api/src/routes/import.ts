// Backlog import (owner/admin only): the past records template (download, preview, import), the monthly
// workbook (preview, import), and the list of imports with one-step undo.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, tx } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { parse, zReason } from '../lib/validate.js';
import { actorOf, can, ownerAfterGoLive } from '../auth/auth.js';
import { importWorkbook, parseWorkbook, previewWorkbook, undoBatch } from '../services/importer.js';
import { buildTemplate, importTemplate, parseTemplate, previewTemplate } from '../services/past-records.js';

const upload = z.object({
  fileName: z.string().max(200).optional(),
  fileBase64: z.string().min(10),
  replaceExisting: z.boolean().default(false),
  flockId: z.string().nullish(),
});
const decode = (b64: string) => {
  const buf = Buffer.from(b64.replace(/^data:[^,]*,/, ''), 'base64');
  if (buf.length > 10 * 1024 * 1024) throw badRequest('The file is larger than 10 MB.');
  return buf;
};
const big = { bodyLimit: 15 * 1024 * 1024 };
const templateUpload = upload.pick({ fileName: true, fileBase64: true }).extend({ confirmOverlap: z.boolean().default(false) });

export default async function importRoutes(app: FastifyInstance) {
  app.get('/import/template', { preHandler: ownerAfterGoLive }, async (_req, reply) => {
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename="FarmLedger-past-records-template.xlsx"');
    return reply.send(buildTemplate());
  });

  app.post('/import/template/preview', { ...big, preHandler: ownerAfterGoLive }, async req => {
    const body = parse(templateUpload, req.body);
    return previewTemplate(actorOf(req), parseTemplate(decode(body.fileBase64)));
  });

  app.post('/import/template', { ...big, preHandler: ownerAfterGoLive }, async req => {
    const body = parse(templateUpload, req.body);
    const parsed = parseTemplate(decode(body.fileBase64));
    return tx(db => importTemplate(db, actorOf(req), parsed, { fileName: body.fileName, confirmOverlap: body.confirmOverlap }), 180_000);
  });

  app.post('/import/workbook/preview', { ...big, preHandler: ownerAfterGoLive }, async req => {
    const body = parse(upload, req.body);
    return previewWorkbook(parseWorkbook(decode(body.fileBase64)));
  });

  app.post('/import/workbook', { ...big, preHandler: ownerAfterGoLive }, async req => {
    const body = parse(upload, req.body);
    const parsed = parseWorkbook(decode(body.fileBase64));
    const preview = await previewWorkbook(parsed);
    if (preview.errors.length) throw badRequest(preview.errors.join(' '));
    if (preview.hasExisting && !body.replaceExisting) throw badRequest('This period already has records. Tick "Replace existing records in this period" to import over them.');
    return tx(db => importWorkbook(db, actorOf(req), parsed, { replaceExisting: body.replaceExisting, flockId: body.flockId, fileName: body.fileName }), 180_000);
  });

  app.get('/import/batches', { preHandler: ownerAfterGoLive }, async () => {
    const rows = await prisma.importBatch.findMany({ orderBy: { createdAt: 'desc' } });
    return { data: rows.map(({ documents: _d, summary, ...b }) => ({ ...b, summary: JSON.parse(summary) })) };
  });

  app.post('/import/batches/:id/undo', { preHandler: ownerAfterGoLive }, async req => {
    const { reason } = parse(zReason, req.body);
    await tx(db => undoBatch(db, actorOf(req), (req.params as { id: string }).id, reason), 180_000);
    return { ok: true };
  });
}
