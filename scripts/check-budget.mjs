// Size budget for the first visit: the JS and CSS the browser must download before the first screen
// (the entry script, its preloaded chunks and the stylesheet), as sent (gzip). Fails above the budget so the
// app never quietly gets slow again on farm phones. Run after `npm run build -w apps/web`.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = Number(process.env.BUDGET_KB || 170);
const dist = join(process.cwd(), 'apps/web/dist');
if (!existsSync(join(dist, 'index.html'))) { console.error('Build the web app first: npm run build -w apps/web'); process.exit(2); }
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map(m => m[1]);
let total = 0;
const rows = files.map(f => {
  const kb = gzipSync(readFileSync(join(dist, f)), { level: 9 }).length / 1024;
  total += kb;
  return [f, kb];
});
for (const [f, kb] of rows) console.log(`${kb.toFixed(1).padStart(7)} kB  ${f}`);
console.log(`${total.toFixed(1).padStart(7)} kB  total (budget ${BUDGET_KB} kB)`);
if (total > BUDGET_KB) {
  console.error(`\nThe first visit is ${(total - BUDGET_KB).toFixed(1)} kB over budget. Load the new code lazily (React.lazy / import()) or make it smaller.`);
  process.exit(1);
}
