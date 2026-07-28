// "Minimize to corner" mode.
//
// Best case: system Picture-in-Picture — the farm is DOM and PiP only accepts
// <video>, so we mirror the colony onto a canvas, capture it as a live stream,
// and hand that to the PiP player. On iPhone/iPad the window then floats over
// OTHER apps too.
//
// iOS WebKit (Safari AND Chrome on iOS) is picky: the video must be visibly
// rendered and must have produced a frame before PiP is requested, and some
// modes (e.g. home-screen standalone) refuse system PiP entirely. So when the
// system player says no, we fall back to an in-page corner widget: the same
// live canvas, draggable, pinned above the page.

import { getColonySnapshot } from "./main.js";

const FPS = 24;
const W = 480;
const H = 320;
const PAD = 10;

const btn = document.getElementById("pip-btn");

const css = getComputedStyle(document.documentElement);
const C = {
  bg: css.getPropertyValue("--bg").trim() || "#12140f",
  soil: css.getPropertyValue("--soil").trim() || "#1c1a12",
  line: css.getPropertyValue("--soil-line").trim() || "#33301f",
  text: css.getPropertyValue("--text").trim() || "#eae6d8",
  dim: css.getPropertyValue("--text-dim").trim() || "#a8a290",
  accent: css.getPropertyValue("--accent").trim() || "#d9c25a",
  ok: css.getPropertyValue("--ok").trim() || "#6fbf73",
  danger: css.getPropertyValue("--danger").trim() || "#e0654f",
};

const canvas = document.createElement("canvas");
canvas.width = W * 2; // render at 2x for a crisp window
canvas.height = H * 2;
const ctx = canvas.getContext("2d");
ctx.scale(2, 2);

let video = null;
let stream = null;
let drawTimer = null;
let mode = null; // "pip" | "corner" | null
let corner = null;

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function statusColor(status) {
  if (status === "done") return C.ok;
  if (status === "error") return C.danger;
  return C.accent;
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const snapshot = getColonySnapshot();

  // header
  ctx.fillStyle = C.text;
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.fillText("🐜 Ant Farm", PAD, 18);
  ctx.fillStyle = C.dim;
  ctx.font = "10px system-ui, sans-serif";
  const total = snapshot.reduce((n, t) => n + t.ants.length, 0);
  const label = total === 0 ? "colony idle" : `${total} agent${total === 1 ? "" : "s"} working`;
  ctx.fillText(label, W - PAD - ctx.measureText(label).width, 18);

  const top = 26;
  if (snapshot.length === 0) {
    ctx.fillStyle = C.dim;
    ctx.font = "12px system-ui, sans-serif";
    const msg = "No agents active right now";
    ctx.fillText(msg, (W - ctx.measureText(msg).width) / 2, H / 2);
    return;
  }

  // territory grid
  const cols = snapshot.length === 1 ? 1 : 2;
  const rows = Math.ceil(snapshot.length / cols);
  const cw = (W - PAD * (cols + 1)) / cols;
  const ch = (H - top - PAD * (rows + 1)) / rows;

  snapshot.forEach((t, i) => {
    const gx = PAD + (i % cols) * (cw + PAD);
    const gy = top + PAD + Math.floor(i / cols) * (ch + PAD);

    ctx.fillStyle = C.soil;
    ctx.strokeStyle = C.line;
    roundRect(gx, gy, cw, ch, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = C.dim;
    ctx.font = "600 9px system-ui, sans-serif";
    ctx.fillText(`${t.repo} (${t.ants.length})`, gx + 7, gy + 13);

    for (const ant of t.ants) {
      const ax = gx + 6 + (ant.x / t.w) * (cw - 12);
      const ay = gy + 16 + (ant.y / t.h) * (ch - 22);

      ctx.globalAlpha = ant.fading ? 0.3 : 1;
      ctx.fillStyle = ant.color;
      ctx.beginPath();
      ctx.arc(ax, ay, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ax, ay - 4.5, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ax, ay + 5, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "8px system-ui, sans-serif";
      ctx.fillStyle = C.text;
      ctx.fillText(ant.name, ax + 8, ay - 2);
      ctx.fillStyle = statusColor(ant.status);
      ctx.fillText(ant.step || "", ax + 8, ay + 8);
      ctx.globalAlpha = 1;
    }
  });
}

function startDrawing() {
  if (drawTimer) return;
  draw();
  drawTimer = setInterval(draw, 1000 / FPS);
}

function stopDrawing() {
  clearInterval(drawTimer);
  drawTimer = null;
}

function ensureVideo() {
  if (video) return video;
  video = document.createElement("video");
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.className = "pip-video";
  document.body.appendChild(video);
  video.addEventListener("leavepictureinpicture", () => {
    if (mode === "pip") deactivate();
  });
  video.addEventListener("webkitpresentationmodechanged", () => {
    if (mode === "pip" && video.webkitPresentationMode !== "picture-in-picture") {
      deactivate();
    }
  });
  return video;
}

// WebKit refuses PiP for a video that hasn't rendered a frame yet.
function waitForFrame(v) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    if (typeof v.requestVideoFrameCallback === "function") {
      v.requestVideoFrameCallback(finish);
    } else {
      v.addEventListener("timeupdate", finish, { once: true });
    }
    setTimeout(finish, 1500);
  });
}

