// Money arithmetic. Amounts travel as JS numbers but are always rounded to 2 decimals
// (quantities to 3) at every boundary; the database stores exact DECIMAL values.
import { Prisma } from '@prisma/client';

type Num = number | string | Prisma.Decimal | null | undefined;

export const num = (v: Num): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
export const round3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;
export const money = (v: Num) => round2(num(v));
export const qty = (v: Num) => round3(num(v));
export const sum = (values: Num[]) => round2(values.reduce<number>((a, v) => a + num(v), 0));
export const isZero = (v: number) => Math.abs(v) < 0.005;
