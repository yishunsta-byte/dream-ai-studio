/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- code migration step: restricted .cjs format run by lib/db/code-migration.ts */
// Product step 0005 helper (P2-1, T-060/T-061). Listed in the step's files after the entry. Synchronous code only.
const { createHash } = require("node:crypto");

// A stable UUID-shaped id (version 8) from a source text, so the same database gives the same ids.
function derivedUuid(source) {
  const hex = createHash("sha256").update("dream-0005:" + source).digest("hex");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-8" + hex.slice(13, 16) + "-" + ((parseInt(hex[16], 16) & 3) | 8).toString(16) + hex.slice(17, 20) + "-" + hex.slice(20, 32);
}
function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
// Key-sorted JSON without spaces, arrays in order (same rule as canonicalJson in lib/edit/timeline.ts).
function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
// spec secondsToFrames: round(seconds x 30) with 0.5 rounding up, in integers only.
function secondsToFrames(seconds) {
  const ms = Math.round(seconds * 1000);
  return Math.floor((ms * 30 + 500) / 1000);
}
// spec text-presets.json migration.fromP1Values.
const P1_Y = { top: 0.16, middle: 0.5, bottom: 0.74 };
const MAX_LINES = { subtitle: 2, hook: 2, emphasis: 1, title: 2, ending: 2, disclosure: 1 };
function textFromP1(layer) {
  const startFrame = secondsToFrames(layer.startSec);
  const endFrame = Math.max(secondsToFrames(layer.endSec), startFrame + 1);
  return {
    id: layer.id, kind: layer.kind, content: layer.content, speakerCharacterId: null,
    style: { fontFamily: "Pretendard", fontSize: layer.fontSize, fontWeight: 700, color: layer.color, stroke: null, shadow: null, background: null, align: "center", letterSpacing: 0, lineHeight: 1.3, maxLines: MAX_LINES[layer.kind] },
    box: { x: 0.44, y: P1_Y[layer.position], anchor: "center", widthRatio: 0.76, rotation: 0 },
    timing: { startFrame: startFrame, endFrame: endFrame },
    animation: { in: "none", out: "none", emphasis: "none", durationFrames: 0, easing: "ease-out" },
    locked: layer.locked,
  };
}
module.exports = { derivedUuid, sha256, canonicalJson, secondsToFrames, textFromP1, MAX_LINES, P1_Y };
