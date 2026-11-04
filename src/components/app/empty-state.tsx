'use client'

import { CalendarCheck, CopyPlus, FileJson, ListChecks, Map as MapIcon, Repeat, Sparkles, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeQuickRow } from '@/components/app/theme-picker'

export function EmptyState({
  onNewGoal,
  onSeed,
  onImport,
  onBulk,
  seeding,
}: {
  onNewGoal: () => void
  onSeed: () => void
  onImport: () => void
  onBulk: () => void
  seeding: boolean
}) {
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-3xl">
        🎯
      </div>
      <h2 className="text-2xl font-bold tracking-tight">Welcome to Momentum</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Stop practicing mindlessly. Set targets, build skill maps, schedule weekly routines — and let the app
        tell you exactly what to do each week to stay on track.
      </p>

      <div className="mt-7 grid gap-3 text-left sm:grid-cols-2">
        <div className="rounded-xl border p-4">
          <Target className="mb-2 h-5 w-5 text-primary" />
          <div className="text-sm font-semibold">Target goals</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            &ldquo;Read 12 books this year&rdquo; — the app computes the pages or books per week you need and warns
            you when you fall behind.
          </p>
        </div>
        <div className="rounded-xl border p-4">
          <MapIcon className="mb-2 h-5 w-5 text-primary" />
          <div className="text-sm font-semibold">Skill maps</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            &ldquo;Learn Mandarin&rdquo; — parallel paths (Vocab · Grammar · Fluency) with tiers you level up, video-game
            style.
          </p>
        </div>
        <div className="rounded-xl border p-4">
          <Repeat className="mb-2 h-5 w-5 text-primary" />
          <div className="text-sm font-semibold">Weekly routines</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            &ldquo;Drills every 2 days, focused practice every Sunday&rdquo; — repeat for as long as it takes, with a
            weekly check-off board.
          </p>
        </div>
        <div className="rounded-xl border p-4">
          <FileJson className="mb-2 h-5 w-5 text-primary" />
          <div className="text-sm font-semibold">Roadmap import</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Author your plan as JSON anywhere, then import it — goals, steps, paths and routines in one go.
          </p>
        </div>
      </div>

      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button size="lg" onClick={onNewGoal}>
          <Target className="h-4 w-4" /> Create your first goal
        </Button>
        <Button size="lg" variant="outline" onClick={onBulk}>
          <CopyPlus className="h-4 w-4" /> Add many at once
        </Button>
        <Button size="lg" variant="outline" onClick={onImport}>
          <FileJson className="h-4 w-4" /> Import a roadmap
        </Button>
        <Button size="lg" variant="outline" onClick={onSeed} disabled={seeding}>
          <Sparkles className="h-4 w-4" /> {seeding ? 'Loading demo…' : 'Demo data'}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Demo data adds four example goals (including a Mandarin skill map) with two months of history.
      </p>

      <div className="mt-8 flex items-center justify-center gap-3">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarCheck className="h-3.5 w-3.5" /> Pick a theme:
        </span>
        <ThemeQuickRow />
      </div>
    </div>
  )
}
