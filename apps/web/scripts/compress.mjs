// After `vite build`: write .br and .gz copies of the built text files next to them. The API serves these
// ready-compressed copies (@fastify/static preCompressed), so phones on slow data download about a quarter
// of the bytes, with no compression work on the server per request.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const TEXT = /\.(js|css|html|svg|json|webmanifest|txt)$/;
let before = 0, after = 0, count = 0;

const walk = dir => {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) { walk(file); continue; }
    if (!TEXT.test(name)) continue;
    const raw = readFileSync(file);
    if (raw.length < 1024) continue;
    const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
    writeFileSync(`${file}.br`, br);
    writeFileSync(`${file}.gz`, gzipSync(raw, { level: 9 }));
    before += raw.length; after += br.length; count++;
  }
};
walk(dist);
console.log(`Compressed ${count} files: ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB (brotli).`);
