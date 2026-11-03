// The installable app: the web manifest names the farm, opens in its own window, and every icon it lists
// exists at the size it claims (phones refuse to install with a missing or wrong-sized icon).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const web = resolve(__dirname, '../../web');
const manifest = JSON.parse(readFileSync(join(web, 'public/manifest.webmanifest'), 'utf8'));
/** Width and height from a PNG file's header. */
const pngSize = (file: string) => {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
};

describe('web app manifest', () => {
  it('names the farm and opens as an app window', () => {
    expect(manifest).toMatchObject({ short_name: 'BDP Agro Farm', name: 'Barishal District Police Agro Farm', display: 'standalone', start_url: '/', scope: '/' });
    expect(manifest.short_name.length).toBeLessThanOrEqual(13);
  });

  it('lists a 192 and a 512 icon and a maskable one, each at its stated size', () => {
    const pngs = manifest.icons.filter((i: any) => i.type === 'image/png');
    expect(pngs.map((i: any) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(pngs.some((i: any) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const file = join(web, 'public', icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      if (icon.type === 'image/png') expect(pngSize(file)).toBe(icon.sizes);
    }
  });

  it('the page links the manifest, the favicon and the iPhone icon', () => {
    const html = readFileSync(join(web, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('href="/icons/icon.svg"');
    expect(pngSize(join(web, 'public/icons/apple-touch-icon.png'))).toBe('180x180');
  });
});
