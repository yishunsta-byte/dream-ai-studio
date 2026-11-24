/* global AbortSignal, Buffer, URL, console, fetch, process */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { v7 } from "uuid";
import { mediaBinary } from "../../lib/media/tools.ts";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("../../", import.meta.url));
const listen = server => new Promise((done, reject) => server.once("error", reject).listen(0, "127.0.0.1", done));
const close = server => new Promise(done => { server.closeAllConnections(); server.close(done); });

async function withNext(app, env, verify) {
  const probe = createServer();
  await listen(probe);
  const port = probe.address().port;
  await close(probe);
  const child = spawn(process.execPath, ["start.cjs"], { cwd: app, windowsHide: true,
    env: { ...env, PORT: String(port) }, stdio: ["ignore","pipe","pipe"] });
  const exited = new Promise((done, reject) => { child.once("close", done); child.once("error", reject); });
  let log = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { log = (log + chunk).slice(-10000); });
  try {
    for (let i = 0; !log.includes("T371 READY"); i++) {
      assert.ok(i < 400 && child.exitCode === null, "Next startup failed");
      await delay(100);
    }
    await verify(async (cookie, key, body) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/projects`, { method: "POST", redirect: "manual",
        headers: { "content-type": "application/json", ...(cookie && { cookie }), ...(key && { "idempotency-key": key }) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
      return { status: response.status, body: await response.json() };
    }, "http://127.0.0.1:" + port);
  } finally { child.kill(); await exited; }
}

export async function verifyProjectHttp({ cfg, png, fixture, storage, worker, a, b, asset, inputs, admin, revoke, upload, totals }) {
  const users = new Map();
  function session(id) {
    const user = { id, email: "owner@example.invalid", role: "authenticated", aud: "authenticated" };
    const exp = Math.floor(Date.now()/1000) + 3600;
    const token = "header." + Buffer.from(JSON.stringify({ sub: id, exp })).toString("base64url") + "." + randomBytes(16).toString("hex");
    users.set("Bearer " + token, user);
    const data = { access_token: token, refresh_token: "local-refresh", token_type: "bearer", expires_at: exp, user };
    return "sb-127-auth-token=base64-" + Buffer.from(JSON.stringify(data)).toString("base64url");
  }
  const auth = createServer((request, response) => {
    const user = users.get(request.headers.authorization);
    response.writeHead(request.url === "/auth/v1/user" && user ? 200 : 401, { "content-type": "application/json" });
    response.end(JSON.stringify(user ?? { message: "unauthorized" }));
  });
  const parent = await realpath(join(repo, ".."));
  const root = await mkdtemp(join(parent, "dream-t371-"));
  const app = join(root, "app"), modules = join(app, "node_modules");
  let linked = false;
  try {
    await listen(auth);
    await mkdir(app);
    const archive = join(root, "source.tar");
    await exec("git", ["archive","--format=tar","-o",archive,"HEAD"], { cwd: repo });
    await exec("tar", ["-xf",archive,"-C",app]);
    for (const path of ["app/api/projects/route.ts","lib/cloud/local-project-create.ts",
      "app/api/assets/upload/route.ts","lib/cloud/local-private-image-upload.ts","lib/services/postgres/private-image-upload.ts",
      "app/api/assets/[id]/route.ts","lib/cloud/local-private-wav.ts","lib/cloud/read-bounded-upload.ts","lib/services/postgres/pcm-wav.ts",
      "app/api/projects/[id]/brief/route.ts","components/cloud/project-brief.tsx",
      "app/api/projects/[id]/plan/route.ts","components/cloud/project-plan-draft.tsx","lib/domain/planning-draft.ts",
      "app/(cloud)/cloud/projects/[id]/page.tsx","app/(cloud)/cloud/projects/[id]/plan/page.tsx",
      "app/(cloud)/cloud/projects/[id]/produce/page.tsx","app/api/projects/[id]/production/route.ts",
      "components/cloud/project-production-scenes.tsx","lib/cloud/local-project-production.ts",
      "components/cloud/project-png-attachment.tsx",
      "app/api/projects/[id]/timeline/subtitles/download/route.ts",
      "app/api/projects/[id]/timeline/subtitles/route.ts","lib/cloud/local-subtitle-edits.ts","lib/cloud/local-timeline-scenes.ts",
      "lib/edit/timeline.ts","lib/db/timeline-data.ts","lib/cloud/local-timeline-audio.ts","app/api/projects/[id]/timeline/audio-clips/route.ts","app/api/projects/[id]/timeline/initial/route.ts",
      "lib/cloud/local-render-request.ts","app/api/projects/[id]/renders/route.ts",
      "lib/cloud/local-render-execute.ts","lib/render/local-pg-still-render.ts","app/api/projects/[id]/renders/[jobId]/execute/route.ts",
      "app/api/projects/[id]/review/route.ts","lib/cloud/local-project-review.ts","lib/domain/review.ts","lib/services/review.ts",
      "lib/cloud/local-wav-access.ts","lib/cloud/local-project-audio.ts","app/api/projects/[id]/audio-assets/route.ts",
      "app/api/projects/[id]/audio-assets/[assetId]/route.ts"]) {
      await mkdir(dirname(join(app,path)),{recursive:true});
      await copyFile(join(repo,path),join(app,path));
    }
    await symlink(join(repo,"node_modules"), modules, process.platform === "win32" ? "junction" : "dir");
    linked = true;
    await writeFile(join(app,"start.cjs"), `
      const port=Number(process.env.PORT);
      const app=require("next")({dev:true,webpack:true,hostname:"127.0.0.1",port});
      app.prepare().then(()=>require("node:http").createServer(app.getRequestHandler()).listen(port,"127.0.0.1",()=>console.log("T371 READY")));
    `);
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      /^(path|systemroot|windir|temp|tmp|pathext|comspec|systemdrive)$/i.test(name))),
      NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", DREAM_AUTH_MODE: "supabase",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:" + auth.address().port, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_local_synthetic",
      DREAM_ALLOWED_EMAILS: "owner@example.invalid", DREAM_PROJECT_READ_BACKEND: "postgres",
      FFMPEG_PATH: mediaBinary("ffmpeg"), FFPROBE_PATH: mediaBinary("ffprobe") };
    const owner = session(a.id), other = session(b.id);
    const body = { menuId: "shopping-shorts", inputs: inputs(asset) };
    const key = v7();
    const sqliteEnv = { ...env };
    delete sqliteEnv.DREAM_PROJECT_READ_BACKEND;
    await exec(process.execPath, ["--conditions=react-server","--import","tsx","scripts/db.ts","migrate"], { cwd: app, env: sqliteEnv });
    await withNext(app, sqliteEnv, async (post, origin) => {
      const upload = await fetch(origin + "/api/assets/upload?filename=product.png&rightsNote=owned", {
        method: "POST", headers: { cookie: owner, "content-type": "image/png" }, body: png,
      });
      assert.equal(upload.status, 201);
      const image = await upload.json();
      const result = await post(owner, null, { ...body, inputs: inputs(image.id) });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      assert.ok(result.body.id);
      const disabled=await fetch(origin+"/api/projects/"+result.body.id+"/audio-assets",{headers:{cookie:owner}});
      assert.equal(disabled.status,503);
    });
    await withNext(app, env, async post => {
      const result = await post(owner, null, body);
      assert.equal(result.status, 503);
      assert.equal(result.body.code, "LEGACY_DATA_UNAVAILABLE");
    });
    const { enableOwnedReadTls, verifyReopen } = await import("./private-project-reopen-http.mjs");
    const readEnv = await enableOwnedReadTls(admin,cfg,root);
    await withNext(app, { ...env,...readEnv, DREAM_PROJECT_CREATE_BACKEND: "owned-pg17", DREAM_OWNED_CREATE_PG_PORT: String(cfg.port),
      DREAM_OWNED_CREATE_PG_PASSWORD: cfg.password, DREAM_OWNED_CREATE_REGISTRAR: worker.id, DREAM_OWNED_CREATE_STORAGE_ORIGIN: storage.origin,
      DREAM_PRIVATE_UPLOAD_BACKEND: "owned-pg17", DREAM_OWNED_UPLOAD_ORIGIN: "http://127.0.0.1:" + fixture.server.address().port }, async (post, origin) => {
      const { verifyUpload } = await import("./private-png-upload-http.mjs");
      const { ownerImage: image, otherImage } = await verifyUpload({ origin, owner, other, png, fixture, admin, a });
      body.inputs = inputs(image);
      const { verifyOwnedWav } = await import('./private-wav-http.mjs');
      await verifyOwnedWav({origin,owner,other,admin,post,inputs});
      const before = await totals(admin);
      assert.equal((await post(null, key, body)).status, 401);
      const missing = await post(owner, null, body);
      assert.equal(missing.status, 400, JSON.stringify(missing));
      assert.equal((await post(other, key, { ...body, ownerId: a.id })).status, 400);
      assert.equal((await post(other, key, body)).status, 400);
      const first = await post(owner, key, body);
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.match(first.body.id, /^[a-f0-9-]{36}$/);
      assert.deepEqual(await post(owner, key, body), first);
      assert.equal((await post(owner, key, { ...body, inputs: inputs(image,"Changed") })).status, 409);
      const stale = await upload(a);
      await revoke(admin, a.id, stale);
      assert.equal((await post(owner, v7(), { ...body, inputs: inputs(stale) })).status, 400);
      assert.deepEqual(await totals(admin), { projects: before.projects+1, stages: before.stages+7, links: before.links+1,
        audit: before.audit+1, requests: before.requests+1 });
      assert.deepEqual(storage.state.events, ["bucket","object"]);
      const { testProjectAudio } = await import("./private-project-audio-http.mjs");
      await testProjectAudio({origin,owner,other,admin,cfg,a,b,project:first.body.id,png:image,post,key,body});
      const { testTimelineSave }=await import("./private-timeline-audio-http.mjs");
      await testTimelineSave({origin,owner,other,admin,project:first.body.id,actor:a.id,png:image});
      const { testProjectReview } = await import("./private-project-review-http.mjs");
      await testProjectReview({ origin, owner, other, admin, project: first.body.id });
      const { testProjectSubtitles } = await import("./private-subtitle-timeline-http.mjs");
      await testProjectSubtitles({ origin, owner, other, admin, project: first.body.id });
      const { testInitialTimeline }=await import("./private-initial-timeline-http.mjs");
      const initialProject=await post(owner,v7(),body);
      assert.equal(initialProject.status,201);
      await testInitialTimeline({origin,owner,other,admin,actor:a.id,project:initialProject.body.id,png:image});
      const { testRenderRequest } = await import("./private-render-request-http.mjs");
      await testRenderRequest({ origin, owner, other, admin, project: initialProject.body.id, actor: a.id });
      if (process.env.T371_VERIFY_RENDER_AUDIO === "1") {
        const { testPgWavRender } = await import("./private-wav-render-output.mjs");
        await testPgWavRender({ origin, owner, other, admin, cfg, a, b, post, body, image, png, storage });
      }
      await verifyReopen({origin,post,owner:other,unrelated:session(worker.id),asset:otherImage,inputs,admin,firstOwner:owner});
      const { verifyBrief } = await import("./local-project-brief-http.mjs");
      await verifyBrief({admin,origin,owner,other,post,body,actor:a.id,asset:image});
      storage.state.events.length = 0;
    });
    console.log("T371 actual Next POST, authenticated ownership, revoke, replay, conflict and default legacy gate passed");
  } finally {
    await close(auth);
    if (linked) await unlink(modules);
    const owned = await realpath(root);
    assert.equal(dirname(owned), parent);
    assert.ok(basename(owned).startsWith("dream-t371-"));
    await rm(owned,{ recursive:true, force:true, maxRetries:4 });
  }
}
