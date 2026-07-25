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

const farmEl = document.getElementById("farm");
const legendEl = document.getElementById("legend");
const statusEl = document.getElementById("connection-status");
const seedBtn = document.getElementById("seed-btn");

/** repo (string) -> { el, laneEl, countEl } */
const territories = new Map();
/** run id (string) -> RunState */
const runs = new Map();
/** agent_name -> color */
const agentColors = new Map();

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

function createRunEl(run) {
  const color = colorForAgent(run.agent_name);

  const el = document.createElement("div");
  el.className = "critter";
  el.style.color = color;

  const tag = document.createElement("div");
  tag.className = "agent-tag";
  tag.textContent = run.agent_name;
  el.appendChild(tag);

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `<span class="step"></span><span class="msg"></span>`;
  el.appendChild(bubble);

  const body = document.createElement("div");
  body.className = "body";
  body.innerHTML = ANT_SVG;
  el.appendChild(body);

  return { el, tag, bubble, body, stepEl: bubble.querySelector(".step"), msgEl: bubble.querySelector(".msg") };
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
}

function applyRunData(state, row) {
  state.dom.stepEl.textContent = row.current_step || row.status;
  state.dom.msgEl.textContent = row.message || "";
  state.dom.el.classList.remove("status-running", "status-idle", "status-done", "status-error");
  state.dom.el.classList.add(`status-${row.status}`);

  if (state.removeTimer) {
    clearTimeout(state.removeTimer);
    state.removeTimer = null;
  }

  if (row.status === "done" || row.status === "error") {
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
}

function animate(timestamp) {
  for (const state of runs.values()) {
    if (state.fading) continue;
    if (!state.lastFrame) state.lastFrame = timestamp;
    const dt = Math.min(0.1, (timestamp - state.lastFrame) / 1000);
    state.lastFrame = timestamp;

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

    const step = state.speed * dt;
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
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setConnectionStatus("connected");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnectionStatus("error");
      else setConnectionStatus("connecting");
    });

  return channel;
}

seedBtn.addEventListener("click", async () => {
  seedBtn.disabled = true;
  seedBtn.textContent = "Seeding…";
  try {
    await seedDemoColony(4);
  } catch (err) {
    console.error(err);
    window.alert(
      `Couldn't seed demo data: ${err.message}\n\nCheck that the anon role has INSERT/UPDATE permissions on agent_runs and agent_events (RLS policies).`
    );
  } finally {
    seedBtn.disabled = false;
    seedBtn.textContent = "Seed demo colony";
  }
});

updateEmptyHint();
setConnectionStatus("connecting");
loadInitialRuns();
subscribeRealtime();
setInterval(checkStaleness, POLL_STALE_MS);
requestAnimationFrame(animate);
