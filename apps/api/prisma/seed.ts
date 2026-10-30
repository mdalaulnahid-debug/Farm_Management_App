import { seed } from '../src/seed.js';
import { prisma } from '../src/db.js';

const result = await seed({
  history: process.env.SEED_HISTORY !== 'false',
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminName: process.env.ADMIN_NAME,
});
console.log(result.created ? `Seeded. Sign in as ${result.adminEmail} with the ADMIN_PASSWORD from .env (you will be asked to change it).` : 'Database already initialised; seed skipped.');
await prisma.$disconnect();
