// BDP Agrofarm logo: a deep-green duck inside a gold egg. `tile` puts it on the green rounded square (app icon,
// light backgrounds, print); `egg` is the egg alone, for the dark green sidebar and sign-in photo.
// The same drawing is public/icons/icon.svg; keep them in step.
const EGG = 'M60 13c20.5 0 35.5 29.5 35.5 53.5C95.5 88.5 80 105 60 105S24.5 88.5 24.5 66.5C24.5 42.5 39.5 13 60 13z';
const INK = '#0e3b2c';
const GOLD = '#e3a81b';

export function LogoMark({ size = 36, variant = 'tile', title }: { size?: number; variant?: 'tile' | 'egg'; title?: string }) {
  const egg = variant === 'egg';
  return (
    <svg width={size} height={size} viewBox={egg ? '22 11 76 96' : '0 0 120 120'} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="logo-mark">
      {!egg && <rect width="120" height="120" rx="28" fill={INK} />}
      <path d={EGG} fill={GOLD} />
      <g fill={INK}>
        <path d="M33 63.5c5.6 6.3 11.6 8.6 18.4 8.1 3.7-.3 6.5-1.6 8.6-3.9h10.6c7.4 3.7 12.4 9.5 12.4 16.4 0 9.7-10 16.4-23.2 16.4-12.4 0-21.6-6.1-23.2-15.1-.7-4.4.4-8.9 2.1-12.6z" />
        <circle cx="67.5" cy="55" r="11.2" />
        <path d="M76.5 51.6c4.6-.6 9.3.2 12.4 2.4 1 .7 1 2.1 0 2.8-3.1 2.2-7.8 3-12.4 2.4z" />
      </g>
      <circle cx="70.4" cy="52.6" r="2.2" fill={GOLD} />
      <path d="M47 85.5c6.2 5.3 16.6 5.3 22.8 0" fill="none" stroke={GOLD} strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}
