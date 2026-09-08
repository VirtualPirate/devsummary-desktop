import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import './index.css'
import { router } from './router.tsx'
import { queryClient } from './lib/query-client'
import { resolveAppConfig, resolveConsent } from './env/config-env'
import { ConsentGate, TERMS_VERSION } from './components/consent/consent-gate'
import { ThemeProvider } from './components/theme/theme-provider'
import { TooltipProvider } from './components/ui/tooltip'
import { Toaster } from './components/ui/sonner'

// Nothing renders before the API base URL and the per-boot token are known —
// the first thing the shell does is fetch, and a request sent without the token
// is a 401 the UI would have to explain. The consent state resolves in the same
// step so the gate never flashes an interactive app behind it.
void Promise.all([resolveAppConfig(), resolveConsent(TERMS_VERSION)]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <ConsentGate>
              <RouterProvider router={router} />
            </ConsentGate>
            <Toaster position="bottom-right" />
          </QueryClientProvider>
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>,
  )
})
