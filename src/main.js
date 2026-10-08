import { supabase } from "./supabase.js";
import { seedDemoColony } from "./seed.js";

const PALETTE = [
  "#d9c25a", // amber
  "#6fbf73", // green
  "#5aa9d9", // blue
  "#d97d5a", // orange
  "#b06fd9", // purple
  "#5ad9c2", // teal
  "#d95a8f", // pink
  "#9fd95a", // lime
];

const STALE_RUNNING_MS = 90_000; // no update in 90s while "running"/"idle" -> assume dead
const DONE_GRACE_MS = 12_000; // keep a "done"/"error" ant visible this long before fading
const FADE_MS = 650;
const POLL_STALE_MS = 4_000;
const MAX_THINKING_LINES = 30;
const MAX_LOG_LINES = 100;
const MAX_FEED_ITEMS = 60;
const DONE_WINDOW_MS = 60 * 60 * 1000;

const farmEl = document.getElementById("farm");
const legendEl = document.getElementById("legend");
const statusEl = document.getElementById("connection-status");
const seedBtn = document.getElementById("seed-btn");
const detailPanelEl = document.getElementById("detail-panel");
const activityFeedEl = document.getElementById("activity-feed");
const statWorkingEl = document.getElementById("stat-working");
const statBlockedEl = document.getElementById("stat-blocked");
const statReposEl = document.getElementById("stat-repos");
const statDoneEl = document.getElementById("stat-done");

/** repo (string) -> { el, laneEl, countEl } */
const territories = new Map();
/** run id (string) -> RunState */
const runs = new Map();
/** agent_name -> color */
const agentColors = new Map();
/** run id -> array of { text, at } thinking snippets, newest last */
const thinkingByRun = new Map();
/** run id -> array of { line, at } log lines, newest last */
const logsByRun = new Map();
/** run id -> completion timestamp (ms), pruned after DONE_WINDOW_MS */
const completedAt = new Map();

let selectedRunId = null;
let emptyHintEl = null;

function colorForAgent(name) {
  if (agentColors.has(name)) return agentColors.get(name);
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const color = PALETTE[hash % PALETTE.length];
  agentColors.set(name, color);
  renderLegend();
  return color;
}

function renderLegend() {
  legendEl.innerHTML = "";
  for (const [name, color] of agentColors.entries()) {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `<span class="legend-swatch" style="background:${color}"></span>${name}`;
    legendEl.appendChild(item);
  }
}

function updateEmptyHint() {
  if (runs.size === 0) {
    if (!emptyHintEl) {
      emptyHintEl = document.createElement("div");
      emptyHintEl.className = "empty-hint";
      emptyHintEl.textContent =
        "No agents are active right now. Click \"Seed demo colony\" to see the visualization in action.";
      farmEl.appendChild(emptyHintEl);
    }
  } else if (emptyHintEl) {
    emptyHintEl.remove();
    emptyHintEl = null;
  }
}

function ensureTerritory(repo) {
  if (territories.has(repo)) return territories.get(repo);

  const el = document.createElement("div");
  el.className = "territory";

  const label = document.createElement("div");
  label.className = "territory-label";
  label.innerHTML = `${repo} <span class="territory-count">(0)</span>`;
  el.appendChild(label);

  farmEl.appendChild(el);

  const territory = { el, countEl: label.querySelector(".territory-count"), count: 0 };
  territories.set(repo, territory);
  return territory;
}

function bumpTerritoryCount(repo, delta) {
  const t = territories.get(repo);
  if (!t) return;
  t.count += delta;
  t.countEl.textContent = `(${t.count})`;
}

