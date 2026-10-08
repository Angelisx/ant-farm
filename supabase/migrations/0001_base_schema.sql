-- Base schema for Ant Farm (idempotent). Tables were originally created
-- ad-hoc via the Supabase SQL editor and never checked into the repo —
-- this migration documents/recreates them so a fresh project (or restore)
-- can be bootstrapped from the CLI/MCP alone.

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  repo text not null,
  task text,
  status text not null default 'running',       -- running | idle | blocked | done | error
  current_step text,
  message text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  event_type text not null,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.agent_runs enable row level security;
alter table public.agent_events enable row level security;

drop policy if exists "anon select agent_runs" on public.agent_runs;
create policy "anon select agent_runs" on public.agent_runs for select using (true);
drop policy if exists "anon insert agent_runs" on public.agent_runs;
create policy "anon insert agent_runs" on public.agent_runs for insert with check (true);
drop policy if exists "anon update agent_runs" on public.agent_runs;
create policy "anon update agent_runs" on public.agent_runs for update using (true);

drop policy if exists "anon select agent_events" on public.agent_events;
create policy "anon select agent_events" on public.agent_events for select using (true);
drop policy if exists "anon insert agent_events" on public.agent_events;
create policy "anon insert agent_events" on public.agent_events for insert with check (true);

-- Enable Realtime on both tables.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_runs'
  ) then
    alter publication supabase_realtime add table public.agent_runs;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_events'
  ) then
    alter publication supabase_realtime add table public.agent_events;
  end if;
end $$;
