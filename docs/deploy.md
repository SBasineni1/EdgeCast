# Deploying EdgeCast

Architecture: the static React frontend deploys to **Vercel**; the FastAPI backend runs on
**Fly.io** with a persistent volume for `edgecast.db`. Vercel rewrites `/api/*` to the Fly
app, so the browser talks same-origin and no CORS setup is needed. The backend's built-in
daemon freezes tomorrow's ladder at 11 AM ET regardless of whether anyone has the dashboard
open.

## One-time setup

### Backend → Fly.io

```bash
brew install flyctl          # if not installed
fly auth login

# From the repo root. Keep the generated app name (or pick your own — then update
# web/vercel.json to match), say NO to Postgres/Redis, NO to deploy-now:
fly launch --copy-config --no-deploy

# Persistent disk for edgecast.db (snapshots + verification history):
fly volumes create edgecast_data --region iad --size 1

fly deploy
```

Check it: `curl https://<your-app>.fly.dev/api/live | head -c 200`

Optionally seed history from your local database (so the hosted app starts with your
30-day verification record instead of an empty store):

```bash
fly ssh sftp shell   # then: put data/edgecast.db /data/edgecast.db
fly apps restart
```

### Frontend → Vercel

1. Update `web/vercel.json` — set the rewrite destination to your Fly app URL.
2. Push the repo to GitHub.
3. In Vercel: **Add New Project** → import the repo → set **Root Directory = `web`**
   (framework auto-detects Vite; build `npm run build`, output `dist`). Deploy.

Or with the CLI:

```bash
cd web && npx vercel --prod   # first run walks through project setup; pick web as root
```

## Day-to-day

- `fly deploy` after backend changes; Vercel redeploys on git push.
- `fly logs` tails the API; the snapshot daemon logs nothing when idle.
- The 11 AM ET snapshot is automatic (in-server daemon, checked every 5 minutes).
  Manual capture if ever needed: `fly ssh console -C "edgecast snapshot --db /data/edgecast.db"`.

## Costs / notes

- Fly: one `shared-cpu-1x` 512 MB machine, always-on, ~free-tier / a few $ per month.
- Vercel hobby tier covers the static frontend.
- No secrets are involved — Kalshi, Open-Meteo, and ACIS are all public, unauthenticated APIs.
