# Ant Farm

A live visualization of AI coding agents working across repos, styled like an ant colony. Each active agent run is rendered as a critter wandering inside a "territory" for its repo, color-coded by agent name, with a status bubble showing what it's currently doing. Runs fade out when they finish or go stale.

Data comes from two Supabase tables via Realtime:

- `agent_runs` — one row per agent run (`agent_name`, `repo`, `task`, `status`, `current_step`, `message`, timestamps)
- `agent_events` — a log of discrete events per run (`event_type`, `detail`)

## Local development

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL + anon key
npm run dev
```

## Demo mode

No real agent writing to Supabase yet? Click **"Seed demo colony"** in the top bar — it inserts a handful of fake runs/events into the real tables and walks them through a scripted lifecycle (planning → exploring → editing → testing → committing → done), so you can see the whole pipeline (insert → realtime → render → fade out) working end to end.

## Build

```bash
npm run build
```

Deploys as a static site (Vite build output in `dist/`). Requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars at build time.