const ANT_SVG = `
<svg viewBox="-13 -13 26 26" xmlns="http://www.w3.org/2000/svg">
  <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="currentColor">
    <ellipse cx="0" cy="-6" rx="2.6" ry="2.4" />
    <ellipse cx="0" cy="0" rx="3.2" ry="3.6" />
    <ellipse cx="0" cy="6.5" rx="4.2" ry="4.8" />
    <line x1="-2.5" y1="-1" x2="-9" y2="-4" />
    <line x1="2.5" y1="-1" x2="9" y2="-4" />
    <line x1="-3" y1="1" x2="-9.5" y2="1.5" />
    <line x1="3" y1="1" x2="9.5" y2="1.5" />
    <line x1="-2.5" y1="3" x2="-9" y2="7" />
    <line x1="2.5" y1="3" x2="9" y2="7" />
    <line x1="-1.2" y1="-8" x2="-3.5" y2="-11.5" stroke-width="0.9" />
    <line x1="1.2" y1="-8" x2="3.5" y2="-11.5" stroke-width="0.9" />
  </g>
</svg>`;

const STATUS_BADGE = {
  running: { label: "working", cls: "badge-running" },
  idle: { label: "idle", cls: "badge-idle" },
  blocked: { label: "blocked", cls: "badge-blocked" },
  done: { label: "done", cls: "badge-done" },
  error: { label: "error", cls: "badge-error" },
};

function createRunEl(run) {
  const color = colorForAgent(run.agent_name);

  const el = document.createElement("div");
  el.className = "critter";
  el.style.color = color;
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.addEventListener("click", () => selectRun(run.id));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") selectRun(run.id);
  });

  const tag = document.createElement("div");
  tag.className = "agent-tag";
  tag.textContent = run.agent_name;
  el.appendChild(tag);

  const badge = document.createElement("div");
  badge.className = "status-dot";
  el.appendChild(badge);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `<span class="step"></span><span class="msg"></span>`;
  el.appendChild(bubble);

  const body = document.createElement("div");
  body.className = "body";
  body.innerHTML = ANT_SVG;
  el.appendChild(body);

  return {
    el,
    tag,
    badge,
    bubble,
    body,
    stepEl: bubble.querySelector(".step"),
    msgEl: bubble.querySelector(".msg"),
  };
}

function randomTarget(territoryEl) {
  const w = territoryEl.clientWidth || 340;
  const h = territoryEl.clientHeight || 220;
  return {
    x: 16 + Math.random() * Math.max(1, w - 48),
    y: 34 + Math.random() * Math.max(1, h - 60),
  };
}

function upsertRun(row) {
  const existing = runs.get(row.id);
  const territory = ensureTerritory(row.repo);

  if (!existing) {
    const dom = createRunEl(row);
    territory.el.appendChild(dom.el);
    bumpTerritoryCount(row.repo, 1);

    const start = randomTarget(territory.el);
    const state = {
      data: row,
      dom,
      territory,
      x: start.x,
      y: start.y,
      target: randomTarget(territory.el),
      speed: 12 + Math.random() * 14,
      pauseUntil: 0,
      removeTimer: null,
    };
    runs.set(row.id, state);
    state.dom.el.style.transform = `translate(${state.x}px, ${state.y}px)`;
    applyRunData(state, row);
  } else {
    existing.data = row;
    if (existing.territory !== territory) {
      // repo changed (shouldn't normally happen) - move DOM node
      bumpTerritoryCount(existing.data.repo, -1);
      territory.el.appendChild(existing.dom.el);
      existing.territory = territory;
      bumpTerritoryCount(row.repo, 1);
    }
    applyRunData(existing, row);
  }
  updateEmptyHint();
  recordThinking(row);
  updateStats();
  if (selectedRunId === row.id) renderDetailPanel();
}

function recordThinking(row) {
  if (!row.thinking) return;
  const list = thinkingByRun.get(row.id) || [];
  const last = list[list.length - 1];
  if (last && last.text === row.thinking) return;
  list.push({ text: row.thinking, at: row.updated_at || new Date().toISOString() });
  if (list.length > MAX_THINKING_LINES) list.shift();
  thinkingByRun.set(row.id, list);
}

