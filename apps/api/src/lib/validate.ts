import { z } from 'zod';
import { badRequest } from './errors.js';
import { toDate } from './dates.js';

export const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest(issues.map(i => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; '), issues);
  }
  return r.data;
};

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').transform(toDate);
export const zOptDate = zDate.nullish();
export const zMoney = z.coerce.number().finite().min(0).max(1e12);
export const zQty = z.coerce.number().finite();
export const zId = z.string().min(1);
export const zText = (max = 500) => z.string().trim().max(max);
export const zOptText = (max = 500) => z.string().trim().max(max).nullish().transform(v => (v ? v : null));
export const zReason = z.object({ reason: z.string().trim().min(3, 'Give a reason (at least 3 characters).').max(300) });

export const zRange = z.object({ from: zDate.optional(), to: zDate.optional() });
