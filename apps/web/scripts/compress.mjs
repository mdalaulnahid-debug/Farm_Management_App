// After `vite build`: write .br and .gz copies of the built text files next to them. The API serves these
// ready-compressed copies (@fastify/static preCompressed), so phones on slow data download about a quarter
// of the bytes, with no compression work on the server per request.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

// fileURLToPath handles Windows drive letters and folders with spaces (URL.pathname would keep %20).
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
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
// Never fatal: without the compressed copies the server simply sends the plain files.
try {
  walk(dist);
  console.log(`Compressed ${count} files: ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB (brotli).`);
} catch (e) {
  console.warn(`Skipped making compressed copies: ${e.message}. The app still works; it just sends uncompressed files.`);
}