function recordLog(runId, line, at) {
  const list = logsByRun.get(runId) || [];
  list.push({ line, at: at || new Date().toISOString() });
  if (list.length > MAX_LOG_LINES) list.shift();
  logsByRun.set(runId, list);
  if (selectedRunId === runId) renderDetailPanel();
}

function statusSpeedMultiplier(status) {
  if (status === "blocked") return 0;
  if (status === "idle") return 0.25;
  if (status === "done" || status === "error") return 0;
  return 1;
}

function applyRunData(state, row) {
  state.dom.stepEl.textContent = row.current_step || row.status;
  state.dom.msgEl.textContent = row.thinking || row.message || "";
  state.dom.el.classList.remove(
    "status-running",
    "status-idle",
    "status-done",
    "status-error",
    "status-blocked"
  );
  state.dom.el.classList.add(`status-${row.status}`);
  state.speedMultiplier = statusSpeedMultiplier(row.status);

  if (state.removeTimer) {
    clearTimeout(state.removeTimer);
    state.removeTimer = null;
  }

  if (row.status === "done" || row.status === "error") {
    completedAt.set(row.id, Date.now());
    updateStats();
    state.removeTimer = setTimeout(() => scheduleRemove(row.id), DONE_GRACE_MS);
  }
}

function scheduleRemove(id) {
  const state = runs.get(id);
  if (!state || state.fading) return;
  state.fading = true;
  state.dom.el.classList.add("fading");
  setTimeout(() => {
    state.dom.el.remove();
    bumpTerritoryCount(state.data.repo, -1);
    runs.delete(id);
    updateEmptyHint();
    updateStats();
    if (selectedRunId === id) {
      selectedRunId = null;
      renderDetailPanel();
    }
  }, FADE_MS);
}

function removeRun(id) {
  const state = runs.get(id);
  if (!state) return;
  scheduleRemove(id);
}

function flashEvent(runId, detail) {
  const state = runs.get(runId);
  if (!state) return;

  const flash = document.createElement("div");
  flash.className = "event-flash";
  flash.style.left = `${state.x + 13}px`;
  flash.style.top = `${state.y + 13}px`;
  state.territory.el.appendChild(flash);
  setTimeout(() => flash.remove(), 900);

  if (detail) {
    state.dom.msgEl.textContent = detail;
  }
}

function checkStaleness() {
  const now = Date.now();
  for (const [id, state] of runs.entries()) {
    if (state.fading) continue;
    const updatedAt = new Date(state.data.updated_at || state.data.started_at).getTime();
    const isTerminal = state.data.status === "done" || state.data.status === "error";
    if (!isTerminal && now - updatedAt > STALE_RUNNING_MS) {
      scheduleRemove(id);
    }
  }
  pruneCompleted(now);
}

function pruneCompleted(now) {
  let changed = false;
  for (const [id, at] of completedAt.entries()) {
    if (now - at > DONE_WINDOW_MS) {
      completedAt.delete(id);
      changed = true;
    }
  }
  if (changed) updateStats();
}

function updateStats() {
  let working = 0;
  let blocked = 0;
  const activeRepos = new Set();
  for (const state of runs.values()) {
    if (state.data.status === "running") working++;
    if (state.data.status === "blocked") blocked++;
    if (state.data.status === "running" || state.data.status === "blocked" || state.data.status === "idle") {
      activeRepos.add(state.data.repo);
    }
  }
  statWorkingEl.textContent = String(working);
  statBlockedEl.textContent = String(blocked);
  statReposEl.textContent = String(activeRepos.size);
  statDoneEl.textContent = String(completedAt.size);
}

