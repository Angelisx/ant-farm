// Picture-in-Picture "minimize to corner" mode.
//
// The farm itself is DOM, and system PiP only accepts <video> — so we mirror
// the colony onto a hidden canvas, capture it as a live stream, and hand that
// to the PiP player. On iPhone/iPad the resulting window floats over OTHER
// apps too, so the ants keep crawling in the corner while you do anything else.

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
canvas.width = W * 2; // render at 2x for a crisp PiP window
canvas.height = H * 2;
const ctx = canvas.getContext("2d");
ctx.scale(2, 2);

const video = document.createElement("video");
video.muted = true;
video.playsInline = true;
video.setAttribute("playsinline", "");
video.setAttribute("webkit-playsinline", "");
video.className = "pip-video";
document.body.appendChild(video);

let stream = null;
let drawTimer = null;
let active = false;

function supported() {
  if (document.pictureInPictureEnabled) return true;
  if (
    typeof video.webkitSupportsPresentationMode === "function" &&
    video.webkitSupportsPresentationMode("picture-in-picture")
  ) {
    return true;
  }
  return false;
}

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
  ctx.fillText(
    total === 0 ? "colony idle" : `${total} agent${total === 1 ? "" : "s"} working`,
    W - PAD - ctx.measureText(total === 0 ? "colony idle" : `${total} agent${total === 1 ? "" : "s"} working`).width,
    18
  );

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
      // body: three dots along the heading angle, like the real ant
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

function setActive(on) {
  active = on;
  btn.textContent = on ? "⤢ Restore" : "⤡ Minimize";
  if (!on) {
    stopDrawing();
    video.pause();
  }
}

async function enterPip() {
  startDrawing();
  if (!stream) {
    stream = canvas.captureStream(FPS);
    video.srcObject = stream;
  }
  await video.play();
  if (video.requestPictureInPicture) {
    await video.requestPictureInPicture();
  } else {
    video.webkitSetPresentationMode("picture-in-picture");
  }
  setActive(true);
}

async function exitPip() {
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
  } else if (video.webkitPresentationMode === "picture-in-picture") {
    video.webkitSetPresentationMode("inline");
  }
  setActive(false);
}

video.addEventListener("leavepictureinpicture", () => setActive(false));
video.addEventListener("webkitpresentationmodechanged", () => {
  if (video.webkitPresentationMode !== "picture-in-picture") setActive(false);
});

btn.addEventListener("click", async () => {
  try {
    if (active) {
      await exitPip();
    } else {
      await enterPip();
    }
  } catch (err) {
    console.error("PiP failed:", err);
    setActive(false);
    window.alert(
      "Couldn't open the floating window. On iPhone this needs Safari (iOS 15+); if the site is open as a home-screen app, try it in Safari instead."
    );
  }
});

if (!supported()) {
  btn.style.display = "none";
}
