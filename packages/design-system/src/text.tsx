// The kit's own words (Loading…, Close, Previous…) come through this provider, so each app decides the
// language. Without a provider every component speaks English.
import { createContext, useContext, type ReactNode } from 'react';

export type TextFn = (en: string, bn: string) => string;
const TextContext = createContext<TextFn>(en => en);

export function DSTextProvider({ t, children }: { t: TextFn; children: ReactNode }) {
  return <TextContext.Provider value={t}>{children}</TextContext.Provider>;
}

export const useDSText = () => useContext(TextContext);
