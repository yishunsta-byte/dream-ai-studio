/* global fetch, URL, Buffer, console */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { join } from "node:path";
import { promisify } from "node:util";
import { v7 } from "uuid";
import { mixAudio } from "../../lib/audio/mix.ts";
import { SAMPLE_RATE, SAMPLES_PER_FRAME } from "../../lib/audio/profile.ts";
import { actorFromVerifiedUserId } from "../../lib/db/postgres/types.ts";
import { mediaBinary } from "../../lib/media/tools.ts";
import { useLocalPgWavRenderInput } from "../../lib/render/local-pg-wav-input.ts";
import { verifyRender } from "../../lib/render/verify.ts";

const run = promisify(execFile);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function tone(frequency, durationMs) {
  const samples = durationMs * 8;
  const wav = Buffer.alloc(44 + 2 * samples);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(2 * samples, 40);
  for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * frequency * index / 8000)), 44 + 2 * index);
  return wav;
}

function amplitude(samples, frame, frequency) {
  let sine = 0, cosine = 0;
  for (let index = 0; index < SAMPLES_PER_FRAME; index++) {
    const sample = samples[(frame - 1) * SAMPLES_PER_FRAME + index];
    const phase = 2 * Math.PI * frequency * index / SAMPLE_RATE;
    sine += sample * Math.sin(phase);
    cosine += sample * Math.cos(phase);
  }
  return 2 * Math.hypot(sine, cosine) / SAMPLES_PER_FRAME;
}

export async function installPgWavRenderReader(admin, cfg) {
  await admin.query(await readFile(new URL("../../lib/db/postgres/private-wav-upload/render-input.sql", import.meta.url), "utf8"));
  const { rows: [password] } = await admin.query("SELECT quote_literal($1::text) AS literal", [cfg.password]);
  await admin.query("CREATE ROLE local_wav_render_read_login LOGIN NOINHERIT PASSWORD " + password.literal);
  await admin.query("GRANT local_wav_render_read TO local_wav_render_read_login WITH INHERIT FALSE, SET TRUE");
}

