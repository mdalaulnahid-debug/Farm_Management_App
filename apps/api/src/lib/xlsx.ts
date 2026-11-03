// Minimal .xlsx reader and writer: unzips with node:zlib and reads cell values (cached results for formulas),
// and writes the simple templates FarmLedger hands out. No third-party spreadsheet dependency.
import { deflateRawSync, inflateRawSync } from 'node:zlib';
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

// ───────────── Writing ─────────────

export interface OutSheet {
  name: string;
  rows: Cell[][];
  widths?: number[];
  /** Row 1 is a bold, frozen header and row 2 a grey example. Without it, row 1 is a title and the rest wraps. */
  header?: boolean;
  /** 0-based columns formatted as text, so typed dates stay exactly as typed. */
  textCols?: number[];
  /** Drop-down lists: 0-based column → allowed values (rows 3 to 5000). */
  lists?: { col: number; values: string[] }[];
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function zip(files: [name: string, text: string][]) {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8'), packed = deflateRawSync(data), fname = Buffer.from(name, 'utf8'), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fname.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(fname.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, fname, packed);
    central.push(entry, fname);
    offset += 30 + fname.length + packed.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'http://schemas.openxmlformats.org';
// Cell styles: 0 normal, 1 header (bold, shaded, wrapped), 2 example (grey italic), 3 text format, 4 wrapped, 5 title.
const STYLES = `${XML}<styleSheet xmlns="${NS}/spreadsheetml/2006/main">`
  + '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FF808080"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';

function sheetXml(s: OutSheet) {
  const text = new Set(s.textCols ?? []);
  const style = (r: number, c: number) => (s.header ? (r === 0 ? 1 : r === 1 ? 2 : text.has(c) ? 3 : 0) : r === 0 ? 5 : 4);
  const rows = s.rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
    if (v === null || v === '') return '';
    const ref = `${colLetter(c)}${r + 1}`;
    return typeof v === 'number'
      ? `<c r="${ref}" s="${style(r, c)}"><v>${v}</v></c>`
      : `<c r="${ref}" s="${style(r, c)}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const width = Math.max(1, s.widths?.length ?? 0, ...s.rows.map(r => r.length));
  const cols = Array.from({ length: width }, (_, c) => `<col min="${c + 1}" max="${c + 1}" width="${s.widths?.[c] ?? 16}" customWidth="1"${text.has(c) ? ' style="3"' : ''}/>`).join('');
  const pane = s.header ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
  const lists = s.lists?.length
    ? `<dataValidations count="${s.lists.length}">${s.lists.map(l => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${colLetter(l.col)}3:${colLetter(l.col)}5000"><formula1>"${esc(l.values.join(','))}"</formula1></dataValidation>`).join('')}</dataValidations>`
    : '';
  return `${XML}<worksheet xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships">${pane}<cols>${cols}</cols><sheetData>${rows}</sheetData>${lists}</worksheet>`;
}

export function writeXlsx(sheets: OutSheet[]) {
  const sheetType = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  return zip([
    ['[Content_Types].xml', `${XML}<Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${sheetType}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${sheetType}.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${sheetType}.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${XML}<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${NS}/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${NS}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ]);
}
