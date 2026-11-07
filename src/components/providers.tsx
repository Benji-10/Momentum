'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useEffect, useState } from 'react'
import { initOffline, onReplayComplete } from '@/lib/offline'

/** All selectable themes (applied as data-theme on <html>). */
export const THEME_KEYS = ['paper', 'charcoal', 'forest', 'sunset', 'meadow', 'blossom'] as const
export type ThemeKey = (typeof THEME_KEYS)[number]

/** Themes that render on a dark surface (used to derive light/dark for libs). */
export const DARK_THEMES: ThemeKey[] = ['charcoal', 'forest', 'sunset']

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const qc = new QueryClient({
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
          // queries and mutations RUN even while the network is down —
          // offline handling happens at the app layer (cached snapshot for
          // reads, a durable queue for writes) instead of react-query's
          // in-memory pausing, which would lose everything on a reload
          networkMode: 'always',
        },
        mutations: {
          networkMode: 'always',
        },
      },
    })
    // when the offline queue drains, pull fresh server truth (auto-log
    // entries, skill-tree credit, new routines…) into every view
    onReplayComplete(() => {
      void qc.invalidateQueries({ queryKey: ['goals'] })
    })
    return qc
  })

  useEffect(() => {
    // online/offline listeners + replay of anything queued last session
    initOffline()
    // the app shell as a PWA: installable and bootable with no connection
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* not fatal — offline still works within an open tab */
      })
    }
  }, [])

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
