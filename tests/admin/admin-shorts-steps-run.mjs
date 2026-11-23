/* global URL, process, console */
// P1-08-SHORTS-STEPS 브라우저 대역 실행기: tests/admin/admin-shorts-steps-fixture.tsx를 esbuild로 묶어 127.0.0.1에 띄운다.
// 실행: node tests/admin/admin-shorts-steps-run.mjs (포트는 DREAM_SHORTS_STEPS_FIXTURE_PORT, 없으면 빈 포트). 출력 'SHORTS-STEPS-READY <주소>'.
import { build } from "esbuild";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const port = Number(process.env.DREAM_SHORTS_STEPS_FIXTURE_PORT ?? 0);
const plugins = [{ name: "fixture-server-boundaries", setup(builder) {
  builder.onResolve({ filter: /^(next\/link|server-only)$/ }, args => ({ path: args.path, namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: repo, contents: args.path === "next/link"
    ? "import { createElement } from 'react'; export default function Link({ href, prefetch, ...rest }) { void prefetch; return createElement('a', { href, ...rest }); }"
    : "export {};" }));
} }];
const bundle = await build({ absWorkingDir: repo, entryPoints: ["tests/admin/admin-shorts-steps-fixture.tsx"], bundle: true, jsx: "automatic", write: false,
  outdir: "fixture-out", define: { "process.env.NODE_ENV": '"production"' }, plugins });
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (path === "/" || path === "/admin/shorts-analysis") return response.writeHead(200, { "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' blob: data: https://i.ytimg.com; style-src 'self' 'unsafe-inline'; script-src 'self'" }).end(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>쇼츠 단계 대역 검수</title>' +
    '<link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  // 공통 세션 경계가 로그인 만료 때 보내는 곳(대역): 돌아올 주소만 보인다.
  if (path === "/login") return response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><title>로그인 대역</title><body><h1>로그인 대역</h1><p id="next"></p>' +
    '<script>document.getElementById("next").textContent=new URLSearchParams(location.search).get("next")</script></body></html>');
  if (path === "/fixture.js") return response.writeHead(200, { "content-type": "application/javascript" }).end(js);
  if (path === "/fixture.css") return response.writeHead(200, { "content-type": "text/css" }).end(css);
  response.writeHead(404).end();
});
server.listen(port, "127.0.0.1", () => console.log("SHORTS-STEPS-READY http://127.0.0.1:" + server.address().port));
