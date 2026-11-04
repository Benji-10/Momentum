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
- **Accounts** — Netlify Identity behind a custom sign-in / sign-up screen
  (no default identity widget). Every account sees only its own data, on any
  device.
- **Import / Export** — one-click JSON backup using the versioned `v1`
  schema (see `src/lib/import-format.ts`); the parser is tolerant of multiple
  goals, nullable fields and empty arrays.
- **Six themes** — Paper, Meadow, Blossom (light) · Charcoal, Forest, Sunset
  (dark) — plus confetti when a node levels up.

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
`goals` array. The exact shape and the normalization rules live in
`src/lib/import-format.ts`.