async function trySystemPip() {
  const v = ensureVideo();
  if (!stream) {
    stream = canvas.captureStream(FPS);
    v.srcObject = stream;
  }
  v.classList.add("live"); // must be visibly rendered for WebKit
  await v.play();
  await waitForFrame(v);

  if (document.pictureInPictureEnabled && v.requestPictureInPicture) {
    await v.requestPictureInPicture();
  } else if (typeof v.webkitSetPresentationMode === "function") {
    v.webkitSetPresentationMode("picture-in-picture");
    // the webkit call doesn't throw on refusal — verify it actually happened
    await new Promise((r) => setTimeout(r, 400));
    if (v.webkitPresentationMode !== "picture-in-picture") {
      throw new Error("WebKit refused picture-in-picture");
    }
  } else {
    throw new Error("no picture-in-picture API");
  }
  mode = "pip";
}

function makeDraggable(el) {
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pip-corner-close")) return;
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
    const r = el.getBoundingClientRect();
    ox = r.left;
    oy = r.top;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    el.style.left = `${ox + e.clientX - sx}px`;
    el.style.top = `${oy + e.clientY - sy}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  });
  el.addEventListener("pointerup", () => {
    dragging = false;
  });
}

function openCorner() {
  corner = document.createElement("div");
  corner.className = "pip-corner";
  corner.appendChild(canvas);
  const close = document.createElement("button");
  close.className = "pip-corner-close";
  close.setAttribute("aria-label", "Close mini farm");
  close.textContent = "✕";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    deactivate();
  });
  corner.appendChild(close);
  document.body.appendChild(corner);
  makeDraggable(corner);
  mode = "corner";
}

function deactivate() {
  if (mode === "pip" && video) {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else if (video.webkitPresentationMode === "picture-in-picture") {
      video.webkitSetPresentationMode("inline");
    }
    video.classList.remove("live");
    video.pause();
  }
  if (mode === "corner" && corner) {
    corner.remove();
    corner = null;
  }
  mode = null;
  stopDrawing();
  btn.textContent = "⤡ Minimize";
}

btn.addEventListener("click", async () => {
  if (mode) {
    deactivate();
    return;
  }
  startDrawing();
  try {
    await trySystemPip();
  } catch (err) {
    // System PiP unavailable (common on iOS for canvas streams and in
    // home-screen standalone mode) — use the in-page corner widget instead.
    console.warn("System PiP unavailable, using in-page corner:", err);
    if (video) {
      video.classList.remove("live");
      video.pause();
    }
    openCorner();
  }
  btn.textContent = "⤢ Restore";
});
