#!/usr/bin/env node
// Lightweight telemetry publisher: pushes real agent run/status/log data
// into the Supabase tables the Ant Farm dashboard reads from, so the
// dashboard shows real work instead of the demo seeder.
//
// Usage: see README.md. Works both as a CLI and as an importable module.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

function client() {
  if (!url || !anonKey) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_ANON_KEY. Copy publisher/.env.example to publisher/.env and fill them in."
    );
  }
  return createClient(url, anonKey);
}

export async function startRun({ agent, repo, task, status = "running", step = "starting" }) {
  const supabase = client();
  const { data, error } = await supabase
    .from("agent_runs")
    .insert({
      agent_name: agent,
      repo,
      task,
      status,
      current_step: step,
      message: task ? `Starting "${task}"` : "Starting",
      thinking: task ? `Starting work on "${task}"...` : "Starting...",
      progress_pct: 0,
    })
    .select()
    .single();
  if (error) throw new Error(`startRun failed: ${error.message}`);

  await supabase.from("agent_events").insert({
    run_id: data.id,
    event_type: "start",
    detail: `${agent} picked up "${task || "a task"}" in ${repo}`,
  });

  return data.id;
}

export async function updateRun(
  runId,
  { status, step, thinking, message, file, progress, reason } = {}
) {
  const supabase = client();
  const patch = { updated_at: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (step !== undefined) patch.current_step = step;
  if (thinking !== undefined) patch.thinking = thinking;
  if (message !== undefined) patch.message = message;
  if (file !== undefined) patch.current_file = file;
  if (progress !== undefined) patch.progress_pct = progress;
  if (reason !== undefined) patch.blocked_reason = reason;
  if (status && status !== "blocked") patch.blocked_reason = null;

  const { error } = await supabase.from("agent_runs").update(patch).eq("id", runId);
  if (error) throw new Error(`updateRun failed: ${error.message}`);

  if (status) {
    await supabase.from("agent_events").insert({
      run_id: runId,
      event_type: status,
      detail: message || thinking || status,
    });
  }
}

export async function pushLog(runId, line) {
  const supabase = client();
  const { error } = await supabase.from("agent_logs").insert({ run_id: runId, line });
  if (error) throw new Error(`pushLog failed: ${error.message}`);
}

// --- CLI ---

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);

  if (cmd === "start") {
    const id = await startRun({
      agent: args.agent,
      repo: args.repo,
      task: args.task,
      status: args.status,
      step: args.step,
    });
    console.log(`RUN_ID=${id}`);
    return;
  }

  if (cmd === "update") {
    await updateRun(args.run, {
      status: args.status,
      step: args.step,
      thinking: args.thinking,
      message: args.message,
      file: args.file,
      progress: args.progress !== undefined ? Number(args.progress) : undefined,
      reason: args.reason,
    });
    console.log("ok");
    return;
  }

  if (cmd === "log") {
    await pushLog(args.run, args.line);
    console.log("ok");
    return;
  }

  console.error(
    "Usage:\n" +
      "  node publish.js start --agent NAME --repo REPO --task \"...\"\n" +
      "  node publish.js update --run RUN_ID [--status running|idle|blocked|done|error] [--step STEP] [--thinking \"...\"] [--file PATH] [--progress 0-100] [--reason \"...\"]\n" +
      "  node publish.js log --run RUN_ID --line \"...\""
  );
  process.exit(1);
}

// Only run the CLI when executed directly (not when imported as a module).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
