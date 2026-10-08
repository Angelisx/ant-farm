-- Worker Dashboard upgrade: richer live telemetry columns on agent_runs,
-- plus a dedicated log-line table so "work preview" panes can show a
-- real tailing log instead of just the latest message.

alter table public.agent_runs
  add column if not exists thinking text,              -- live reasoning/thinking stream, latest chunk
  add column if not exists current_file text,            -- file currently being read/edited
  add column if not exists progress_pct int,              -- optional 0-100 progress indicator
  add column if not exists blocked_reason text;           -- why a run is blocked (status = 'blocked')

-- Allow 'blocked' as a first-class status value alongside running/idle/done/error.
-- (No enum constraint existed previously - status is free-text - so this is
-- documentation only; the frontend now renders 'blocked' distinctly.)

create table if not exists public.agent_logs (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  line text not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_logs_run_id_created_at_idx
  on public.agent_logs (run_id, created_at desc);

alter table public.agent_logs enable row level security;

-- Mirror whatever permissive policy already exists on agent_runs/agent_events:
-- allow anon select (dashboard reads) and anon insert (demo seeding /
-- lightweight publisher using the anon key). Tighten later if this ever
-- carries sensitive data.
drop policy if exists "anon select agent_logs" on public.agent_logs;
create policy "anon select agent_logs" on public.agent_logs
  for select using (true);

drop policy if exists "anon insert agent_logs" on public.agent_logs;
create policy "anon insert agent_logs" on public.agent_logs
  for insert with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_logs'
  ) then
    alter publication supabase_realtime add table public.agent_logs;
  end if;
end $$;
