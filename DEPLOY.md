# Deploying Momentum to Netlify + Neon

This app is a standard **Netlify project**: the frontend and API routes run
as Netlify Functions, accounts are handled by **Netlify Identity** (with a
custom sign-in UI, not the default identity widget), and all data lives in
**Neon Postgres**, connected via its **connection string** (no Netlify–Neon
extension needed).

Local dev / the preview sandbox needs none of this — there it falls back to
a local SQLite file and a built-in GoTrue-compatible identity shim, so
`bun install && bun run dev` just works offline.

---

## 1. Neon database

1. Create a project at [neon.tech](https://neon.tech) (free tier is plenty).
2. Open **Dashboard → Connection Details** and copy the **pooled**
   connection string (the host contains `-pooler`).
3. Append the Prisma-friendly params if they aren't there already:

   ```
   postgresql://USER:PASSWORD@EP-HOST-pooler.REGION.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connection_limit=1
   ```

## 2. Netlify site

1. Push this repo to GitHub/GitLab, then in Netlify: **Add new site →
   Import an existing project** and pick the repo. The included
   `netlify.toml` already configures the build
   (`npx prisma generate --schema prisma/schema.pg.prisma && npx next build`
   + `@netlify/plugin-nextjs`).
2. **Site configuration → Environment variables → Add a variable**:
   - Key: `DATABASE_URL`
   - Values: the Neon connection string from step 1 (all scopes)
3. **Site configuration → Identity → Enable Identity**, then in
   **Identity settings**:
   - *Registration* → **Open** (or keep Invite-only and invite yourself)
   - *Email confirmation*: optional. If you leave it on, accounts verify
     their email before first sign-in; the app handles both cases.
   - External providers: none needed (email + password is the custom UX).
4. Deploy. On the **first** authenticated request the app creates every
   table it needs on Neon automatically — no migrations to run. Redeploys
   that add columns (e.g. `User.settings` for synced theme/time-zone, or
   `ProgressLog.unit` so routine check-offs can record "20 min" / "25 words"
   entries) are applied the same way: each missing column is added on first
   request.

Sign up from the deployed site, and the same account works from your phone,
laptop, anywhere.

### Moving your existing data

Use **Export** (header → ⬇) on your current build, then **Import** (header →
⬆) on the deployed site while signed in — goals, skill trees, routines and
logs all come across.

---

## Local development

```bash
bun install
cp .env.example .env          # DATABASE_URL = local SQLite file
bun run db:generate           # SQLite Prisma client
bun run db:push               # create/refresh the local db file
bun run dev                   # http://localhost:3000
```

Locally the app uses the same Netlify Identity client pointed at
`/api/dev-identity` — a miniature GoTrue-compatible server built in
(dev-only, disabled automatically when `DATABASE_URL` is a Neon string).
Everything except actual emails works: sign up, sign in, password change,
even password recovery (the "email" appears right in the UI, clearly marked
as preview-only).

## Notes

- The Postgres schema lives at `prisma/schema.pg.prisma`, the SQLite one at
  `prisma/schema.prisma`. **Keep the models in sync** when you change one.
- Never generate the SQLite client on Netlify (or the pg client locally)
  — they share the default import path by design; each environment
  generates exactly one.
- `DATABASE_URL` starting with `postgres://` is what switches the app into
  production mode: Neon database, real Netlify Identity, dev shim disabled.
- **Offline / PWA**: `public/sw.js` (app-shell cache) and
  `public/manifest.webmanifest` are plain static files — no build step. The
  response headers for both (no-cache for the worker, `manifest+json` for
  the manifest) are set in `next.config.ts` and are applied by
  `@netlify/plugin-nextjs` on deploy. Nothing to configure on the Netlify
  side. The service worker only registers in production builds, so
  `next dev` never fights your dev loop.

## Removing the "Powered by Netlify" badge

New public projects on a Netlify Free plan show a "Powered by Netlify"
badge (bottom-right corner) to visitors. Two ways to deal with it:

1. **Turn it off (recommended)** — Netlify UI → your project →
   **Project configuration → General → Powered by Netlify badge → off**.
   Takes effect on the next request; no redeploy needed.
2. **Already built-in fallback** — `src/app/globals.css` hides the badge's
   injected iframe (`iframe#nl-badge-frame`, plus the older
   `#netlify-identity-widget`) with `display: none !important`. You don't
   have to do anything; this covers the badge even if the UI setting is
   ever out of reach. (Netlify injects the iframe at the edge — hiding the
   iframe *element* from your own stylesheet always works, since styling
   the iframe's *contents* is the only thing it protects against.)

