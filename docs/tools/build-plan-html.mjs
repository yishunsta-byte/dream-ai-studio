// PLAN.md + spec/menus.json → docs/plan.html (보기용). 사용: node docs/tools/build-plan-html.mjs
// PLAN.md를 고칠 때마다 다시 실행한다. HTML을 직접 고치지 않는다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const docs = join(dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(join(docs, 'PLAN.md'), 'utf8');
const menus = JSON.parse(readFileSync(join(docs, 'spec', 'menus.json'), 'utf8'));
const version = (md.match(/\(v([\d.]+)\)/) || [])[1] || '';
const safe = (s) => JSON.stringify(s).replace(/</g, '\\u003c');

const html = `<title>Dream AI Studio 개발 기준</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: 넓은 화면은 왼쪽 고정 목차 + 본문(최대 880px), 좁은 화면은 위쪽 접는 목차 */
:root{
  --bg:#FAF8F3; --surface:#FFFFFF; --sunk:#F1EEE6; --line:#E2DDD1;
  --ink:#1B2836; --muted:#5B6878; --navy:#243B53; --mint:#0E9F94; --mint-soft:#DDF2EF;
  --p1:#0E9F94; --p2:#2F7FC1; --p4:#C27A1A; --p5:#C2456B; --p6:#4E7A3A; --p8:#8A5A44;
  --f-body:"IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;
  --f-mono:"IBM Plex Mono",ui-monospace,Consolas,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#121A23; --surface:#18222D; --sunk:#1E2A36; --line:#2C3A48;
  --ink:#E7ECF1; --muted:#9AA8B6; --navy:#A9C1DA; --mint:#3CC4B7; --mint-soft:#163A39;
  --p1:#3CC4B7; --p2:#6AAEE6; --p4:#E2A14A; --p5:#E57A9B; --p6:#8DBE6E; --p8:#C99A84; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#121A23; --surface:#18222D; --sunk:#1E2A36; --line:#2C3A48;
  --ink:#E7ECF1; --muted:#9AA8B6; --navy:#A9C1DA; --mint:#3CC4B7; --mint-soft:#163A39;
  --p1:#3CC4B7; --p2:#6AAEE6; --p4:#E2A14A; --p5:#E57A9B; --p6:#8DBE6E; --p8:#C99A84; color-scheme:dark}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:16px}
body{background:var(--bg);color:var(--ink);font-family:var(--f-body);font-size:15px;line-height:1.7;-webkit-font-smoothing:antialiased}
.shell{max-width:1240px;margin:0 auto;display:grid;grid-template-columns:240px minmax(0,1fr);gap:40px;
  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:32px 64px}
nav.toc{position:sticky;top:calc(16px + env(safe-area-inset-top,0px));align-self:start;max-height:calc(100vh - 32px);overflow:auto;font-size:13px}
nav.toc .ttl{font-weight:700;color:var(--navy);margin-bottom:8px;font-size:14px}
nav.toc ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px}
nav.toc a{display:block;padding:4px 8px;border-radius:6px;color:var(--muted);text-decoration:none}
nav.toc a:hover,nav.toc a:focus-visible{background:var(--sunk);color:var(--ink);outline:none}
nav.toc a.on{background:var(--mint-soft);color:var(--ink);font-weight:600}
details.toc-m{display:none}
main{min-width:0;max-width:880px}
.doc h1{font-size:clamp(24px,3.6vw,32px);color:var(--navy);line-height:1.3;margin:0 0 16px;text-wrap:balance}
.doc h2{font-size:21px;color:var(--navy);margin:44px 0 12px;padding-top:20px;border-top:1px solid var(--line);text-wrap:balance}
.doc h3{font-size:16.5px;color:var(--navy);margin:28px 0 8px}
.doc p,.doc ul,.doc ol{margin:0 0 12px}
.doc ul,.doc ol{padding-left:20px}
.doc li+li{margin-top:3px}
.doc a{color:var(--mint)}
.doc strong{color:var(--ink);font-weight:700}
.doc code{font-family:var(--f-mono);font-size:.86em;background:var(--sunk);padding:1px 5px;border-radius:4px}
.doc pre{background:var(--sunk);border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow-x:auto;margin:0 0 16px;line-height:1.5}
.doc pre code{background:none;padding:0;font-size:12.5px}
.doc blockquote{margin:0 0 16px;padding:8px 14px;border-left:3px solid var(--mint);background:var(--surface);color:var(--muted);border-radius:0 8px 8px 0}
.doc blockquote p{margin:0}
.tbl{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--surface);margin:0 0 16px}
.doc table{border-collapse:collapse;width:100%;font-size:13.5px}
.doc th,.doc td{text-align:left;vertical-align:top;padding:9px 12px;border-bottom:1px solid var(--line)}
.doc th{background:var(--sunk);color:var(--navy);font-weight:600;font-size:12.5px;white-space:nowrap}
.doc tr:last-child td{border-bottom:none}
.doc td:first-child{font-weight:500}
.ph{display:inline-block;font-family:var(--f-mono);font-size:11.5px;font-weight:500;padding:1px 7px;border-radius:999px;color:var(--surface);background:var(--muted)}
.ph.P1{background:var(--p1)}.ph.P2{background:var(--p2)}.ph.P4{background:var(--p4)}.ph.P5{background:var(--p5)}.ph.P6{background:var(--p6)}.ph.P8{background:var(--p8)}
.av{font-size:11.5px;font-weight:600;padding:1px 7px;border-radius:5px;background:var(--sunk);color:var(--muted)}
.av.active{background:var(--mint-soft);color:var(--mint)}
.menus{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));margin-bottom:16px}
.menu{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px;min-width:0;display:flex;flex-direction:column;gap:6px}
.menu .hd{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.menu .nm{font-weight:600;color:var(--navy)}
.menu .id{font-family:var(--f-mono);font-size:11.5px;color:var(--muted)}
.menu .ds{font-size:13px;color:var(--muted)}
.menu .st{font-size:12.5px}
.menu .st b{color:var(--navy);font-weight:600}
.banner{font-size:13px;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:20px}
.banner b{color:var(--ink)}
@media (max-width:900px){
  .shell{grid-template-columns:minmax(0,1fr);gap:0}
  nav.toc{display:none}
  details.toc-m{display:block;background:var(--surface);border:1px solid var(--line);border-radius:10px;margin-bottom:20px}
  details.toc-m summary{padding:10px 14px;cursor:pointer;font-weight:600;color:var(--navy)}
  details.toc-m ol{list-style:none;margin:0;padding:0 8px 10px;display:flex;flex-direction:column;gap:1px;font-size:13.5px}
  details.toc-m a{display:block;padding:5px 8px;color:var(--muted);text-decoration:none;border-radius:6px}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style>

<div class="shell">
  <nav class="toc" aria-label="목차"><div class="ttl">목차</div><ol id="toc"></ol></nav>
  <main>
    <details class="toc-m"><summary>목차</summary><ol id="toc-m"></ol></details>
    <div class="banner"><span>버전 <b>v${version}</b></span><span>원본 <b>docs/PLAN.md</b></span><span>이 페이지는 원본에서 자동 생성됩니다</span></div>
    <article class="doc" id="doc"><pre id="raw"></pre></article>
  </main>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script>
const MD = ${safe(md)};
const MENUS = ${safe(menus)};
const doc = document.getElementById('doc');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

if (window.marked) {
  doc.innerHTML = marked.parse(MD, { gfm: true });
} else {
  document.getElementById('raw').textContent = MD;   // CDN 실패 시 원문 그대로
}

// 표 가로 스크롤 감싸기 + Pn 단계 칩
doc.querySelectorAll('table').forEach((t) => { const w = document.createElement('div'); w.className = 'tbl'; t.parentNode.insertBefore(w, t); w.appendChild(t); });
doc.querySelectorAll('td').forEach((td) => {
  if (/^P[0-8]$/.test(td.textContent.trim())) td.innerHTML = '<span class="ph ' + td.textContent.trim() + '">' + td.textContent.trim() + '</span>';
});

// 부록: 분야 템플릿 카드
const groups = Object.fromEntries(MENUS.groups.map((g) => [g.id, g.label]));
const app = document.createElement('section');
app.innerHTML = '<h2 id="appendix-menus">부록. 분야 템플릿 (menus.json v' + esc(MENUS.templateVersion) + ')</h2>' +
  '<p>분야 ' + MENUS.menus.length + '개 + 업무공간 ' + MENUS.workspaces.length + '개. 화면은 하나이고 이 값만 바뀝니다. 원본: <code>docs/spec/menus.json</code></p>' +
  MENUS.groups.sort((a, b) => a.order - b.order).map((g) =>
    '<h3>' + esc(g.label) + '</h3><div class="menus">' + MENUS.menus.filter((m) => m.group === g.id).map((m) =>
      '<div class="menu"><div class="hd"><span class="nm">' + esc(m.label) + '</span><span class="ph ' + m.phase + '">' + m.phase + '</span>' +
      '<span class="av ' + m.availability + '">' + ({ active: '사용 가능', skeleton: '뼈대', planned: '계획' }[m.availability] || m.availability) + '</span></div>' +
      '<div class="id">' + esc(m.id) + ' · ' + esc(m.defaultAspect) + '</div>' +
      '<div class="ds">' + esc(m.description) + '</div>' +
      '<div class="st"><b>기획 순서</b> ' + m.planSteps.map((s) => esc(s.label)).join(' → ') + '</div>' +
      '<div class="st"><b>입력</b> ' + m.inputs.length + '개 · <b>검수</b> ' + m.review.length + '개 · <b>수정 메뉴</b> ' + m.reviseOptions.length + '개</div>' +
      (m.unconfirmed.length ? '<div class="st"><b>미확인</b> ' + m.unconfirmed.map(esc).join(' / ') + '</div>' : '') +
      '</div>').join('') + '</div>').join('') +
  '<h3>업무공간 (별도 프로젝트)</h3><div class="menus">' + MENUS.workspaces.map((w) =>
    '<div class="menu"><div class="hd"><span class="nm">' + esc(w.label) + '</span><span class="ph ' + w.phase + '">' + w.phase + '</span></div>' +
    '<div class="ds">' + esc(w.description) + '</div><div class="st"><b>하지 않음</b> ' + w.notDoing.map(esc).join(', ') + '</div></div>').join('') + '</div>';
doc.appendChild(app);

// 목차 + 현재 위치 표시
const hs = [...doc.querySelectorAll('h2')];
const slug = (t, i) => 's' + i;
hs.forEach((h, i) => { if (!h.id) h.id = slug(h.textContent, i); });
const items = hs.map((h) => '<li><a href="#' + h.id + '">' + esc(h.textContent) + '</a></li>').join('');
document.getElementById('toc').innerHTML = items;
document.getElementById('toc-m').innerHTML = items;
const links = [...document.querySelectorAll('#toc a')];
const io = new IntersectionObserver((es) => {
  es.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); });
}, { rootMargin: '0px 0px -75% 0px' });
hs.forEach((h) => io.observe(h));
</script>
`;

writeFileSync(join(docs, 'plan.html'), html);
console.log('wrote docs/plan.html', (html.length / 1024).toFixed(1) + 'KB', 'v' + version);