function animate(timestamp) {
  for (const state of runs.values()) {
    if (state.fading) continue;
    if (!state.lastFrame) state.lastFrame = timestamp;
    const dt = Math.min(0.1, (timestamp - state.lastFrame) / 1000);
    state.lastFrame = timestamp;

    const mult = state.speedMultiplier ?? 1;
    if (mult === 0) continue; // blocked / idle-ish / terminal: hold position

    if (timestamp < state.pauseUntil) {
      continue;
    }

    const dx = state.target.x - state.x;
    const dy = state.target.y - state.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 3) {
      state.target = randomTarget(state.territory.el);
      state.pauseUntil = timestamp + Math.random() * 900;
      continue;
    }

    const step = state.speed * mult * dt;
    state.x += (dx / dist) * step;
    state.y += (dy / dist) * step;

    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    state.dom.body.style.transform = `rotate(${angle}deg)`;
    state.dom.el.style.transform = `translate(${state.x}px, ${state.y}px)`;
  }
  requestAnimationFrame(animate);
}

function setConnectionStatus(status) {
  statusEl.className = `status-pill status-${status}`;
  statusEl.textContent =
    status === "connected" ? "live" : status === "error" ? "connection error" : "connecting…";
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 1000) return "now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

function selectRun(id) {
  selectedRunId = selectedRunId === id ? null : id;
  for (const state of runs.values()) {
    state.dom.el.classList.toggle("selected", state.data.id === selectedRunId);
  }
  renderDetailPanel();
}

function renderDetailPanel() {
  if (!selectedRunId || !runs.has(selectedRunId)) {
    detailPanelEl.innerHTML = `<div class="detail-empty">Click an agent to see its live reasoning stream, current file, and log tail here.</div>`;
    return;
  }
  const state = runs.get(selectedRunId);
  const row = state.data;
  const badge = STATUS_BADGE[row.status] || STATUS_BADGE.idle;
  const thinking = thinkingByRun.get(selectedRunId) || [];
  const logs = logsByRun.get(selectedRunId) || [];

  detailPanelEl.innerHTML = `
    <div class="detail-head">
      <span class="detail-agent" style="color:${colorForAgent(row.agent_name)}">${escapeHtml(row.agent_name)}</span>
      <span class="status-badge ${badge.cls}">${badge.label}</span>
    </div>
    <div class="detail-repo">${escapeHtml(row.repo)}</div>
    <div class="detail-task">${escapeHtml(row.task || "")}</div>
    ${
      row.status === "blocked" && row.blocked_reason
        ? `<div class="detail-blocked">⚠ ${escapeHtml(row.blocked_reason)}</div>`
        : ""
    }
    ${
      typeof row.progress_pct === "number"
        ? `<div class="progress-bar"><div class="progress-fill" style="width:${Math.max(0, Math.min(100, row.progress_pct))}%"></div></div>`
        : ""
    }
    ${
      row.current_file
        ? `<div class="detail-file"><span class="detail-file-label">editing</span> <code>${escapeHtml(row.current_file)}</code></div>`
        : ""
    }
    <div class="detail-section-label">Reasoning stream</div>
    <div class="thinking-stream" id="thinking-stream">
      ${
        thinking.length
          ? thinking
              .map((t) => `<div class="thinking-line">${escapeHtml(t.text)}</div>`)
              .join("")
          : `<div class="thinking-line dim">No reasoning stream yet.</div>`
      }
    </div>
    <div class="detail-section-label">Log tail</div>
    <div class="log-tail" id="log-tail">
      ${
        logs.length
          ? logs
              .map((l) => `<div class="log-line">${escapeHtml(l.line)}</div>`)
              .join("")
          : `<div class="log-line dim">No log output yet.</div>`
      }
    </div>
  `;

  const thinkEl = detailPanelEl.querySelector("#thinking-stream");
  if (thinkEl) thinkEl.scrollTop = thinkEl.scrollHeight;
  const logEl = detailPanelEl.querySelector("#log-tail");
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

function pushFeedItem({ agent_name, repo, text, kind }) {
  const li = document.createElement("li");
  li.className = `feed-item feed-${kind || "info"}`;
  li.innerHTML = `
    <span class="feed-time">${timeAgo(new Date().toISOString())}</span>
    <span class="feed-agent" style="color:${colorForAgent(agent_name || "?")}">${escapeHtml(agent_name || "?")}</span>
    <span class="feed-repo">${escapeHtml(repo || "")}</span>
    <span class="feed-text">${escapeHtml(text || "")}</span>
  `;
  activityFeedEl.prepend(li);
  while (activityFeedEl.children.length > MAX_FEED_ITEMS) {
    activityFeedEl.removeChild(activityFeedEl.lastChild);
  }
}

async function loadInitialRuns() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("agent_runs")
    .select("*")
    .gte("updated_at", cutoff)
    .order("updated_at", { ascending: true });

  if (error) {
    console.error("Failed to load initial agent_runs:", error);
    return;
  }
  for (const row of data || []) {
    upsertRun(row);
  }
}

