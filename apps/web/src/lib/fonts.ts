// Reading font sets (My settings › Appearance). "Clean" (Inter + Hind Siliguri) ships with the app; the others
// download only when someone picks them, so they cost nothing for everyone else. The CSS variables for each
// set live in the theme (themes/bdp.css › [data-font]).
export type FontSet = 'clean' | 'easy' | 'friendly';

const loaders: Record<Exclude<FontSet, 'clean'>, () => Promise<unknown>> = {
  easy: () => Promise.all([
    import('@fontsource/atkinson-hyperlegible/400.css'), import('@fontsource/atkinson-hyperlegible/700.css'),
    import('@fontsource/noto-sans-bengali/400.css'), import('@fontsource/noto-sans-bengali/600.css'),
  ]),
  friendly: () => Promise.all([
    import('@fontsource/nunito/400.css'), import('@fontsource/nunito/600.css'), import('@fontsource/nunito/700.css'),
    import('@fontsource/baloo-da-2/400.css'), import('@fontsource/baloo-da-2/600.css'),
  ]),
};
const loaded = new Set<FontSet>(['clean']);

/** Downloads a font set's files once; resolves when its CSS is in the page. */
export async function loadFontSet(set: FontSet) {
  if (loaded.has(set)) return;
  if (set !== 'clean') await loaders[set]();
  loaded.add(set);
}
