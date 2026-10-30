// Minimal .xlsx reader: unzips with node:zlib and reads cell values (cached results for formulas).
// Enough for importing the farm's workbooks without a third-party spreadsheet dependency.
import { inflateRawSync } from 'node:zlib';
import { badRequest } from './errors.js';

function unzip(buf: Buffer) {
  // Locate the End Of Central Directory record (scan back over an optional comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw badRequest('This is not a valid .xlsx file.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw badRequest('The .xlsx file is damaged.');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    files.set(name, method === 0 ? raw : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => decode(m[1])).join('');

export type Cell = string | number | null;
export interface Sheet { name: string; cells: Map<string, Cell> }

export function readXlsx(buf: Buffer): Sheet[] {
  const files = unzip(buf);
  const str = (n: string) => files.get(n)?.toString('utf8');
  const shared = [...(str('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1]));
  const wb = str('xl/workbook.xml') ?? '';
  const rels = str('xl/_rels/workbook.xml.rels') ?? '';
  const target = (rid: string) => {
    const m = rels.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"`)) ?? rels.match(new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${rid}"`));
    return m ? `xl/${m[1].replace(/^\/?xl\//, '')}` : null;
  };
  const sheets: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)) {
    const xml = str(target(m[2]) ?? '');
    if (!xml) continue;
    const cells = new Map<string, Cell>();
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = c[1].match(/\br="([A-Z]+\d+)"/)?.[1];
      if (!ref || !c[2]) continue;
      const type = c[1].match(/\bt="(\w+)"/)?.[1];
      const v = c[2].match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value: Cell = null;
      if (type === 's' && v !== undefined) value = shared[Number(v)] ?? null;
      else if (type === 'inlineStr') value = texts(c[2]);
      else if (type === 'str') value = v !== undefined ? decode(v) : null;
      else if (v !== undefined) value = Number.isFinite(Number(v)) ? Number(v) : decode(v);
      cells.set(ref, value);
    }
    sheets.push({ name: decode(m[1]), cells });
  }
  if (!sheets.length) throw badRequest('No worksheets found in the file.');
  return sheets;
}

export const colLetter = (n: number) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
