import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/hind-siliguri/400.css';
import '@fontsource/hind-siliguri/500.css';
import '@fontsource/hind-siliguri/600.css';
import '@fontsource-variable/anek-bangla/wght.css';
import '@farmledger/design-system/tokens.css';
import '@farmledger/design-system/themes/bdp.css';
import '@farmledger/design-system/components.css';
import './styles.css';
import { PrefsProvider, useT } from './lib/i18n';
import { AuthProvider } from './lib/auth';
import { DSTextProvider, ToastProvider } from '@farmledger/design-system';
import App from './App';

/** Lets the design-system components speak the language chosen in My settings. */
function DSText({ children }: { children: ReactNode }) {
  return <DSTextProvider t={useT()}>{children}</DSTextProvider>;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PrefsProvider>
        <DSText>
          <ToastProvider>
            <BrowserRouter>
              <AuthProvider>
                <App />
              </AuthProvider>
            </BrowserRouter>
          </ToastProvider>
        </DSText>
      </PrefsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
