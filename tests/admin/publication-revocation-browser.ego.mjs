/* global taskSpace, document, window */
import assert from "node:assert/strict";
import { log } from "node:console";
import { once } from "node:events";
import { createServer } from "node:http";
import { basename } from "node:path";
import { env } from "node:process";
import { fileURLToPath, URL } from "node:url";
import { build } from "esbuild";

// Run from ego-browser nodejs, then finish the printed task space in a separate call.
const { outputFiles } = await build({
  stdin: {
    contents: `import { createRoot } from 'react-dom/client';
      import { PublicationQueue } from './components/admin/publication-queue';
      import { buildAction } from './components/admin/publication-model';
      import { createMemoryPublicationProvider } from './components/admin/publication-provider';
      import './app/globals.css';
      const owner = '00000000-0000-4000-8000-000000000289';
      const { provider } = createMemoryPublicationProvider({ actor: owner, publishers: [owner], seeds:
        ['with-preparation', 'public-only'].map(slug => ({ owner, slug, title: slug, kind: 'image', rights: 'confirmed', source: { revision: 1, finished: true } })) });
      const item = async slug => (await provider.list()).items.find(row => row.slug === slug);
      async function setup() {
        for (const slug of ['with-preparation', 'public-only']) {
          for (const command of ['prepare', 'complete']) await provider.apply(buildAction(await item(slug), command, crypto.randomUUID(), true));
        }
        await provider.apply(buildAction(await item('with-preparation'), 'prepare', crypto.randomUUID(), true));
        const requests = [];
        window.publicationReview = { requests, list: provider.list };
        const apply = async action => {
          requests.push(action);
          const accepted = await provider.apply(action);
          if (requests.length === 1) return { status: 'unavailable' }; // The first committed response is lost.
          return accepted;
        };
        createRoot(document.getElementById('root')).render(<PublicationQueue source="synthetic" initial={await provider.list()} load={provider.list} apply={apply}/>);
      }
      void setup();`,
    loader: "tsx", resolveDir: fileURLToPath(new URL("../..", import.meta.url)),
  },
  bundle: true, platform: "browser", jsx: "automatic", write: false, outfile: "publication-check.js",
  define: { "process.env.NODE_ENV": '"production"' },
});
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const asset = outputFiles.find(file => `/${basename(file.path)}` === path);
  if (asset) {
    res.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/css");
    return res.end(asset.contents);
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html><html lang="ko"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/publication-check.css">
    <main class="content" id="root"></main><script src="/publication-check.js"></script>`);
});

const task = await taskSpace(Number(env.PUBLICATION_REVIEW_SPACE) || "publication revocation keyboard proof");
log({ taskSpaceId: task.spaceId });
const page = task.page("p1");
const activeText = () => page.evaluate(() => document.activeElement.textContent.trim());
const press = key => page.keyboard.press(key);
const control = label => `loc=role:button[name='${label}']`;
const waitForNotice = (text) => page.waitForFunction(phrase => [...document.querySelectorAll('[role="status"]')]
  .some(element => element.textContent.includes(phrase)), text);
const focusInView = () => page.evaluate(() => {
  const node = document.activeElement;
  const box = node.getBoundingClientRect();
  return { element: node.tagName, top: Math.round(box.top), bottom: Math.round(box.bottom), viewport: window.innerHeight };
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    await page.goto(origin);
    await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await page.waitForSelector(control("게시 준비 취소…"));
    const results = [];
    for (const [name, label, generation, keep, impact] of [
      ["with-preparation", "게시 준비 취소", "3", "1", "게시 중인 1번 세대는 계속 공개돼요."],
      ["public-only", "공개 철회", "1", null, "공개 목록과 해당 세대의 표지 주소에서 내려가요."],
    ]) {
      const trigger = `button[id$="-${name}-trigger"]`;
      const requestCount = await page.evaluate(() => window.publicationReview.requests.length);
      await page.focus(trigger);
      await press("Enter");
      const confirmation = await page.evaluate(() => {
        const h = document.activeElement;
        return { heading: h.textContent.trim(), description: document.getElementById(h.getAttribute("aria-describedby"))?.textContent };
      });
      assert.equal(confirmation.heading, `${name} · ${label} 확인`);
      assert.equal(confirmation.description, `${keep ? "준비 세대" : "게시 중 세대"} ${generation}. ${impact}`);
      await press("Tab");
      assert.equal(await activeText(), "돌아가기");
      await press("Escape");
      assert.equal(await activeText(), `${label}…`);
      await press("Enter");
      await press("Tab");
      await press("Enter");
      assert.equal(await activeText(), `${label}…`);
      assert.equal(await page.evaluate(() => window.publicationReview.requests.length), requestCount);

      await press("Enter");
      await press("Tab");
      await press("Tab");
      assert.equal(await activeText(), `세대 ${generation} ${label} 확정`);
      await press("Enter");
      if (keep) {
        await waitForNotice("같은 요청으로 다시 시도할 수 있어요.");
        assert.match(await activeText(), /게시 준비 취소 요청을 처리하지 못했어요/);
        await press("Tab");
        assert.equal(await activeText(), "같은 게시 준비 취소 요청 다시 시도");
        await press("Enter");
      }
      await waitForNotice(keep ? "계속 공개돼요." : "해당 세대의 표지 주소에서 내려갔어요.");
      assert.match(await activeText(), new RegExp(`^${name}`));
      const position = await focusInView();
      assert.equal(position.element, "H3");
      assert.ok(position.top >= 0 && position.bottom <= position.viewport);
      const observed = await page.evaluate(async ({ slug, from }) => ({
        row: (await window.publicationReview.list()).items.find(item => item.slug === slug),
        requests: window.publicationReview.requests.slice(from), width: window.innerWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }), { slug: name, from: requestCount });
      assert.equal(observed.width, width);
      assert.equal(observed.overflow, 0);
      assert.equal(observed.row.pendingGeneration, null);
      assert.equal(observed.row.activeGeneration, keep);
      assert.equal(observed.requests.length, keep ? 2 : 1);
      assert.deepEqual(observed.requests[0], { requestId: observed.requests[0].requestId, command: "revoke", slug: name,
        expectedVersion: keep ? "3" : "2", generation, rightsConfirmed: false });
      if (keep) assert.deepEqual(observed.requests[1], observed.requests[0]);
      results.push({ label, generation, remainingPublic: keep, requests: observed.requests.length, focus: position });
    }
    log({ width, results });
  }
  log(await page.snapshot());
} finally { server.closeAllConnections(); server.close(); }
