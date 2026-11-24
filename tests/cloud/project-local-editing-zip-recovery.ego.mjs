/* global taskSpace, document, window */
import assert from "node:assert/strict";
import { log } from "node:console";
import { once } from "node:events";
import { createServer } from "node:http";
import { basename } from "node:path";
import { env } from "node:process";
import { fileURLToPath, URL } from "node:url";
import { build } from "esbuild";

// Run with ego-browser nodejs, importing this file. Finish the printed task space separately.
const { outputFiles } = await build({
  stdin: {
    contents: `import { createRoot } from 'react-dom/client';
      import { ProjectLocalEditingZip } from './components/cloud/project-local-editing-zip';
      createRoot(document.getElementById('root')).render(<ProjectLocalEditingZip projectId={location.pathname.slice(1)} />);`,
    loader: "tsx",
    resolveDir: fileURLToPath(new URL("../..", import.meta.url)),
  },
  bundle: true, platform: "browser", jsx: "automatic", write: false, outfile: "zip-test.js",
  define: { "process.env": '{"NODE_ENV":"production"}', "process.env.NODE_ENV": '"production"' },
});

const sessions = new Map();
const json = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};
const row = (project, revision) => ({
  id: `zip-r${revision}`, contentRevision: revision, timelineId: `timeline-${revision}`, status: "succeeded",
  sha256: null, sizeBytes: 1024, downloadHref: `/api/projects/${project}/exports/r${revision}`,
});
const server = createServer(async (request, response) => {
  const asset = outputFiles.find(file => `/${basename(file.path)}` === request.url);
  if (asset) {
    response.setHeader("Content-Type", asset.path.endsWith(".js") ? "text/javascript" : "text/css");
    return response.end(asset.contents);
  }
  if (["/download", "/create", "/unapproved"].includes(request.url)) {
    sessions.set(request.url.slice(1), { reads: 0, requests: [], release: null });
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.end(`<!doctype html><html lang="ko"><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/zip-test.css">
      <div id="root"></div><script src="/zip-test.js"></script>`);
  }
  const match = /^\/api\/projects\/(download|create|unapproved)\/exports(?:\/(r7))?$/.exec(request.url);
  if (!match) return json(response, 404, {});
  const [, project, zip] = match;
  const session = sessions.get(project);
  if (zip || request.method === "POST") {
    session.requests.push([request.method, 409]);
    return json(response, 409, { code: "CURRENT_TIMELINE_CONFLICT" });
  }
  session.reads++;
  if (session.reads === 2) {
    session.requests.push(["GET", 503]);
    return json(response, 503, { code: "EXPORT_READ_UNAVAILABLE" });
  }
  const revision = session.reads === 1 ? 7 : 8;
  session.requests.push(["GET", 200]);
  if (revision === 8) await new Promise(resolve => { session.release = resolve; });
  json(response, 200, { result: {
    contentRevision: revision, timelineId: `timeline-${revision}`, canCreate: project !== "unapproved",
    rows: project === "download" ? [row(project, 7), ...(revision === 8 ? [row(project, 8)] : [])] : [],
  } });
});

const task = await taskSpace(Number(env.DREAM_ZIP_EGO_SPACE) || "재편집 ZIP 충돌 후 키보드 복구 시험");
log({ taskSpaceId: task.spaceId });
const page = task.page("p1");
const readScreen = () => page.evaluate(() => ({
  text: document.querySelector("section").innerText,
  focus: document.activeElement?.textContent,
  buttons: [...document.querySelectorAll("section button")].map(button => [button.textContent, button.disabled]),
  viewport: window.innerWidth,
}));
const revisionShown = revision => page.waitForFunction(value =>
  document.querySelector("section")?.innerText.includes(`현재 버전 · 내용 리비전 ${value}`), revision);
const reload = "상태 다시 불러오기";
const create = "이 버전으로 ZIP 만들기";

server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const [mode, action] of [["download", "현재 버전 ZIP 받기"], ["create", create]]) {
    await page.goto(`${origin}/${mode}`);
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 850, deviceScaleFactor: 1, mobile: true });
    await revisionShown(7);
    await page.focus(`loc=role:button[name='${action}']`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.matches('p[role="alert"]'));

    const stale = await readScreen();
    assert.equal(stale.viewport, 390);
    assert.match(stale.focus, /타임라인이 바뀌었어요.*최신 상태를 불러오지 못했어요/);
    assert.match(stale.text, /마지막 확인 버전 · 내용 리비전 7/);
    assert.deepEqual(stale.buttons, [[reload, false]]);

    await page.keyboard.press("Tab");
    assert.equal((await readScreen()).focus, reload);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    assert.deepEqual((await readScreen()).buttons, [[reload, true]]);
    const session = sessions.get(mode);
    assert.deepEqual(session.requests, [["GET", 200], [mode === "download" ? "GET" : "POST", 409], ["GET", 503], ["GET", 200]]);
    session.release();

    await revisionShown(8);
    await page.waitForFunction(() => document.activeElement?.matches('p[role="status"]'));
    const fresh = await readScreen();
    assert.match(fresh.focus, /최신 상태를 다시 불러왔어요/);
    assert.deepEqual(fresh.buttons, [[action, false], [reload, false]]);
    if (mode === "download") {
      assert.match(fresh.text, /내용 r8/);
      assert.match(fresh.text, /내용 r7[^\n]+이전 버전이라 받을 수 없어요/);
    }
    log({ mode, requests: session.requests, recovery: fresh.focus });
  }

  await page.goto(`${origin}/unapproved`);
  await revisionShown(7);
  const unapproved = await readScreen();
  assert.match(unapproved.text, /검수로 이동/);
  assert.deepEqual(unapproved.buttons, [[create, true], [reload, false]]);
  log(await page.snapshot());
} finally {
  server.closeAllConnections();
  server.close();
}
