'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * The Momentum brand mark — the same shape as the favicon
 * (`public/favicon.svg`): the letter M drawn as an ascending progress line
 * whose final stroke breaks out as an upward arrow. Momentum = the M
 * escaping its own shape, trending up like every chart in the app.
 *
 * In-app it renders at 36–48px, so it uses the relaxed optical cut
 * (more breathing room), matching the apple-touch-icon.
 */
export function BrandMark({ className }: { className?: string }) {
  const gid = useId() // unique gradient id per instance
  return (
    <svg viewBox="0 0 64 64" className={cn('shrink-0', className)} role="img" aria-label="Momentum">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#19C48D" />
          <stop offset="1" stopColor="#0A8A5D" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${gid})`} />
      <g
        fill="none"
        stroke="#fff"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="15,46 24.5,29.5 34,39.5 49,17.5" />
        <polyline points="41.5,17.5 49,17.5 49,25" />
      </g>
    </svg>
  )
}
