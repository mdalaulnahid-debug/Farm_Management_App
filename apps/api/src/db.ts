import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient();

/** A Prisma client or an interactive-transaction client. Services accept either. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** Run a unit of work atomically. Every posting service is called inside one of these. */
export const tx = <T>(fn: (db: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(fn, { maxWait: 10_000, timeout: 30_000 });
