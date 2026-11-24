/* global Buffer, URL, console, process, setTimeout, clearTimeout */
// 보호 목록 화면 늦은 성공 응답 시험 서버(루프백, 서버 DB·자료 없음). 화면 묶음만 내보내고 ego 보고(/__fixture/done)를 받으면 판정·종료한다.
// 실행: node tests/reference-analysis/protected-materials-late-transport-run.mjs → "LATE-TRANSPORT-READY <주소>" →
//   ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "<주소>"; await import("file:///…/tests/reference-analysis/protected-materials-late-transport.ego.mjs")'
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("./protected-materials-late-transport-browser.tsx", import.meta.url))],
  bundle: true, platform: "browser", jsx: "automatic", write: false, outfile: "fixture.js",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "plain-link", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "plain-link", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: process.cwd(),
      contents: "import { createElement } from 'react'; export default function Link({ href, ...rest }) { return createElement('a', { href, ...rest }); }" }));
  } }],
});
const js = outputFiles.find(({ path }) => path.endsWith(".js"))?.text;
const css = outputFiles.find(({ path }) => path.endsWith(".css"))?.text;
if (!js || !css) throw new Error("Missing browser fixture bundle");

let finish;
const done = new Promise((resolve) => { finish = resolve; });
const server = createServer((request, response) => {
  const path = (request.url ?? "/").split("?")[0];
  if (request.method === "GET" && path === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(
      "<!doctype html><html lang=\"ko\" style=\"--font-pretendard:system-ui\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>늦은 목록 응답 시험</title><link rel=\"stylesheet\" href=\"/fixture.css\"><main id=\"main-content\" class=\"content\"><h1 tabindex=\"-1\">콘텐츠 분석</h1><div id=\"root\"></div></main><script src=\"/fixture.js\" defer></script>");
  } else if (request.method === "GET" && path === "/fixture.js") {
    response.writeHead(200, { "content-type": "application/javascript" }).end(js);
  } else if (request.method === "GET" && path === "/fixture.css") {
    response.writeHead(200, { "content-type": "text/css" }).end(css);
  } else if (request.method === "POST" && path === "/__fixture/done") {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => { response.writeHead(200).end("ok"); finish(JSON.parse(Buffer.concat(chunks).toString() || "null")); });
  } else response.writeHead(404).end();
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
console.log(`LATE-TRANSPORT-READY http://127.0.0.1:${server.address().port}`);
let timer;
try {
  const report = await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Browser step timeout")), 600_000); })])
    .finally(() => clearTimeout(timer));
  console.log("LATE-TRANSPORT-REPORT " + JSON.stringify(report));
  if (report?.verdict !== "pass") { console.error("Browser round failed: " + JSON.stringify(report?.failures)); process.exitCode = 1; }
  else console.log("Protected materials late transport: stale successes after abort never shown, current list only, normal path intact");
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
