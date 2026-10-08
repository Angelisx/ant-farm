# Ant Farm telemetry publisher

A tiny, dependency-light script that pushes real agent telemetry into the
same Supabase tables the dashboard reads from (`agent_runs`, `agent_events`,
`agent_logs`). Use it from any agent process (Hermes task, Multica agent
run, a CI job, etc.) to make the dashboard show real work instead of the
demo seeder.

## Setup

```bash
cd publisher
npm install
cp .env.example .env   # fill in SUPABASE_URL + SUPABASE_ANON_KEY (same values as the frontend's .env.local)
```

## CLI usage

Start a run (creates a row in `agent_runs`, returns its id):

```bash
node publish.js start --agent "SORA" --repo "ant-farm" --task "Rebuild worker dashboard"
# -> prints: RUN_ID=<uuid>
```

Push a status/progress/thinking update (call this often — every step,
every few seconds, or every tool call):

```bash
node publish.js update --run "$RUN_ID" \
  --status running \
  --step editing \
  --thinking "Rewriting src/main.js to add the detail panel" \
  --file src/main.js \
  --progress 45
```

Append a log line (for the "work preview" log tail pane):

```bash
node publish.js log --run "$RUN_ID" --line "+ added detail panel renderer"
```

Mark blocked / done / error:

```bash
node publish.js update --run "$RUN_ID" --status blocked --reason "waiting on CI"
node publish.js update --run "$RUN_ID" --status done
node publish.js update --run "$RUN_ID" --status error --thinking "Hit an unrecoverable error"
```

## Programmatic usage (same script, as a module)

```js
import { startRun, updateRun, pushLog } from "./publish.js";

const runId = await startRun({ agent: "SORA", repo: "ant-farm", task: "..." });
await updateRun(runId, { status: "running", step: "editing", thinking: "...", file: "src/main.js", progress: 50 });
await pushLog(runId, "npm test passed");
await updateRun(runId, { status: "done" });
```

## Wiring into Hermes / Multica (manual, until a native webhook exists)

There is currently no automatic Hermes-task-lifecycle -> Supabase webhook.
The intended integration point: wrap long-running delegated work (e.g. a
Claude Code / Codex subagent invocation) with `start_run` at the beginning
and `update_run`/`push_log` calls at each major step, then `update_run`
with `status: done|error` at the end. This can be done either:

- by having the orchestrating agent call this CLI directly via `terminal`
  at each step (simplest, no new infra), or
- by building a small polling bridge that tails Multica's issue/comment
  activity via its API and mirrors each comment into `agent_logs` /
  `agent_runs.thinking` (more automatic, more moving parts — not built yet,
  left as a documented next step since it needs a persistent process).
