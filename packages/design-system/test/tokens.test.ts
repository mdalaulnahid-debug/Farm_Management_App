// The token files are the master copy: tokens.json must match them, every variable the app uses must be
// defined somewhere, and body text must stay readable (WCAG AA, 4.5:1) in both light and dark.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
// @ts-expect-error plain ES module without types
import { buildTokens } from '../scripts/build-tokens.mjs';

const pkg = resolve(__dirname, '..');
const web = resolve(pkg, '../../apps/web/src');
const read = (p: string) => readFileSync(p, 'utf8');

const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(css|tsx?)$/.test(f) ? [p] : [];
});

/** Relative luminance of a #rrggbb colour (WCAG 2). */
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

describe('design tokens', () => {
  it('tokens.json matches the CSS token files (run `npm run tokens` after editing them)', () => {
    expect(JSON.parse(read(join(pkg, 'tokens.json')))).toEqual(buildTokens());
  });

  it('every var() used by the package and the app is defined', () => {
    const sources = [...files(join(pkg, 'src')), ...files(web)];
    const defined = new Set(sources.flatMap(f => [...read(f).matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1])));
    // Variables set from script at run time (style props) count as defined.
    for (const f of sources) for (const m of read(f).matchAll(/['"](--[\w-]+)['"]\s*[:,]/g)) defined.add(m[1]);
    const missing = new Set<string>();
    for (const f of sources) for (const m of read(f).matchAll(/var\((--[\w-]+)/g)) if (!defined.has(m[1])) missing.add(`${m[1]} (${f.slice(pkg.length - 30)})`);
    expect([...missing]).toEqual([]);
  });

  it('body text reaches 4.5:1 in light and dark', () => {
    const { light, dark } = buildTokens().themes.bdp;
    const both = { ...light };
    for (const t of [light, { ...light, ...dark }]) {
      expect(contrast(t['--text'], t['--bg'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--text-2'], t['--surface'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--text-3'], t['--surface'])).toBeGreaterThanOrEqual(4.5);
    }
    expect(both['--brand']).toBe('#0e3b2c');
  });
});
