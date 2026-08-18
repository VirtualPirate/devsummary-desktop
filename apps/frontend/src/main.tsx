import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import './index.css'
import { router } from './router.tsx'
import { queryClient } from './lib/query-client'
import { ThemeProvider } from './components/theme/theme-provider'
import { TooltipProvider } from './components/ui/tooltip'
import { Toaster } from './components/ui/sonner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <Toaster position="bottom-right" />
        </QueryClientProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)
