// P1-08-SHORTS-STEPS 브라우저 대역: 실제 쇼츠 셸(ShortsStudio)을 공통 세션 경계 안에 그리고, 브라우저 안 fetch 대역(window.__shorts)이 서버를 대신한다.
// 실행기 tests/admin/admin-shorts-steps-run.mjs가 esbuild로 묶어 127.0.0.1에서 보인다. 값은 모두 합성이고 실제 Gemini·DB·YouTube 요청은 없다.
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import { ProtectedContent, SessionBoundary } from "@/components/auth/session-boundary";
import { ShortsTabGuard } from "@/components/admin/shorts-original/shorts-tab-guard";
import { ShortsStudio } from "@/components/admin/shorts-original/shorts-studio";
import { shortsIdeaPhases } from "@/lib/reference-analysis/shorts-ideas-contract";
import { shortsScriptSceneRange } from "@/lib/reference-analysis/shorts-script-contract";
import { shortsVaultPromptSearch } from "@/lib/reference-analysis/shorts-vault-contract";

type Fault = { status: number; body?: unknown };
type Call = { path: string; method: string; body: unknown; outcome: "pending" | "answered" | "aborted" };
type Stored = { id: string; revision: number; document: unknown; createdAt: string; updatedAt: string; expiresAt: string };
// P1-08-SHORTS-SESSION-RESTORE-OWNER: ?account=로 다른 합성 계정(B)으로 열 수 있다. 계정은 모두 합성(example.invalid)이다.
const startAccount = new URLSearchParams(location.search).get("account");
let account = startAccount && /^[a-z0-9.-]+@example\.invalid$/.test(startAccount) ? startAccount : "shorts-fixture@example.invalid";
const fixture = {
  calls: [] as Call[], faults: {} as Record<string, (Fault | null)[]>, delays: {} as Record<string, number>,
  session: "same" as "same" | "signed-out", vaultClosed: false,
  projects: new Map<string, Stored>(), prompts: new Map<string, { id: string; createdAt: string; document: { title: string; ideaTitle: string; keyword: string; prompts: unknown[]; bgmPrompt: unknown } }>(),
  requests: new Map<string, unknown>(), sequence: 0, multiOrder: "same" as "same" | "reversed",
  /** 다른 곳에서 프로젝트가 먼저 바뀐 상황(버전 경합). */
  bump(id: string) { const row = this.projects.get(id); if (row) row.revision += 1; },
};
(window as unknown as { __shorts: typeof fixture }).__shorts = fixture;

const reply = (body: unknown, status = 200) => status === 204 ? new Response(null, { status }) : Response.json(body, { status });
const wait = (ms: number, signal?: AbortSignal | null) => new Promise<void>((resolve, reject) => {
  if (!ms) return resolve();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("aborted", "AbortError")); }, { once: true });
});
const now = () => new Date().toISOString();
const nextId = () => `00000000-0000-4000-8000-${String(++fixture.sequence).padStart(12, "0")}`;
const source = (videoId: string) => ({ evidence: "youtube_video", videoId, provenance: "client_supplied" });
function searchItems() {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  return ["Aa000000001", "Bb000000002", "Cc000000003", "Dd000000004", "Ee000000005"].map((id, index) => ({
    id, url: `https://www.youtube.com/watch?v=${id}`, title: `합성 쇼츠 ${id.slice(0, 2)} · 전후 비교 ${index + 1}`, channelId: "UC" + "a".repeat(22),
    channelTitle: `합성 채널 ${index + 1}`, thumbnailUrl: null, publishedAt: hoursAgo(24 * (index + 1)), durationSeconds: 30 + index * 5,
    views: 200_000 - index * 30_000, likes: 900, comments: 30, subscribers: 10_000 + index * 5_000,
  }));
}