async function preparePgWavRender({ origin, owner, admin, a, post, body }, shots) {
  const created = await post(owner, v7(), body);
  assert.equal(created.status, 201);
  const projectId = created.body.id;
  const key = [a.id, projectId];
  const plan = v7();
  await admin.query("INSERT INTO dream.plans(owner_id,project_id,id,version,steps_json,script,status,approved_scene_snapshot_json,approved_at,created_at) VALUES($1,$2,$3,1,'[]','fixture','approved','[]',now(),now())", [...key, plan]);
  await admin.query("UPDATE dream.stage_states SET status='approved',approved_plan_id=$3,approved_at=now(),approved_revision=1 WHERE owner_id=$1 AND project_id=$2 AND stage='produce'", [...key, plan]);
  // Give the second shot the lower ID so physical query order differs from timeline order.
  const sceneIds = shots.map(() => v7()).sort().reverse();
  for (const [position, { image, seconds }] of shots.entries()) {
    const scene = sceneIds[position], version = v7();
    await admin.query("INSERT INTO dream.scenes(owner_id,project_id,id,position,title,description,dialogue_json,character_ids_json,duration_sec) VALUES($1,$2,$3,$4,'verified PNG','','[]','[]',$5)", [...key, scene, position, seconds]);
    await admin.query("INSERT INTO dream.scene_versions(owner_id,id,scene_id,plan_id,version,kind,input_snapshot_json,result_asset_id,status,created_at) VALUES($1,$2,$3,$4,1,'image','{}',$5,'succeeded',now())", [a.id, version, scene, plan, image]);
    await admin.query("UPDATE dream.scenes SET selected_version_id=$1 WHERE id=$2", [version, scene]);
  }

  const api = "/api/projects/" + projectId;
  async function timelineCall(path, input) {
    const response = await fetch(origin + api + "/timeline/" + path, { method: "POST",
      headers: { cookie: owner, "Content-Type": "application/json", "Idempotency-Key": v7() }, body: JSON.stringify(input) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  }
  const initial = await timelineCall("initial", { expectedContentRevision: 1, expectedTimelineId: null });
  async function upload(frequency, duration) {
    const bytes = tone(frequency, duration);
    const response = await fetch(origin + "/api/assets/upload?format=wav&filename=" + frequency + ".wav", {
      method: "POST", headers: { cookie: owner, "Idempotency-Key": v7(), "Content-Type": "audio/wav" }, body: bytes,
    });
    assert.equal(response.status, 201);
    const { id } = await response.json();
    const attached = await fetch(origin + api + "/audio-assets/" + id, { method: "PUT", headers: { cookie: owner } });
    assert.equal(attached.status, 200);
    return { id, bytes };
  }
  const low = await upload(300, 400), high = await upload(600, 600);
  const add = (asset, base) => timelineCall("audio-clips", { assetId: asset.id, expectedContentRevision: base.contentRevision, expectedTimelineId: base.timelineId });
  const first = await add(low, initial), saved = await add(high, first);
  const expected = { projectId, timelineId: saved.timelineId, contentRevision: saved.contentRevision };
  return { key, low, high, first, saved, expected };
}

export async function testPgWavRender(options) {
  const { origin, owner, other, admin, cfg, a, b, image, png, storage } = options;
  const { key, low, high, first, saved, expected } = await preparePgWavRender(options, [{ image, seconds: 2 }]);
  const actor = actorFromVerifiedUserId(a.id);
  const render = consume => useLocalPgWavRenderInput(cfg, actor, expected, consume);
  const unused = () => assert.fail("Rejected input reached the renderer");
  await assert.rejects(useLocalPgWavRenderInput(cfg, actorFromVerifiedUserId(b.id), expected, unused), { code: "PROJECT_MISSING" });
  await assert.rejects(useLocalPgWavRenderInput(cfg, actor, { ...expected, timelineId: first.timelineId }, unused), { code: "STALE_TIMELINE" });
  await admin.query("DELETE FROM dream.project_assets WHERE owner_id=$1 AND project_id=$2 AND asset_id=$3 AND purpose='productionAudio'", [...key, high.id]);
  await assert.rejects(render(unused), { code: "SOURCE_UNAVAILABLE" });
  await admin.query("INSERT INTO dream.project_assets(owner_id,project_id,asset_id,purpose) VALUES($1,$2,$3,'productionAudio')", [...key, high.id]);
  const replaced = Buffer.from(high.bytes);
  replaced[44] ^= 1;
  await admin.query("UPDATE local_wav.files SET content=$2 WHERE asset_id=$1", [high.id, replaced]);
  try { await assert.rejects(render(unused), { code: "SOURCE_UNAVAILABLE" }); }
  finally { await admin.query("UPDATE local_wav.files SET content=$2 WHERE asset_id=$1", [high.id, high.bytes]); }

  let work;
  try {
    await assert.rejects(render(async input => {
      work = input.workRoot;
      await admin.query("UPDATE dream.assets SET archived_at=now() WHERE id=$1", [high.id]);
    }), { code: "SOURCE_UNAVAILABLE" });
    await assert.rejects(access(work), { code: "ENOENT" });
  } finally { await admin.query("UPDATE dream.assets SET archived_at=NULL WHERE id=$1", [high.id]); }

  const evidence = await render(async input => {
    work = input.workRoot;
    assert.equal(input.timelineRevision, saved.timelineRevision);
    assert.deepEqual(input.audio.map(clip => [clip.assetId, clip.startFrame, clip.sourceInFrame, clip.durationFrames]),
      [[low.id, 0, 0, 12], [high.id, 12, 0, 18]]);
    assert.equal(input.outputFrames, 60);
    assert.equal(input.sources[low.id].sha256, digest(low.bytes));
    assert.equal(input.sources[high.id].sha256, digest(high.bytes));
    assert.equal(input.timeline.video[0].assetId, image);
    const { rows: [imageRow] } = await admin.query("SELECT sha256,size_bytes FROM dream.assets WHERE owner_id=$1 AND id=$2", [a.id, image]);
    assert.equal(digest(png), imageRow.sha256);
    assert.equal(png.length, Number(imageRow.size_bytes));
    const frame = join(work, "verified.png"), video = join(work, "video.mp4"), output = join(work, "output.mp4");
    await writeFile(frame, png, { flag: "wx" });
    const ffmpeg = mediaBinary("ffmpeg"), ffprobe = mediaBinary("ffprobe");
    await run(ffmpeg, ["-v", "error", "-loop", "1", "-framerate", "30", "-i", frame, "-frames:v", String(input.outputFrames),
      "-vf", "scale=180:320", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-an", video], { timeout: 20000, windowsHide: true });
    const videoBytes = await readFile(video);
    const mix = await mixAudio({ audio: input.audio, audioJoins: input.audioJoins, outputFrames: input.outputFrames,
      sources: input.sources, workRoot: work, video: { path: video, sha256: digest(videoBytes), sizeBytes: videoBytes.length }, outputPath: output },
    { tools: { ffmpeg, ffprobe } });
    assert.equal(mix.output.audio.codec, "aac");
    assert.equal(mix.mix.samples, 60 * SAMPLES_PER_FRAME);
    const verified = await verifyRender(output, { width: 180, height: 320, fps: 30, frames: 60, audio: "aac" });
    assert.equal(verified.result, "passed", JSON.stringify(verified.items));
    assert.equal(verified.probe.audioStreams, 1);
    const { stdout } = await run(ffmpeg, ["-v", "error", "-i", output, "-map", "0:a:0", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "pipe:1"],
      { timeout: 20000, maxBuffer: 512000, encoding: "buffer", windowsHide: true });
    const samples = Array.from({ length: stdout.length / 4 }, (_, index) => stdout.readFloatLE(index * 4));
    const inBand = (f, hz) => amplitude(samples, f, hz) > 0.05;
    for (const f of [2, 6, 11]) assert.ok(inBand(f, 300) && !inBand(f, 600), "first WAV");
    for (const f of [14, 20, 29]) assert.ok(inBand(f, 600) && !inBand(f, 300), "second WAV");
    for (const f of [32, 45, 59]) assert.ok(!inBand(f, 300) && !inBand(f, 600), "after audio");
    const highFrames = Array.from({ length: 60 }, (_, index) => index + 1).filter(f => inBand(f, 600));
    assert.ok(Math.abs(highFrames[0] - 13) <= 1);
    assert.ok(Math.abs(highFrames.at(-1) - 30) <= 1);
    return { timelineSha256: input.timelineSha256, outputSha256: mix.output.sha256,
      audioSha256: [digest(low.bytes), digest(high.bytes)], highFrames: [highFrames[0], highFrames.at(-1)],
      decodedSamples: samples.length, sources: [300, 600], tracks: verified.probe.audioStreams };
  });
  await assert.rejects(access(work), { code: "ENOENT" });
  console.log("PG_WAV_MP4 " + JSON.stringify(evidence));
  const { testRenderExecution } = await import("./private-render-execution-http.mjs");
  await testRenderExecution({ origin, owner, other, admin, storage, expected, assetId: low.id });
  await testTwoSceneWavRender(options, testRenderExecution);
}


async function testTwoSceneWavRender(options, testRenderExecution) {
  const { origin, owner, other, admin, storage } = options;
  async function uploadPng(color, width, height) {
    const bytes = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
    const response = await fetch(origin + "/api/assets/upload?filename=" + color + ".png", {
      method: "POST", headers: { cookie: owner, "Content-Type": "image/png", "Idempotency-Key": v7() }, body: bytes,
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    return body.id;
  }
  const red = await uploadPng("red", 48, 64), blue = await uploadPng("blue", 64, 48);
  const { expected, low } = await preparePgWavRender(options, [{ image: red, seconds: 1 }, { image: blue, seconds: 2 }]);
  const inspectDownload = async mp4 => {
    const root = await mkdtemp(join(tmpdir(), "dream-two-shot-mp4-"));
    try {
      const path = join(root, "download.mp4");
      await writeFile(path, mp4, { flag: "wx" });
      const verified = await verifyRender(path, { width: 1080, height: 1920, fps: 30, frames: 90, audio: "aac" });
      assert.equal(verified.result, "passed", JSON.stringify(verified.items));
      const ffmpeg = mediaBinary("ffmpeg");
      const { stdout: rgb } = await run(ffmpeg, ["-v", "error", "-i", path, "-an", "-vf",
        "select=eq(n\\,29)+eq(n\\,30)+eq(n\\,89),crop=16:16,scale=1:1", "-fps_mode", "passthrough",
        "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { timeout: 20000, encoding: "buffer", windowsHide: true });
      assert.equal(rgb.length, 9);
      const pixels = [0, 3, 6].map(offset => Array.from(rgb.subarray(offset, offset + 3)));
      assert.ok(pixels[0][0] > 220 && pixels[0][2] < 30, JSON.stringify(pixels));
      for (const pixel of pixels.slice(1)) assert.ok(pixel[2] > 220 && pixel[0] < 30, JSON.stringify(pixels));
      const { stdout: pcm } = await run(ffmpeg, ["-v", "error", "-i", path, "-map", "0:a:0", "-ac", "1",
        "-ar", String(SAMPLE_RATE), "-f", "f32le", "pipe:1"],
        { timeout: 20000, maxBuffer: 800000, encoding: "buffer", windowsHide: true });
      const samples = Array.from({ length: pcm.length / 4 }, (_, index) => pcm.readFloatLE(index * 4));
      assert.equal(samples.length, 90 * SAMPLES_PER_FRAME);
      assert.ok(amplitude(samples, 6, 300) > 0.05 && amplitude(samples, 20, 600) > 0.05);
      assert.ok(amplitude(samples, 45, 300) < 0.001 && amplitude(samples, 45, 600) < 0.001);
      return { cutFrames: [29, 30, 89], pixels, samples: samples.length };
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 3 }); }
  };
  await testRenderExecution({ origin, owner, other, admin, storage, expected, assetId: low.id, frames: 90,
    secondImage: blue, inspectDownload });
}
