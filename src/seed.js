import { supabase } from "./supabase.js";

const DEMO_AGENTS = ["feature", "ui", "perf", "bugfix"];
const DEMO_REPOS = ["card-tracker", "ant-farm", "personal-dashboard"];

const FILES_BY_STEP = {
  planning: null,
  exploring: ["src/main.js", "src/App.tsx", "README.md"],
  editing: ["src/components/Card.tsx", "src/lib/utils.ts", "src/main.js"],
  testing: ["tests/app.test.ts"],
  committing: null,
};

const THINKING_SCRIPT = {
  planning: [
    "Reading the task description and checking repo layout…",
    "Looks like this touches the dashboard module — scanning for related components.",
  ],
  exploring: [
    "Searching for where this feature would plug in...",
    "Found 3 candidate files. Reading the most relevant one now.",
  ],
  editing: [
    "Drafting the change — adding the new prop and wiring state.",
    "Updating the component to handle the new case.",
    "Double-checking this doesn't break the existing layout.",
  ],
  testing: [
    "Running the test suite to confirm nothing broke.",
    "One test is flaky — re-running to confirm it's unrelated.",
  ],
  committing: [
    "Writing a commit message and pushing the branch.",
  ],
};

const LOG_SCRIPT = {
  planning: ["$ git status", "On branch main, nothing to commit"],
  exploring: ["$ rg -n 'TODO' src/", "12 matches across 4 files"],
  editing: ["> editing src/components/Card.tsx", "+ added prop `status`", "+ wired conditional render"],
  testing: ["$ npm test", "PASS src/App.test.tsx", "Tests: 14 passed, 14 total"],
  committing: ["$ git commit -m 'feat: add status prop'", "$ git push origin feature/status-prop"],
};

const STEP_SCRIPT = [
  { step: "planning", delayMs: 1200 },
  { step: "exploring", delayMs: 1800 },
  { step: "editing", delayMs: 2200 },
  { step: "testing", delayMs: 1800 },
  { step: "committing", delayMs: 1200 },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logLine(runId, line) {
  await supabase.from("agent_logs").insert({ run_id: runId, line }).then(
    () => {},
    () => {} // agent_logs may not exist yet on an un-migrated project; ignore
  );
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
      thinking: `Starting work on "${task}"...`,
      progress_pct: 0,
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

  // Occasionally simulate a blocked run partway through, to exercise that
  // status visually (dashboard should clearly flag it, not just fade it).
  const willBlock = Math.random() < 0.18;

  for (let i = 0; i < STEP_SCRIPT.length; i++) {
    const step = STEP_SCRIPT[i];
    await wait(step.delayMs);

    const files = FILES_BY_STEP[step.step];
    const currentFile = files ? pick(files) : null;
    const thinkingLines = THINKING_SCRIPT[step.step] || [];
    const progress = Math.round(((i + 1) / STEP_SCRIPT.length) * 90);

    if (willBlock && step.step === "testing") {
      await supabase
        .from("agent_runs")
        .update({
          status: "blocked",
          current_step: step.step,
          message: "Waiting on a flaky CI runner",
          thinking: "Test run hung — waiting on CI before retrying.",
          current_file: currentFile,
          progress_pct: progress,
          blocked_reason: "CI runner unresponsive for >60s; will retry automatically.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", run.id);

      await supabase.from("agent_events").insert({
        run_id: run.id,
        event_type: "blocked",
        detail: "Blocked: waiting on a flaky CI runner",
      });
      await logLine(run.id, "! CI runner unresponsive, retrying in 10s...");
      await wait(2500);
    }

    for (const line of thinkingLines) {
      await supabase
        .from("agent_runs")
        .update({
          current_step: step.step,
          message: line,
          thinking: line,
          current_file: currentFile,
          status: "running",
          progress_pct: progress,
          blocked_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", run.id);
      await wait(350);
    }

    for (const line of LOG_SCRIPT[step.step] || []) {
      await logLine(run.id, line);
      await wait(150);
    }

    await supabase.from("agent_events").insert({
      run_id: run.id,
      event_type: "step",
      detail: thinkingLines[thinkingLines.length - 1] || step.step,
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
      thinking:
        finalStatus === "done"
          ? "All good — branch pushed, ready for review."
          : "Ran into an unexpected error, stopping here.",
      progress_pct: finalStatus === "done" ? 100 : null,
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