function ideas(keyword: string) {
  return Array.from({ length: 6 }, (_, index) => ({
    title: `${keyword} 소재 ${index + 1}`, openingHook: `${keyword}, 3초 안에 결과부터 보여줄게요 ${index + 1}`, hookStrategy: "결과 먼저 보여주고 과정으로 되감기",
    beats: shortsIdeaPhases.map(phase => ({ phase, action: `${phase} 구간에서 비교 장면을 이어간다` })),
    selectionReason: "분석한 영상의 전후 비교 공식을 그대로 옮길 수 있어요.",
    assessment: index === 5 ? null : { rationale: "모델 추정 근거", potentialScore: 90 - index * 5, expectedRetentionPercent: 70 - index, kind: "model_estimate" },
  }));
}
function scenes(durationSec: number, tag: string) {
  // 장면 수는 허용 최대값(180초면 45장면)으로 만들어 구간 나눠 받기를 끝까지 본다.
  const count = shortsScriptSceneRange(durationSec).max;
  const rest = durationSec - 3, step = Math.floor(rest / (count - 1));
  let start = 3;
  return Array.from({ length: count }, (_, index) => {
    const [from, to] = index === 0 ? [0, 3] : [start, index === count - 1 ? durationSec : start + step];
    if (index > 0) start = to;
    return { sceneNumber: index + 1, startSec: from, endSec: to, narration: `${tag} 씬 ${index + 1} 나레이션이에요.`, visual: `씬 ${index + 1} 정면 클로즈업`,
      caption: index === 0 ? "결과부터!" : null, sfx: index === 0 ? "휙" : null };
  });
}
const bgm = { title: "전후 비교 BGM", genreAndMood: "밝은 일렉트로닉 팝", recommendedBpmRange: { min: 110, max: 124 }, instrumentation: "신스 베이스, 클랩",
  dynamicStructure: "훅에서 멈췄다가 다시 올라간다.", audioMixingNotes: "내레이션 아래로 둔다.", sunoPrompt: "Instrumental, no vocals, bright electronic pop, 118 BPM." };

function vault(path: string, method: string, body: Record<string, unknown> | null): Response {
  if (fixture.vaultClosed) return reply({ code: "storage_unavailable" }, 503);
  const [, kind, id] = /^\/api\/admin\/shorts-vault\/(projects|prompts)(?:\/([^/]+))?$/.exec(path) ?? [];
  if (kind === "projects") {
    if (!id && method === "GET") return reply({ projects: [...fixture.projects.values()].reverse().map(({ document, ...row }) => {
      const doc = document as { title: string; keyword: string; step: number };
      return { ...row, title: doc.title, keyword: doc.keyword, step: doc.step };
    }) });
    if (!id && method === "POST") {
      const seen = fixture.requests.get(String(body?.requestId));
      if (seen) return reply(seen, 201);
      const at = now(), row = { id: nextId(), revision: 1, document: body?.document, createdAt: at, updatedAt: at, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() };
      fixture.projects.set(row.id, row);
      const doc = row.document as { title: string; keyword: string; step: number };
      const answer = { project: { id: row.id, revision: 1, createdAt: at, updatedAt: at, expiresAt: row.expiresAt, title: doc.title, keyword: doc.keyword, step: doc.step } };
      fixture.requests.set(String(body?.requestId), answer);
      return reply(answer, 201);
    }
    const row = id ? fixture.projects.get(id) : undefined;
    if (!row) return reply({ code: "not_found" }, 404);
    const doc = () => row.document as { title: string; keyword: string; step: number };
    const summary = () => ({ id: row.id, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt, expiresAt: row.expiresAt, title: doc().title, keyword: doc().keyword, step: doc().step });
    if (method === "GET") return reply({ project: { ...summary(), document: row.document } });
    if (method === "DELETE") { fixture.projects.delete(row.id); return reply(null, 204); }
    if (method === "PUT") {
      if (body?.expectedRevision !== row.revision) return reply({ code: "stale_revision", revision: row.revision }, 409);
      Object.assign(row, { revision: row.revision + 1, document: body.document, updatedAt: now() });
      return reply({ project: summary() });
    }
  }
  if (kind === "prompts") {
    type Row = typeof fixture.prompts extends Map<string, infer R> ? R : never;
    const summary = ({ id: setId, createdAt, document }: Row) =>
      ({ id: setId, createdAt, title: document.title, ideaTitle: document.ideaTitle, keyword: document.keyword, sceneCount: document.prompts.length, hasBgm: !!document.bgmPrompt });
    if (!id && method === "GET") return reply({ promptSets: [...fixture.prompts.values()].reverse().map(summary) });
    // P1-08-SHORTS-VAULT-CONTENT-SEARCH-UI: Backend와 맞춘 검색 계약 대역. {query}만, 앞뒤 공백을 뺀 1~120자. 제목·소재·첫 훅·키워드·장면 요약·이미지·영상·Suno에서
    // 대소문자 없이 찾고, 목록과 같은 요약 봉투({promptSets}, 최신순)로 돌려준다.
    if (id === "search" && method === "POST") {
      const search = shortsVaultPromptSearch.safeParse(body);
      if (!search.success) return reply({ code: "invalid_input" }, 400);
      const needle = search.data.query.toLowerCase();
      const matches = ({ document }: Row) => {
        const doc = document as unknown as { title: string; ideaTitle: string; keyword: string; hook?: string; bgmPrompt: { sunoPrompt?: string } | null;
          prompts: { sceneSummary?: string; imagePrompt?: string; videoPrompt?: string }[] };
        return [doc.title, doc.ideaTitle, doc.hook ?? "", doc.keyword, doc.bgmPrompt?.sunoPrompt ?? "",
          ...doc.prompts.flatMap(prompt => [prompt.sceneSummary ?? "", prompt.imagePrompt ?? "", prompt.videoPrompt ?? ""])].some(field => field.toLowerCase().includes(needle));
      };
      return reply({ promptSets: [...fixture.prompts.values()].reverse().filter(matches).map(summary) });
    }
    if (!id && method === "POST") {
      const seen = fixture.requests.get(String(body?.requestId));
      if (seen) return reply(seen, 201);
      const row = { id: nextId(), createdAt: now(), document: body?.document as never };
      fixture.prompts.set(row.id, row);
      const answer = { promptSet: { id: row.id } };
      fixture.requests.set(String(body?.requestId), answer);
      return reply(answer, 201);
    }
    const row = id ? fixture.prompts.get(id) : undefined;
    if (!row) return reply({ code: "not_found" }, 404);
    if (method === "GET") return reply({ promptSet: row });
    if (method === "DELETE") { fixture.prompts.delete(row.id); return reply(null, 204); }
  }
  return reply({}, 405);
}

