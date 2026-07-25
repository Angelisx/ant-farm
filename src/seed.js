import { supabase } from "./supabase.js";

const DEMO_AGENTS = ["feature", "ui", "perf", "bugfix"];
const DEMO_REPOS = ["card-tracker", "ant-farm", "personal-dashboard"];

const STEP_SCRIPT = [
  { step: "planning", detail: "Reading task description and repo layout", delayMs: 1200 },
  { step: "exploring", detail: "Searching for related files", delayMs: 1800 },
  { step: "editing", detail: "Writing changes to source files", delayMs: 2200 },
  { step: "testing", detail: "Running test suite", delayMs: 1800 },
  { step: "committing", detail: "Committing and pushing changes", delayMs: 1200 },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOneDemoAgent(index) {
  const agent_name = DEMO_AGENTS[index % DEMO_AGENTS.length];
  const repo = pick(DEMO_REPOS);
  const task = pick([
    "Add dark mode toggle",
    "Fix flaky pagination test",
    "Speed up dashboard query",
    "Refactor auth middleware",
    "Add empty-state illustration",
  ]);

  const { data: run, error } = await supabase
    .from("agent_runs")
    .insert({
      agent_name,
      repo,
      task,
      status: "running",
      current_step: "starting",
      message: `Kicking off "${task}"`,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Insert into agent_runs failed: ${error.message}`);
  }

  await supabase.from("agent_events").insert({
    run_id: run.id,
    event_type: "start",
    detail: `${agent_name} picked up "${task}" in ${repo}`,
  });

  for (const step of STEP_SCRIPT) {
    await wait(step.delayMs);
    await supabase
      .from("agent_runs")
      .update({
        current_step: step.step,
        message: step.detail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    await supabase.from("agent_events").insert({
      run_id: run.id,
      event_type: "step",
      detail: step.detail,
    });
  }

  const finalStatus = Math.random() < 0.85 ? "done" : "error";
  await supabase
    .from("agent_runs")
    .update({
      status: finalStatus,
      current_step: finalStatus,
      message:
        finalStatus === "done"
          ? "Finished up and pushed the branch"
          : "Hit an error and stopped",
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.id);

  await supabase.from("agent_events").insert({
    run_id: run.id,
    event_type: finalStatus === "done" ? "done" : "error",
    detail:
      finalStatus === "done"
        ? "Run completed successfully"
        : "Run failed partway through",
  });
}

export async function seedDemoColony(count = 4) {
  const jobs = [];
  for (let i = 0; i < count; i++) {
    // Stagger starts slightly so ants don't all spawn on the exact same frame.
    jobs.push(wait(i * 350).then(() => runOneDemoAgent(i)));
  }
  const results = await Promise.allSettled(jobs);
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length) {
    console.error("Some demo agents failed to seed:", failures);
    throw failures[0].reason;
  }
}
