// Writes tokens.json from the CSS token files, so sites that are not built with React (or design tools)
// can read the same values. Run `npm run tokens -w packages/design-system` after editing a token file.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Custom properties declared in every rule whose selector is exactly `selector`, in file order. */
export function varsOf(css, selector) {
  const out = {};
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (const [, sel, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(rule)) {
    if (sel.trim() !== selector) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
  }
  return out;
}

export function buildTokens() {
  const tokens = readFileSync(join(root, 'src/tokens.css'), 'utf8');
  const bdp = readFileSync(join(root, 'src/themes/bdp.css'), 'utf8');
  const light = varsOf(bdp, ':root');
  return {
    base: { ...varsOf(tokens, ':root'), compact: varsOf(tokens, ":root[data-density='compact']") },
    themes: {
      bdp: {
        light,
        dark: varsOf(bdp, ":root[data-theme='dark']"),
        accents: Object.fromEntries(['blue', 'purple', 'amber'].map(a => [a, {
          light: varsOf(bdp, `:root[data-accent='${a}']`),
          dark: varsOf(bdp, `:root[data-theme='dark'][data-accent='${a}']`),
        }])),
      },
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(root, 'tokens.json'), JSON.stringify(buildTokens(), null, 2) + '\n');
  console.log('tokens.json written');
}