// P1-08-SHORTS-RUNTIME-FIXES-F7: 요청 순서 주입(멈춤 문). Master 독립 재현(review-scratch/.../prepare.py)과 같은 장치를 공식 대역에 둔다.
// gates.arm("before:METHOD:path") — 요청이 대역에 닿기 전에 멈춘다. gates.arm("after:METHOD:path") — 보관함이 처리한 뒤 응답만 멈춘다.
// ignoreAbort가 true면 화면이 요청을 끊어도 대역은 응답을 기다린다(늦은 응답 확인용). release(key)로 풀고 pending(key)로 도착을 본다.
// seed()는 옛 프로젝트 두 개(A·B, 3단계, 버전 7)를 보관함에 심는다.
type Gate = { arrived: boolean; release?: () => void; ignoreAbort: boolean };
const gateMap = new Map<string, Gate>();
const gates = {
  arm(key: string, ignoreAbort = false) { gateMap.set(key, { arrived: false, ignoreAbort }); },
  pending(key: string) { return gateMap.get(key)?.arrived ?? false; },
  release(key: string) { gateMap.get(key)?.release?.(); },
  seed() {
    const time = now();
    const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
    const names = ["legacy-A", "legacy-B"];
    const videoIds = ["Aa000000001", "Bb000000002"];
    for (const [n, id] of ids.entries()) {
      const keyword = names[n], videoId = videoIds[n];
      const document = {
        title: keyword + " saved title", keyword, step: 3, videoIds: [videoId], source: source(videoId),
        context: { evidence: "youtube_video", videoId, summary: keyword + " old basis", hook: null, composition: null, observations: [] },
        ideas: ideas(keyword),
      };
      fixture.projects.set(id, { id, revision: 7, document, createdAt: time, updatedAt: time, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    }
  },
};
(window as unknown as { __review: typeof gates }).__review = gates;

async function hold(key: string, signal?: AbortSignal | null) {
  const gate = gateMap.get(key);
  if (!gate) return;
  gate.arrived = true;
  try {
    await new Promise<void>((resolve, reject) => {
      gate.release = resolve;
      if (!gate.ignoreAbort) {
        if (signal?.aborted) reject(new DOMException("aborted", "AbortError"));
        else signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }
    });
  } finally { gateMap.delete(key); }
}

window.fetch = async (input, init) => {
  const path = new URL(String(input instanceof Request ? input.url : input), location.href).pathname;
  const method = (init?.method ?? "GET").toUpperCase();
  const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
  const call: Call = { path, method, body, outcome: "pending" };
  fixture.calls.push(call);
  try {
    await hold(`before:${method}:${path}`, init?.signal);
    await wait(fixture.delays[path] ?? 0, init?.signal);
  } catch (error) { call.outcome = "aborted"; throw error; }
  if (init?.signal?.aborted) { call.outcome = "aborted"; throw new DOMException("aborted", "AbortError"); }
  call.outcome = "answered";
  if (path === "/api/auth/session") return fixture.session === "same" ? reply({ state: "same" }) : reply({ code: "AUTH_REQUIRED" }, 401);
  const fault = fixture.faults[path]?.shift();
  if (fault) return reply(fault.body ?? {}, fault.status);
  // P1-08-SHORTS-MULTI-VIDEO-ANALYSIS-UI: ① 검색 화면용 YouTube 키 상태·검색 결과(합성 후보 5개, 공급자 요청 없음).
  if (path === "/api/admin/youtube-credentials") return reply({ configured: true, version: 3, updatedAt: "2026-11-20T00:00:00.000Z" });
  if (path === "/api/admin/shorts-search") return reply({ schemaVersion: 1, evidence: "youtube_metadata", credentialVersion: 3, items: searchItems() });
  // 묶음 분석 {urls}: 서버 계약(881b367)처럼 videoIds는 보낸 순서 그대로, 근거마다 1부터 영상 번호. fixture.multiOrder가 "reversed"면 순서가 뒤바뀐 응답(형식 오류 확인용).
  if (path === "/api/admin/shorts-analysis" && method === "POST" && Array.isArray(body?.urls)) {
    const ids = (body.urls as string[]).map(url => /[?&]v=([\w-]{11})/.exec(url)?.[1] ?? "");
    const videoIds = fixture.multiOrder === "reversed" ? [...ids].reverse() : ids;
    return reply({ result: { evidence: "youtube_video", videoIds, findings: { summary: `영상 ${ids.length}개 공통: 결과를 먼저 보이고 과정을 되감는다`,
      hook: "모두 첫 1초에 결과 화면", composition: "세로 분할 비교", sound: null, draftPrompt: null,
      segments: ids.map((_, index) => ({ video: index + 1, timestamp: `00:0${index + 1}`, evidence: `영상 ${index + 1}의 결과 공개 근거` })) } } });
  }
  if (path === "/api/admin/shorts-analysis") return method === "GET" ? reply({ semantic: { shorts: "configured" } })
    : reply({ result: { evidence: "youtube_video", findings: { summary: "전후 비교를 첫 장면에 배치한 정리 쇼츠", hook: "결과 화면을 먼저 보여준다", composition: "세로 분할 화면",
      sound: null, draftPrompt: null, segments: [{ timestamp: "00:01", evidence: "결과 공개" }, { timestamp: "00:05", evidence: "과정 되감기" }] } } });
  if (path === "/api/admin/analysis-credentials") return reply({ storage: "ready", groups: { reference: { version: 7, updatedAt: now() }, music: { version: 0, updatedAt: null } },
    programs: { shorts: { configured: true, source: "stored", modelId: "fixture-model", lastTest: null } } });
  if (path === "/api/admin/shorts-ideas") {
    const context = body?.context as { videoId: string };
    return reply({ schemaVersion: 1, geminiCredentialVersion: 7, source: source(context.videoId), generation: { kind: "creative_suggestions", ideas: ideas(String(body?.keyword)) } });
  }
  if (path === "/api/admin/shorts-script") {
    const config = body?.config as { durationSec: number };
    const tag = body?.revision ? "수정본" : "초안";
    return reply({ schemaVersion: 1, geminiCredentialVersion: 7, source: body?.source, generation: { kind: "creative_script_draft", durationSec: config.durationSec, scenes: scenes(config.durationSec, tag) } });
  }
  if (path === "/api/admin/shorts-scene-prompt") {
    const list = body?.scenes as { sceneNumber: number; startSec: number; endSec: number }[];
    const range = body?.range as { from: number; to: number } | undefined;
    const prompt = ({ sceneNumber, startSec, endSec }: (typeof list)[number]) => ({ sceneNumber, startSec, endSec, sceneSummary: `씬 ${sceneNumber} 장면 요약`,
      imagePrompt: `Portrait 9:16 close-up shot number ${sceneNumber}, soft window light.`, videoPrompt: `Slow dolly in on subject, shot ${sceneNumber}.` });
    // P1-08-SHORTS-SCENE-CHUNKS: range가 있으면 그 구간 장면만(BGM 없음).
    if (range) return reply({ schemaVersion: 1, geminiCredentialVersion: 7, source: body?.source, generation: { kind: "creative_scene_prompts_range_draft",
      durationSec: body?.durationSec, range, prompts: list.slice(range.from - 1, range.to).map(prompt) } });
    return reply({ schemaVersion: 1, geminiCredentialVersion: 7, source: body?.source, generation: { kind: "creative_scene_prompts_draft", durationSec: body?.durationSec,
      prompts: list.map(({ sceneNumber, startSec, endSec }) => ({ sceneNumber, startSec, endSec, sceneSummary: `씬 ${sceneNumber} 장면 요약`,
        imagePrompt: `Portrait 9:16 close-up shot number ${sceneNumber}, soft window light.`, videoPrompt: `Slow dolly in on subject, shot ${sceneNumber}.` })), bgmPrompt: bgm } });
  }
  if (path === "/api/admin/shorts-bgm-prompt") return reply({ schemaVersion: 1, geminiCredentialVersion: 7, source: body?.source,
    generation: { ...bgm, ...(body?.direction ? { title: `${String(body.direction).slice(0, 40)} BGM` } : {}), kind: "creative_bgm_prompt_draft", durationSec: body?.durationSec } });
  if (path.startsWith("/api/admin/shorts-vault/")) {
    const response = vault(path, method, body);
    const key = `after:${method}:${path}`;
    if (gateMap.has(key)) {
      call.outcome = "pending";
      try { await hold(key, init?.signal); } catch (error) { call.outcome = "aborted"; throw error; }
      call.outcome = "answered";
    }
    return response;
  }
  return reply({ code: "not_found" }, 404);
};

// P1-08-SHORTS-RUNTIME-2 F1: 새로고침·칸 이동 복원 확인용.
// - ?persist: 합성 보관함·요청 기록을 새로고침 너머로 남긴다(이 주소일 때만, 다른 장면에는 영향 없음). ?persist=fresh면 남긴 값을 지우고 시작한다.
// - ?layout=embedded: 관리자 페이지에 끼운 모드로 그린다. __shorts.remount()는 작업실을 내렸다가 다시 그린다(관리자 칸 이동과 같음).
const params = new URLSearchParams(location.search);
const vaultKey = "shorts-fixture-vault";
if (params.has("persist")) {
  try {
    if (params.get("persist") === "fresh") localStorage.removeItem(vaultKey);
    const saved = JSON.parse(localStorage.getItem(vaultKey) ?? "null") as { projects: [string, Stored][]; calls: Call[]; sequence: number } | null;
    if (saved) { fixture.projects = new Map(saved.projects); fixture.calls = saved.calls; fixture.sequence = saved.sequence; }
  } catch { /* 합성 기록이 깨졌으면 빈 보관함으로 시작 */ }
  window.addEventListener("pagehide", () => localStorage.setItem(vaultKey, JSON.stringify({ projects: [...fixture.projects], calls: fixture.calls, sequence: fixture.sequence })));
}
// - ?sessionDelay=ms: 로그인 재확인(/api/auth/session) 응답을 늦춘다(다른 탭 신호 뒤 의심 동안 읽기·쓰기 없음 확인). ?signedOut: 재확인 답을 로그아웃으로 둔다.
// - ?noAccount: 끼운 작업실에 계정을 넘기지 않는다(계정 미전달이면 탭 저장을 읽지도 쓰지도 않음 확인).
// - __shorts.switchAccount(email): 같은 화면을 지운 뒤 다시 그리지 않고 세션 경계·작업실의 계정만 바꾼다(소유자 변경).
// 끼운 모드는 실제 관리 허브처럼 서버가 확인한 계정을 넘긴다(허브→ShortsAccount→ShortsWorkspace 연결은 정적 시험으로 확인).
const sessionDelay = Number(params.get("sessionDelay") ?? 0);
if (sessionDelay > 0 && sessionDelay <= 20_000) fixture.delays["/api/auth/session"] = sessionDelay;
if (params.has("signedOut")) fixture.session = "signed-out";
const embedded = params.get("layout") === "embedded";
const host = createRoot(document.getElementById("root")!);
// remount는 세션 경계는 그대로 두고 작업실만 내렸다가 다시 그린다(관리자 칸 이동과 같음, 확인 중 상태 유지).
let generation = 0;
// 끼운 모드는 실제 관리 허브(app/admin/page.tsx)처럼 경계 바로 안에 감시 부품, 그 아래 보호 본문이 작업실을 감싼다.
const app = () => <SessionBoundary account={account}>{embedded
  ? <><ShortsTabGuard /><main id="main-content"><ProtectedContent>
    <ShortsStudio key={generation} layout="embedded" account={params.has("noAccount") ? undefined : account} />
  </ProtectedContent></main></>
  : <ShortsStudio key={generation} account={account} />}</SessionBoundary>;
host.render(app());
Object.assign(fixture, {
  remount: () => { generation += 1; host.render(app()); },
  switchAccount: (email: string) => { account = email; delete fixture.delays["/api/auth/session"]; host.render(app()); },
});
