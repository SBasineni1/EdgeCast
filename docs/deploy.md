# Deploying EdgeCast (all-free, no credit card)

Architecture: everything lives on **Vercel** (hobby tier). The static React frontend is
built from `web/`; the FastAPI backend runs as a Vercel Python function (`api/index.py`)
answering `/api/*`; storage is **Turso** (hosted SQLite, free tier, GitHub signup — no
card). Two Vercel Cron jobs (15:00 and 16:00 UTC) hit `/api/cron/snapshot` so the 11 AM ET
day-ahead snapshot fires whether it's EST or EDT — the endpoint's ET gate makes the
wrong-hour invocation a no-op, and it's idempotent.

Local development is unchanged: without `TURSO_DATABASE_URL` set, all stores use the
SQLite file at `data/edgecast.db` exactly as before.

## One-time setup

### 1. Turso (database)

```bash
brew install tursodatabase/tap/turso
turso auth signup            # GitHub OAuth, no card

# Create the DB seeded from your local file — this carries over your verification
# history AND any day-ahead snapshots already taken:
turso db create edgecast --from-file data/edgecast.db

turso db show edgecast --url          # -> TURSO_DATABASE_URL
turso db tokens create edgecast       # -> TURSO_AUTH_TOKEN
```

### 2. Vercel (frontend + API + cron)

1. Push the repo to GitHub.
2. Vercel → Add New Project → import the repo. **Root Directory must be the repo root**
   (not `web` — the root `vercel.json` handles the frontend build via
   `cd web && npm run build`). If you already created the project with root `web`,
   change it under Project Settings → General → Root Directory, or delete and re-import.
3. Environment Variables (all environments):
   - `TURSO_DATABASE_URL` — from `turso db show`
   - `TURSO_AUTH_TOKEN` — from `turso db tokens create`
4. Deploy.

### 3. Verify

- `https://<project>.vercel.app` shows the dashboard.
- `https://<project>.vercel.app/api/live` returns JSON (first hit is slow — cold start
  plus the 20-city fetch).
- `https://<project>.vercel.app/api/cron/snapshot` returns `{"captured": ...}` — safe to
  hit manually; it refuses duplicates.

## Notes

- **Crons need nothing from you** — Vercel invokes them; check Project → Settings → Cron
  Jobs to see runs.
- Serverless caches (live quotes/ensembles TTL, 429 cooldown, dead-date tombstones) are
  per-warm-instance; they reset on cold starts, which is fine — durable state is in Turso.
- Free-tier headroom: Turso allows ~1B row reads/month; this app does a few thousand.
  Vercel hobby function limits fit the 60s `maxDuration` configured in `vercel.json`.
- `Dockerfile`/`fly.toml` remain in the repo as an alternative path (Fly.io needs a card);
  they're excluded from Vercel via `.vercelignore`.