async function loadInitialLogs() {
  const { data, error } = await supabase
    .from("agent_logs")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) {
    // Table may not exist yet on an un-migrated project — non-fatal.
    console.warn("agent_logs not available yet:", error.message);
    return;
  }
  for (const row of data || []) {
    recordLog(row.run_id, row.line, row.created_at);
  }
}

function subscribeRealtime() {
  const channel = supabase
    .channel("ant-farm-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "agent_runs" },
      (payload) => {
        if (payload.eventType === "DELETE") {
          removeRun(payload.old.id);
        } else {
          upsertRun(payload.new);
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "agent_events" },
      (payload) => {
        flashEvent(payload.new.run_id, payload.new.detail);
        const state = runs.get(payload.new.run_id);
        pushFeedItem({
          agent_name: state?.data.agent_name,
          repo: state?.data.repo,
          text: payload.new.detail || payload.new.event_type,
          kind: payload.new.event_type === "error" ? "error" : "info",
        });
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "agent_logs" },
      (payload) => {
        recordLog(payload.new.run_id, payload.new.line, payload.new.created_at);
        const state = runs.get(payload.new.run_id);
        pushFeedItem({
          agent_name: state?.data.agent_name,
          repo: state?.data.repo,
          text: payload.new.line,
          kind: "log",
        });
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setConnectionStatus("connected");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnectionStatus("error");
      else setConnectionStatus("connecting");
    });

  return channel;
}

// Live state snapshot for the picture-in-picture mirror (src/pip.js).
export function getColonySnapshot() {
  const byRepo = new Map();
  for (const state of runs.values()) {
    const repo = state.data.repo;
    if (!byRepo.has(repo)) {
      const el = territories.get(repo)?.el;
      byRepo.set(repo, {
        repo,
        w: el?.clientWidth || 340,
        h: el?.clientHeight || 220,
        ants: [],
      });
    }
    byRepo.get(repo).ants.push({
      name: state.data.agent_name,
      color: colorForAgent(state.data.agent_name),
      x: state.x,
      y: state.y,
      step: state.data.current_step || state.data.status,
      status: state.data.status,
      fading: !!state.fading,
    });
  }
  return [...byRepo.values()];
}

seedBtn.addEventListener("click", async () => {
  seedBtn.disabled = true;
  seedBtn.textContent = "Seeding…";
  try {
    await seedDemoColony(4);
  } catch (err) {
    console.error(err);
    window.alert(
      `Couldn't seed demo data: ${err.message}\n\nCheck that the anon role has INSERT/UPDATE permissions on agent_runs, agent_events and agent_logs (RLS policies), and that the migrations in supabase/migrations have been applied.`
    );
  } finally {
    seedBtn.disabled = false;
    seedBtn.textContent = "Seed demo colony";
  }
});

updateEmptyHint();
setConnectionStatus("connecting");
loadInitialRuns();
loadInitialLogs();
subscribeRealtime();
setInterval(checkStaleness, POLL_STALE_MS);
setInterval(updateStats, 15_000);
requestAnimationFrame(animate);
