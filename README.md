# Momentum · Goal & Plan Tracker

A gamified progress tracker you can host yourself. Set measurable goals with
deadlines, break skills down into a Minecraft-style skill tree, plan your week
with flexible routines, and watch the log write itself as you check things off.

## Features

- **Goals** — categories, deadlines, weekly targets and notes, each with tabs
  for overview, steps, routines, skills and log.
- **Skill-tree roadmap** — animated paths with XP, milestones and unlock
  gating (a node stays locked until its prerequisites are done, e.g. HSK 4
  needs HSK 2 first). The roadmap opens zoomed in on your current step so it
  is readable at a glance; one tap zooms out to the whole tree.
- **Routines** — `every N days` or specific weekdays, optional rest days and
  end dates, weekday-specific tasks (e.g. vocab cards on Mondays, speaking
  practice on Sundays), and preset durations. Missed days surface gently for
  catch-up instead of breaking anything.
- **Auto-logging** — checking off a routine that has a preset duration
  ("read 20 min", "work 2 h") writes the log entry for you; a separate quick
  entry still lets you log custom amounts.
- **Personal bests & time invested** — track PB metrics per goal ("WPM",
  higher is better; "BLD" solve time, lower is better) with a PB-over-time
  chart and per-attempt history, plus a cumulative time-spent graph — both on
  the Review tab.
- **One "Today" card** — the dashboard splits today's work into "check off
  when done" (scheduled routines) and "work toward" (ongoing targets, which
  advance as you log progress — each row has an inline + Log button).
- **Accounts** — Netlify Identity behind a custom sign-in / sign-up screen
  (no default identity widget). Every account sees only its own data, on any
  device.
- **Synced settings** — the theme and the *time zone* the app bases “today”
  on are saved to your account (`Settings` in the account menu) and applied
  on every device. Pick `Automatic` and each device follows its own clock,
  or fix a zone like `America/Chicago` so a laptop still set to London time
  never shows tomorrow's tasks early — check-offs, schedule weeks, stats
  and chart dates all follow the same day boundary (see
  `src/lib/app-time.ts`).
- **Import / Export** — one-click JSON backup using the versioned `v1`
  schema (see `src/lib/import-format.ts`); the parser is tolerant of multiple
  goals, nullable fields and empty arrays.
- **Six themes** — Paper, Meadow, Blossom (light) · Charcoal, Forest, Sunset
  (dark) — plus confetti when a node levels up. Picking a theme anywhere
  (header palette or Settings) syncs it to the account.
- **Mobile-first fit** — the page never scrolls sideways (tested 320–390 px:
  the header collapses to icon actions, Import/Export move into the menus,
  and any Netlify-injected badge iframe is hidden). Inner strips (tab rows,
  the roadmap picker, the quest map) scroll on their own.
- **Brand mark & favicon** — the M drawn as an ascending progress line whose
  last stroke breaks out as an upward arrow (`public/favicon.svg`), shipped
  as an optically size-tiered set: `favicon.ico` (16/32/48 px cuts),
  `apple-touch-icon.png`, and the same mark in the header, sign-in screen
  and empty state (`src/components/app/brand-mark.tsx`).

## Quick start (local)

```bash
bun install                # or: npm install
cp .env.example .env       # local SQLite + built-in preview identity
bun run db:generate        # generate the Prisma client (SQLite schema)
bun run db:push            # create the local database file
bun run dev                # http://localhost:3000
```

Local dev needs no Netlify account: while `DATABASE_URL` is a local SQLite
file, the app also serves a miniature GoTrue-compatible identity shim at
`/api/dev-identity`, so sign-up, sign-in and password change all work
offline. Point `DATABASE_URL` at Postgres and the shim disables itself.

## Deploy to Netlify + Neon

This is a standard Netlify project — `netlify.toml` is already configured and
the API routes deploy as Netlify Functions. Full walkthrough in
**[DEPLOY.md](DEPLOY.md)**; the short version:

1. Create a Neon project and copy the **pooled** connection string.
2. In Netlify → Site configuration → Environment variables, set
   `DATABASE_URL` to that string.
3. Enable **Netlify Identity** (open registration, or invite yourself).
4. Deploy — every table is created automatically on the first request.

To move existing data, use **Export** (header → ⬇) on the old build and
**Import** (header → ⬆) on the new one while signed in.

## Repo layout

