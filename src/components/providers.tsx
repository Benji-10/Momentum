'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState } from 'react'

/** All selectable themes (applied as data-theme on <html>). */
export const THEME_KEYS = ['paper', 'charcoal', 'forest', 'sunset', 'meadow', 'blossom'] as const
export type ThemeKey = (typeof THEME_KEYS)[number]

/** Themes that render on a dark surface (used to derive light/dark for libs). */
export const DARK_THEMES: ThemeKey[] = ['charcoal', 'forest', 'sunset']

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 1,
            // keep every device in sync: refetch when the window regains focus
            // (picking your laptop back up after using your phone, etc.)…
            refetchOnWindowFocus: true,
            // …and poll gently while the app is open, so edits made on one
            // device appear on the others within half a minute
            refetchInterval: 30_000,
          },
        },
      }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="data-theme"
        themes={[...THEME_KEYS]}
        defaultTheme="paper"
        enableSystem={false}
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  )
}