| Path | What it is |
| --- | --- |
| `src/app` | Next.js App Router pages + API routes (become Netlify Functions) |
| `src/components/app` | The UI — dashboard, schedule, roadmap, review, auth, dialogs |
| `src/lib` | Domain logic: routine scheduling, skill-tree math, import/export format, auth |
| `prisma/schema.prisma` | SQLite schema (local dev) |
| `prisma/schema.pg.prisma` | Postgres schema (Neon / production) |
| `netlify.toml` | Netlify build configuration |

## Data format

Import / export uses a versioned JSON document (`"version": 1`) with a
`goals` array; exports also carry an `exportedAt` stamp and your progress
history, and re-import losslessly. The parser is tolerant of multiple goals,
nullable fields, empty arrays, numeric strings (`"150"`) and common aliases
(`checkpoints` → `nodes`, `everyNDays` → `everyDays`, …). Dates may be
`"2026-01-05"`, a full ISO timestamp, or `daysAgo: 3`. The exact shape and
normalization rules live in `src/lib/import-format.ts` — the Import dialog's
**Example** button shows one of every field.

| Level | Fields |
| --- | --- |
| goal | `title` · `description` · `emoji` · `color` · `category` · `type` (`plan` \| `quantitative`) · `targetValue` · `unit` · `weeklyTarget` · `deadline` · `steps` · `paths` · `routines` · `pbs` · `notes` · `logs` |
| step | `title` · `notes` · `done` |
| path | `title` · `description` · `icon` · `unit` (the default for its nodes) |
| node | `title` · `description` · `icon` · `current` · `target` · `unit` (override) · `xp` · `mastered` (shortcut for `current = target`) · `milestones` (`[50, 100]` or `[{ "value": 100, "label": "First 100" }]`) · `requires` (`["HSK3"]`, or cross-path `"Vocabulary › HSK3"` — default is the previous node in the same path) |
| routine | `title` · `notes` · `cadence` with `weekdays` (`["Mon","Thu"]` or `[1, 4]`) / `everyDays` (interval) / `timesPerWeek` (any N days a week) · `durationMin` · `node` + `credit` (auto-advance a checkpoint per check-off) · `startDate` · `endDate` · `dones` (completion history) |
| pb | `name` · `unit` · `direction` (`up` = higher is better, e.g. WPM; `down` = lower is better, e.g. a solve time) · `records` |
| record / log | `date` or `daysAgo` · `value` / `amount` · `note` |

Theme and time zone are *account* settings (Settings menu, synced across
devices) and are deliberately not part of the roadmap file; archived goals
are skipped by export.

### Merge imports (update without losing progress)

The Import dialog offers two modes:

- **Add as new goals** — everything is created fresh (importing the same file
  twice duplicates it).
- **Merge into existing** — goals, branches, checkpoints, steps, routines and
  PB metrics are matched **by name** (case-insensitive) and updated in place;
  anything the file doesn't mention is left untouched. One principle drives
  every rule: *definitions follow the file, progress survives wherever it
  still fits.*

| Field on a matched item | Merge rule |
| --- | --- |
| absent from the file | existing value kept (a partial file only touches what it mentions) |
| `null` in the file | cleared · a value → set (definitions: `description`, `emoji`, `color`, `category`, `type`, `targetValue`, `unit`, `weeklyTarget`, `deadline`, icons, `xp`, routine `cadence`/`durationMin`/`node`/`credit`/`endDate`, pb `unit`/`direction`) |
| node `target` / `milestones` / `requires` | always follow the file (`target` is required; milestones sync by value keeping `reachedAt`; `requires` re-resolves cycle-safe on top of locked-in existing edges) |
| node `current` / `mastered` | progress can only grow: `max(existing, incoming)` — a stale file never rolls you back |
| node `completedAt` | kept when still cleared, stamped when newly reached, cleared only when a raised target outruns progress |
| step `done` | existing OR incoming — a merge never un-ticks |
| routine `dones` | union of days (deduped) |
| pb `records` / `logs` / `notes` | append-only, deduped by day+value / day+amount+note / exact content |

Items missing from the file (a branch you deleted, a checkpoint you renamed)
are **kept** with all their progress — deleting is what the danger zone is
for. The same upsert-by-name logic powers *Import into this goal* on the goal
sheet. Verified end-to-end by `bun scripts/verify-merge.ts`.

### Danger zone (Settings)

- **Reset all progress** (type `RESET`) — zeroes every checkpoint, check-off,
  log, PB record and step status; goals, branches, checkpoints, routines, PB
  metrics and notes all stay.
- **Delete everything** (type `WIPE`) — deletes every goal and everything
  under it. The account, password and synced settings stay. Export a backup
  first; there is no undo.
