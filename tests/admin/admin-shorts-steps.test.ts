import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProject, deletePromptSet, listProjects, replaceProject, replyMessage, requestIdeas, requestScenePromptRange, requestScenePrompts, vaultClosed,
  limitVaultSearchInput, searchPromptSets, vaultSearchQuery,
} from "@/components/admin/shorts-original/shorts-client";
import {
  contextFromAnalysis, emptyShortsSession, fileName, firstTitle, progressStep, projectDocument, promptSetDocument, promptSetMarkdown,
  selectionOf, sessionFromProject, viewOfStep, withAnalysis, type ShortsSession,
} from "@/components/admin/shorts-original/shorts-session";
import { estimateText, ideaAction, proposalOf, ShortsIdeateStep, ShortsSelectStep } from "@/components/admin/shorts-original/shorts-step-ideate";
import {
  assembleScenePrompts, BgmResult, bgmKey, bgmScenesOnlyText, bulkPromptText, chunkRunningText, emptyParts, fillScenePromptParts, partsState, partsSummary, planSceneChunks, ShortsPromptsStep,
  type SceneChunk, type ScenePromptParts,
} from "@/components/admin/shorts-original/shorts-step-prompts";
import { draftConfig, SHORTS_TONES, ShortsScriptStep, speechOver, speechSeconds } from "@/components/admin/shorts-original/shorts-step-script";
import { ShortsAnalyzeStep } from "@/components/admin/shorts-original/shorts-step-search";
import { failedState, interruptedText, leaveHint, RunningCard, RunStatus, runningDefault } from "@/components/admin/shorts-original/shorts-step-ui";
import type { ShortsStepProps } from "@/components/admin/shorts-original/shorts-step-types";
import { daysLeft, nextFocusId, PromptSetDetail, ShortsVaultStep } from "@/components/admin/shorts-original/shorts-step-vault";
import { forgetPlan, saveResult, type ShortsWork } from "@/components/admin/shorts-original/shorts-work";
import { shortsVaultProjectDocument, shortsVaultPromptSetDocument, shortsVaultSearchQueryLimit } from "@/lib/reference-analysis/shorts-vault-contract";
import { shortsBgmPromptRequest } from "@/lib/reference-analysis/shorts-bgm-prompt-contract";
import { shortsScenePromptsBatchModelOutput, shortsScenePromptsBatchResult } from "@/lib/reference-analysis/shorts-scene-prompt-contract";
import { projectDocument as fixtureProject, promptSetDocument as fixturePromptSet } from "../reference-analysis/admin-shorts-vault-fixture";

// P1-08-SHORTS-STEPS: ③~⑥·보관함 화면의 상태 변환, 서버 요청, 저장 결과 판단, 첫 그림. 실제 클릭·늦은 응답·세 폭은 브라우저 확인(인계 문서).
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const full = sessionFromProject(fixtureProject());
const analysis = (segments = 5) => ({ evidence: "youtube_video" as const, findings: {
  summary: "가".repeat(600), hook: "첫 장면에서 결과를 먼저 보여준다", composition: null, sound: null, draftPrompt: null,
  segments: Array.from({ length: segments }, (_, index) => ({ timestamp: `00:0${index}`, evidence: `구간 ${index}` })),
} });

function work(session: ShortsSession, patch: Partial<ShortsWork> = {}): ShortsWork {
  const noop = () => {};
  return { session, update: noop, commit: noop, setAnalysis: noop, alive: () => () => true, consent: false, setConsent: noop,
    save: { kind: "idle" }, projectId: null, open: async () => ({ message: "", closed: false }), reset: noop, saveAsNew: noop,
    forget: () => false, snapshot: () => session, project: () => null, restore: noop, ...patch };
}
const render = (Screen: ComponentType<ShortsStepProps>, session: ShortsSession, patch: Partial<ShortsWork> = {}) =>
  renderToStaticMarkup(createElement(Screen, { pick: null, onPick: () => {}, goTo: () => {}, settingsHref: "/admin#admin-api-integrations", work: work(session, patch) }));

describe("작업 상태 변환", () => {
  it("② 분석 → ③ 근거: 요약 520자, 구간 3개, 빈 값은 null", () => {
    const context = contextFromAnalysis("A1b2C3d4E5F", analysis());
    expect(context).toMatchObject({ evidence: "youtube_video", videoId: "A1b2C3d4E5F", composition: null, observations: ["00:00 구간 0", "00:01 구간 1", "00:02 구간 2"] });
    expect(context.summary).toHaveLength(520);
    expect(context.summary.endsWith("…")).toBe(true);
  });

  it("새 분석은 뒤 단계를 비우고 영상 ID를 앞으로(중복 없이 3개까지), 키워드는 이 영상을 찾은 지금 검색어로 바꾼다(F8)", () => {
    const next = withAnalysis({ ...full, videoIds: ["B1b2C3d4E5F", "C1b2C3d4E5F", "D1b2C3d4E5F"] }, "C1b2C3d4E5F", analysis(), "다른 키워드");
    expect(next).toMatchObject({ ideas: [], selected: null, script: null, scenePrompts: null, source: null, keyword: "다른 키워드" });
    // 검색 없이 주소로 분석하면 앞 영상의 검색어를 남기지 않는다.
    expect(withAnalysis(full, "C1b2C3d4E5F", analysis()).keyword).toBe("");
    expect(withAnalysis(full, "C1b2C3d4E5F", analysis(), "   ").keyword).toBe("");
    expect(next.videoIds).toEqual(["C1b2C3d4E5F", "B1b2C3d4E5F", "D1b2C3d4E5F"]);
    expect(withAnalysis(emptyShortsSession, "A1b2C3d4E5F", analysis(), "캠핑").keyword).toBe("캠핑");
    expect(progressStep(next)).toBe(2);
  });

  it("프로젝트 문서는 엄격한 Vault 계약을 통과하고, 다시 열면 같은 상태·같은 단계로 돌아온다", () => {
    expect(projectDocument(emptyShortsSession)).toBeNull();
    const document = projectDocument(full)!;
    expect(shortsVaultProjectDocument.safeParse(document).success).toBe(true);
    expect(document.step).toBe(6);
    expect(sessionFromProject(document)).toEqual(full);
    expect([1, 2, 3, 4, 5, 6].map(viewOfStep)).toEqual(["search", "analyze", "ideate", "select", "script", "prompts"]);
    // 계약에 맞지 않는 상태(키워드 101자 초과는 잘리지만, 영상 4개는 거절)는 저장하지 않는다.
    expect(projectDocument({ ...full, videoIds: ["A1b2C3d4E5F", "B1b2C3d4E5F", "C1b2C3d4E5F", "D1b2C3d4E5F"] })).toBeNull();
  });

  it("프롬프트 세트 문서·Markdown·파일 이름", () => {
    expect(promptSetDocument({ ...full, scenePrompts: null })).toBeNull();
    const set = promptSetDocument(full)!;
    expect(shortsVaultPromptSetDocument.safeParse(set).success).toBe(true);
    expect(set).toMatchObject({ ideaTitle: full.selected!.title, durationSec: 17, videoIds: full.videoIds });
    const markdown = promptSetMarkdown(set);
    expect(markdown).toContain("## 씬 1 (00:00–00:03)");
    expect(markdown).toContain("**Suno prompt**");
    expect(fileName("a/b:c*d", "prompts")).toBe("a b c d-prompts.md");
    expect(fileName("\u0001", "script")).toBe("shorts-script.md");
  });
});

describe("서버 요청(합성 응답)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const settings = (version: number, configured = true) => Response.json({ groups: { reference: { version } }, programs: { shorts: { configured } } });
  const ideasResult = { schemaVersion: 1, geminiCredentialVersion: 7, source: { evidence: "youtube_video", videoId: "A1b2C3d4E5F", provenance: "client_supplied" },
    generation: { kind: "creative_suggestions", ideas: full.ideas } };

  it("생성 요청마다 Gemini 설정 버전을 새로 읽고, 동의·버전을 붙여 보낸다", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(settings(7)).mockResolvedValueOnce(Response.json(ideasResult));
    vi.stubGlobal("fetch", fetch);
    const reply = await requestIdeas({ keyword: "캠핑", context: full.context }, new AbortController().signal);
    expect(reply.kind).toBe("ok");
    expect(fetch.mock.calls.map(([path, init]) => [path, init.method])).toEqual([["/api/admin/analysis-credentials", "GET"], ["/api/admin/shorts-ideas", "POST"]]);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ keyword: "캠핑", context: full.context, authorized: true, geminiCredentialVersion: 7 });
    expect(fetch.mock.calls[1][1]).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error" });
  });

  it("저장된 키가 없으면 생성 요청을 보내지 않고 설정 안내", async () => {
    for (const reply of [settings(0), settings(3, false)]) {
      const fetch = vi.fn().mockResolvedValueOnce(reply);
      vi.stubGlobal("fetch", fetch);
      const result = await requestIdeas({}, new AbortController().signal);
      expect(result).toEqual({ kind: "failed", code: "not_configured", status: 503 });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("409·429·504·502·401·형식 오류·시간 초과·취소를 우리말 안내로 바꾼다", async () => {
    const cases: [Response | Error, string][] = [
      [Response.json({ code: "stale" }, { status: 409 }), "Gemini 설정이 그사이 바뀌었어요"],
      [Response.json({ code: "ideas_in_progress" }, { status: 429 }), "이미 만들고 있는 요청이 있어요"],
      [Response.json({ code: "timed_out" }, { status: 504 }), "응답이 늦어 멈췄어요"],
      [Response.json({ code: "invalid_model_response" }, { status: 502 }), "Gemini 응답이 형식에 맞지 않았어요"],
      [new Response(null, { status: 401 }), "관리자 로그인이 필요해요"],
      [Response.json({ ideas: [] }), "서버 응답이 형식에 맞지 않았어요"],
      [new DOMException("late", "TimeoutError"), "응답이 늦어 멈췄어요"],
    ];
    for (const [answer, message] of cases) {
      const fetch = vi.fn().mockResolvedValueOnce(settings(7));
      if (answer instanceof Error) fetch.mockRejectedValueOnce(answer); else fetch.mockResolvedValueOnce(answer);
      vi.stubGlobal("fetch", fetch);
      const reply = await requestScenePrompts({}, new AbortController().signal);
      expect(reply.kind, message).not.toBe("ok");
      expect(replyMessage(reply as Exclude<typeof reply, { kind: "ok" }>), message).toContain(message);
    }
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => { controller.abort(); throw new DOMException("stop", "AbortError"); }));
    expect(await requestIdeas({}, controller.signal)).toEqual({ kind: "failed", code: "cancelled", status: 0 });
  });

  it("보관함: 503은 연결 전, 생성은 요청 ID와 문서, 덮어쓰기는 버전, 삭제 204는 성공", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "storage_unavailable" }, { status: 503 })));
    expect(vaultClosed(await listProjects(new AbortController().signal))).toBe(true);
    const summary = { id: "p1", title: "t", keyword: "", step: 2, revision: 1, createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T00:00:00.000Z", expiresAt: "2026-12-22T00:00:00.000Z" };
    const fetch = vi.fn(async () => Response.json({ project: summary }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    const document = projectDocument(full)!;
    expect(await createProject("40000000-0000-4000-8000-000000000001", document, new AbortController().signal)).toEqual({ kind: "ok", value: summary });
    await replaceProject("p1", 4, document, new AbortController().signal);
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([path, init]) => [path, init.method])).toEqual([["/api/admin/shorts-vault/projects", "POST"], ["/api/admin/shorts-vault/projects/p1", "PUT"]]);
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ requestId: "40000000-0000-4000-8000-000000000001", document });
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ expectedRevision: 4, document });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    expect((await deletePromptSet("s1", new AbortController().signal)).kind).toBe("ok");
  });
});

describe("프로젝트 저장 결과 판단", () => {
  const current = { id: "p1", revision: 2, expiresAt: "2026-12-22T00:00:00.000Z" };
  it("성공·연결 전·버전 경합·한도·만료·그 밖", () => {
    expect(saveResult({ kind: "ok", value: { ...current, revision: 3 } }, current)).toEqual({ save: { kind: "saved", expiresAt: current.expiresAt }, project: { ...current, revision: 3 } });
    expect(saveResult({ kind: "failed", code: "storage_unavailable", status: 503 }, null).save).toEqual({ kind: "closed" });
    expect(saveResult({ kind: "failed", code: "stale_revision", status: 409 }, current).save).toEqual({ kind: "stale", id: "p1" });
    expect(saveResult({ kind: "failed", code: "limit_reached", status: 409 }, null).save).toEqual({ kind: "limit" });
    expect(saveResult({ kind: "failed", code: "not_found", status: 404 }, current)).toEqual({ save: { kind: "expired" }, forget: true });
    expect(saveResult({ kind: "denied" }, current).save).toMatchObject({ kind: "failed", message: expect.stringContaining("로그인") });
    expect(daysLeft("2026-12-22T00:00:00.000Z", Date.parse("2026-11-22T00:00:00.000Z"))).toBe(30);
    expect(daysLeft("2026-11-21T00:00:00.000Z", Date.parse("2026-11-22T00:00:00.000Z"))).toBe(0);
  });
});

describe("단계 화면 첫 그림", () => {
  it("앞 단계 결과가 없으면 돌아갈 단계를 안내한다", () => {
    expect(text(render(ShortsIdeateStep, emptyShortsSession))).toContain("먼저 ② 바이럴 구조 해체에서 영상을 분석해야");
    expect(text(render(ShortsSelectStep, emptyShortsSession))).toContain("고른 소재가 없어요");
    expect(text(render(ShortsScriptStep, emptyShortsSession))).toContain("확정한 주제가 없어요");
    expect(text(render(ShortsPromptsStep, { ...full, script: null }))).toContain("대본이 아직 없어요");
  });

  it("③ 소재: 동의 전에는 실행할 수 없고, 6개 카드와 모델 추정 표시", () => {
    const html = render(ShortsIdeateStep, full);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toMatch(/<button type="button" class="[^"]*" disabled="">소재 다시 발굴하기<\/button>/);
    expect(html.match(/IDEA #/g)).toHaveLength(6);
    expect(text(html)).toContain("잠재점수 70점 · 모델 추정");
    expect(render(ShortsIdeateStep, full, { consent: true })).toMatch(/<button type="button" class="[^"]*">소재 다시 발굴하기<\/button>/);
  });

  it("④ 확정: 훅·전략·구간 로드맵·추가 요청", () => {
    const plain = text(render(ShortsSelectStep, { ...full, direction: "밝게" }));
    for (const piece of ["1초 킬러 훅", "도입 · 첫 3초", "결말 · 반전", "이 전략으로 대본 만들기"]) expect(plain, piece).toContain(piece);
    expect(render(ShortsSelectStep, { ...full, direction: "밝게" })).toContain(">밝게</textarea>");
  });

  it("⑤ 대본: 원본 톤 7종·15/30/60·씬 문구·말하기 길이 어림값", () => {
    const html = render(ShortsScriptStep, full);
    for (const tone of SHORTS_TONES) expect(text(html)).toContain(tone);
    expect(text(html)).toContain("15초 30초 60초");
    expect(html.match(/SCENE \d/g)).toHaveLength(3);
    expect(text(html)).toContain(`나레이션 약 ${speechSeconds(full.script!.scenes.map(scene => scene.narration))}초 / 목표 17초`);
    expect(speechSeconds(["가나다라마바", "사아자차카타"])).toBe(2);
  });

  it("⑥ 프롬프트: 장면별 이미지·영상, BGM, 보관함 저장", () => {
    const plain = text(render(ShortsPromptsStep, full));
    for (const piece of ["SCENE 1", "SCENE 3", "Image", "Video", "Suno", "전후 비교 BGM", "📚 보관함에 저장", "이미지 전체 복사"]) expect(plain, piece).toContain(piece);
  });

  it("② 분석 뒤에는 ③으로 가는 단추, 보관함은 서버를 읽는 동안 불러오는 중", () => {
    expect(text(render(ShortsAnalyzeStep, full))).toContain("💡 킬러 소재 발굴로");
    expect(text(render(ShortsAnalyzeStep, emptyShortsSession))).not.toContain("💡 킬러 소재 발굴로");
    expect(text(render(ShortsVaultStep, emptyShortsSession))).toContain("불러오는 중…");
  });
});

// P1-08-SHORTS-SCENE-CHUNKS: ⑥ 장면 구간 나눠 받기(합성 요청 함수). 실제 공급자·DB 호출 없음.
describe("⑥ 장면 구간 나눠 받기", () => {
  afterEach(() => vi.unstubAllGlobals());
  const timeline = (durationSec: number, count: number) => Array.from({ length: count }, (_, index) => ({
    sceneNumber: index + 1,
    startSec: index === 0 ? 0 : 3 + Math.floor((durationSec - 3) * (index - 1) / (count - 1)),
    endSec: index === 0 ? 3 : 3 + Math.floor((durationSec - 3) * index / (count - 1)),
    narration: `장면 ${index + 1} 나레이션이에요.`, visual: "정면 클로즈업", caption: index === 0 ? "결과부터!" : null, sfx: null,
  }));
  const script = { kind: "creative_script_draft" as const, durationSec: 180, scenes: timeline(180, 45) };
  const basis = (bgmDirection = "") => ({ source: full.source!, selected: full.selected!, script, bgmDirection });
  const bgm = { title: "전후 비교 BGM", genreAndMood: "밝은 일렉트로닉 팝", recommendedBpmRange: { min: 110, max: 124 }, instrumentation: "신스",
    dynamicStructure: "훅에서 멈췄다가 다시 올라간다.", audioMixingNotes: "내레이션 아래로 둔다.", sunoPrompt: "Instrumental, no vocals, bright pop." };
  type Body = Record<string, unknown> & { range: SceneChunk };
  const rangeReply = (body: Body) => ({ kind: "ok" as const, value: { schemaVersion: 1 as const, geminiCredentialVersion: 7, source: full.source!,
    generation: { kind: "creative_scene_prompts_range_draft" as const, durationSec: 180, range: body.range,
      prompts: script.scenes.slice(body.range.from - 1, body.range.to).map(scene => ({ sceneNumber: scene.sceneNumber, startSec: scene.startSec, endSec: scene.endSec,
        sceneSummary: `씬 ${scene.sceneNumber} 요약`, imagePrompt: `Portrait 9:16 shot ${scene.sceneNumber}.`, videoPrompt: `Slow dolly ${scene.sceneNumber}.` })) } } });
  const bgmReply = () => ({ kind: "ok" as const, value: { schemaVersion: 1 as const, geminiCredentialVersion: 7, source: full.source!,
    generation: { ...bgm, kind: "creative_bgm_prompt_draft" as const, durationSec: 180 } } });
  const failed = (code: string, status: number) => ({ kind: "failed" as const, code, status });
  function harness(answer: (kind: "range" | "bgm", body: Record<string, unknown>, call: number) => unknown = (kind, body) => kind === "range" ? rangeReply(body as Body) : bgmReply()) {
    const calls: string[] = [];
    const parts: ScenePromptParts[] = [];
    const progress: string[] = [];
    const bgmFailures: unknown[] = [];
    let count = 0;
    const requestRange = vi.fn(async (body: Body) => { calls.push(`${body.range.from}-${body.range.to}`); return answer("range", body, count++) as never; });
    const requestBgm = vi.fn(async (body: Record<string, unknown>) => { calls.push("bgm"); return answer("bgm", body, count++) as never; });
    const fill = (start: ScenePromptParts, options: { current?: () => boolean; signal?: AbortSignal; b?: ReturnType<typeof basis> } = {}) =>
      fillScenePromptParts({ basis: options.b ?? basis(), parts: start, signal: options.signal ?? new AbortController().signal, current: options.current ?? (() => true),
        requestRange, requestBgm, onPart: next => parts.push(next), onProgress: text => progress.push(text), onBgmFailed: reply => bgmFailures.push(reply) });
    return { calls, parts, progress, fill, requestRange, requestBgm, bgmFailures };
  }

  it("구간 계획: 45장면은 9개씩 5구간, 30장면은 8·8·8·6, 짧은 대본은 1구간", () => {
    expect(planSceneChunks(45)).toEqual([{ from: 1, to: 9 }, { from: 10, to: 18 }, { from: 19, to: 27 }, { from: 28, to: 36 }, { from: 37, to: 45 }]);
    expect(planSceneChunks(30).map(chunk => chunk.to - chunk.from + 1)).toEqual([8, 8, 8, 6]);
    expect(planSceneChunks(10)).toEqual([{ from: 1, to: 5 }, { from: 6, to: 10 }]);
    expect(planSceneChunks(3)).toEqual([{ from: 1, to: 3 }]);
    for (let count = 3; count <= 45; count++) {
      const plan = planSceneChunks(count);
      expect(plan.flatMap(chunk => Array.from({ length: chunk.to - chunk.from + 1 }, (_, index) => chunk.from + index))).toEqual(Array.from({ length: count }, (_, index) => index + 1));
      expect(plan.every(chunk => chunk.to - chunk.from + 1 <= 9)).toBe(true);
      expect(plan.length).toBeLessThanOrEqual(5);
    }
  });

  it("45장면: 구간 5번 + BGM 1번, 합친 결과는 기존 전체 묶음 계약과 보관함 문서를 통과한다", async () => {
    const { calls, fill, requestRange, requestBgm, progress } = harness();
    const reply = await fill(emptyParts(basis("밝게")), { b: basis("밝게") });
    expect(calls).toEqual(["1-9", "10-18", "19-27", "28-36", "37-45", "bgm"]);
    expect(progress).toEqual(["장면 1~9 만드는 중 (1/6)", "장면 10~18 만드는 중 (2/6)", "장면 19~27 만드는 중 (3/6)", "장면 28~36 만드는 중 (4/6)",
      "장면 37~45 만드는 중 (5/6)", "BGM 프롬프트 만드는 중 (6/6)"]);
    expect(reply.kind).toBe("ok");
    const value = (reply as { value: NonNullable<ShortsSession["scenePrompts"]> }).value;
    expect(value.prompts.map(prompt => prompt.sceneNumber)).toEqual(script.scenes.map(scene => scene.sceneNumber));
    expect(value.bgmPrompt).toEqual(bgm);
    expect(shortsScenePromptsBatchResult.safeParse({ schemaVersion: 1, geminiCredentialVersion: 7, source: full.source, generation: value }).success).toBe(true);
    const document = promptSetDocument({ ...full, script, scenePrompts: value });
    expect(shortsVaultPromptSetDocument.safeParse(document).success).toBe(true);
    const sent = requestRange.mock.calls[0][0];
    expect(sent).toEqual({ source: full.source, selectedIdea: { title: full.selected!.title, openingHook: full.selected!.openingHook }, durationSec: 180,
      scenes: script.scenes, range: { from: 1, to: 9 } });
    expect(sent).not.toHaveProperty("bgmDirection");
    const bgmBody = requestBgm.mock.calls[0][0] as { cues: { sceneNumber: number; note: string }[]; direction: string };
    expect(bgmBody.direction).toBe("밝게");
    expect(bgmBody.cues.map(cue => cue.sceneNumber)).toEqual([1, 16, 30, 45]);
    expect(bgmBody.cues[0].note).toBe("결과부터!");
    expect(shortsBgmPromptRequest.safeParse({ ...bgmBody, authorized: true, geminiCredentialVersion: 7 }).success).toBe(true);
  });

  it("3번째 구간 504면 거기서 멈추고, 다시 하면 빠진 구간과 BGM만 보낸다", async () => {
    const first = harness((kind, body, call) => call === 2 ? failed("timed_out", 504) : kind === "range" ? rangeReply(body as Body) : bgmReply());
    const reply = await first.fill(emptyParts(basis()));
    expect(reply).toEqual(failed("timed_out", 504));
    expect(first.calls).toEqual(["1-9", "10-18", "19-27"]);
    const kept = first.parts.at(-1)!;
    expect(Object.keys(kept.chunks)).toEqual(["1", "10"]);
    expect(partsSummary(basis(), kept)).toEqual({ done: 2, total: 6 });
    expect(assembleScenePrompts(basis(), kept)).toBeNull();
    const second = harness();
    expect((await second.fill(kept)).kind).toBe("ok");
    expect(second.calls).toEqual(["19-27", "28-36", "37-45", "bgm"]);
  });

  it("BGM만 실패하면 장면 결과는 BGM 없이 살리고(F2), 다시 하면 BGM만 보내고, BGM 방향을 바꾸면 장면 구간은 그대로 두고 BGM만 다시 받는다", async () => {
    const first = harness((kind, body) => kind === "bgm" ? failed("bgm_prompt_in_progress", 429) : rangeReply(body as Body));
    const partial = await first.fill(emptyParts(basis()));
    expect(partial.kind).toBe("ok");
    const scenesOnly = (partial as { value: NonNullable<ShortsSession["scenePrompts"]> }).value;
    expect(scenesOnly.bgmPrompt).toBeNull();
    expect(scenesOnly.prompts.map(prompt => prompt.sceneNumber)).toEqual(script.scenes.map(scene => scene.sceneNumber));
    expect(first.bgmFailures).toEqual([failed("bgm_prompt_in_progress", 429)]);
    // BGM 없는 결과도 묶음 결과·프로젝트 문서·프롬프트 세트 계약을 통과한다.
    expect(shortsScenePromptsBatchResult.safeParse({ schemaVersion: 1, geminiCredentialVersion: 7, source: full.source, generation: scenesOnly }).success).toBe(true);
    expect(shortsVaultProjectDocument.safeParse(projectDocument({ ...full, script, scenePrompts: scenesOnly })).success).toBe(true);
    expect(shortsVaultPromptSetDocument.safeParse(promptSetDocument({ ...full, script, scenePrompts: scenesOnly })).success).toBe(true);
    expect(partsState(basis(), first.parts.at(-1)!)).toBe("bgm");
    expect(replyMessage(failed("bgm_prompt_in_progress", 429))).toContain("이미 BGM 프롬프트를 만들고 있어요");
    const second = harness();
    expect((await second.fill(first.parts.at(-1)!)).kind).toBe("ok");
    expect(second.calls).toEqual(["bgm"]);
    const done = second.parts.at(-1)!;
    expect(assembleScenePrompts(basis(), done)).not.toBeNull();
    expect(assembleScenePrompts(basis("어둡게"), done)).toBeNull();
    const third = harness();
    expect((await third.fill(done, { b: basis("어둡게") })).kind).toBe("ok");
    expect(third.calls).toEqual(["bgm"]);
  });

  it("대본·프로젝트가 바뀐 뒤 도착한 응답과 취소된 응답은 버리고, 다른 대본의 부분은 쓰지 않는다", async () => {
    let live = true;
    const late = harness((kind, body, call) => { if (call === 1) live = false; return kind === "range" ? rangeReply(body as Body) : bgmReply(); });
    expect(await late.fill(emptyParts(basis()), { current: () => live })).toEqual(failed("cancelled", 0));
    expect(late.calls).toEqual(["1-9", "10-18"]);
    expect(late.parts).toHaveLength(1);
    const controller = new AbortController();
    const cancelled = harness((kind, body, call) => { if (call === 0) controller.abort(); return rangeReply(body as Body); });
    expect(await cancelled.fill(emptyParts(basis()), { signal: controller.signal })).toEqual(failed("cancelled", 0));
    expect(cancelled.parts).toHaveLength(0);
    const otherScript = { ...basis(), script: { ...script, scenes: script.scenes.map(scene => ({ ...scene, narration: `${scene.narration} 수정` })) } };
    const fresh = harness();
    expect((await fresh.fill(late.parts[0], { b: otherScript })).kind).toBe("ok");
    expect(fresh.calls).toEqual(["1-9", "10-18", "19-27", "28-36", "37-45", "bgm"]);
    expect(partsSummary(otherScript, late.parts[0])).toEqual({ done: 0, total: 6 });
  });

  it("합칠 때 계약에 맞지 않는 구간(시간 어긋남)이 있으면 결과를 내지 않는다", async () => {
    const bad = harness((kind, body) => {
      if (kind === "bgm") return bgmReply();
      const reply = rangeReply(body as Body);
      if ((body as Body).range.from === 10) reply.value.generation.prompts[0].startSec += 1;
      return reply;
    });
    expect(await bad.fill(emptyParts(basis()))).toEqual(failed("invalid_response", 0));
  });

  it("구간 요청: 동의·버전을 붙이고, 응답 구간이 보낸 구간과 다르면 쓰지 않으며, 진행 중 오류를 구분한다", async () => {
    const settings = () => Response.json({ groups: { reference: { version: 7 } }, programs: { shorts: { configured: true } } });
    const body = { source: full.source, selectedIdea: { title: full.selected!.title, openingHook: full.selected!.openingHook }, durationSec: 180, scenes: script.scenes, range: { from: 1, to: 9 } };
    const fetch = vi.fn().mockResolvedValueOnce(settings()).mockResolvedValueOnce(Response.json(rangeReply(body).value));
    vi.stubGlobal("fetch", fetch);
    expect((await requestScenePromptRange(body, new AbortController().signal)).kind).toBe("ok");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ ...body, authorized: true, geminiCredentialVersion: 7 });
    const other = vi.fn().mockResolvedValueOnce(settings()).mockResolvedValueOnce(Response.json(rangeReply({ ...body, range: { from: 10, to: 18 } }).value));
    vi.stubGlobal("fetch", other);
    expect(await requestScenePromptRange(body, new AbortController().signal)).toEqual({ kind: "failed", code: "invalid_response", status: 200 });
    for (const code of ["scene_prompt_in_progress", "script_in_progress", "bgm_prompt_in_progress"]) expect(replyMessage(failed(code, 429))).toMatch(/^이미 .+ 만들고 있어요/);
  });

  it("⑥ 화면은 9개씩 나눠 받는다고 안내한다", () => {
    expect(text(render(ShortsPromptsStep, { ...full, scenePrompts: null }))).toContain("장면은 9개씩 나눠 차례로 받아요");
  });
});

// P1-08-SHORTS-SCENE-CHUNKS-UX: 실행 문구(요청별 상한 vs 전체), BGM 방향만 바뀐 상태 판정.
describe("⑥ 나눠 받기 안내", () => {
  const running = { running: true, message: "", notConfigured: false };
  const status = (runningText?: string) => text(renderToStaticMarkup(createElement(RunStatus, { state: running, settingsHref: "/admin", onCancel: () => {}, runningText })));

  it("다른 단계는 기존 '최대 40초' 문구 그대로, ⑥은 요청마다 40초와 남은 요청 수를 따로 알린다", () => {
    expect(status()).toContain(runningDefault);
    expect(runningDefault).toBe("Gemini가 만들고 있어요. 최대 40초쯤 걸려요.");
    expect(status(chunkRunningText(6))).toContain("요청마다 최대 40초쯤 걸리고, 남은 요청은 6번이에요.");
    expect(status(chunkRunningText(6))).not.toContain(runningDefault);
    const done = text(renderToStaticMarkup(createElement(RunStatus, { state: { running: false, message: "다 만들었어요.", notConfigured: false }, settingsHref: "/admin", onCancel: () => {}, runningText: chunkRunningText(2) })));
    expect(done).toContain("다 만들었어요.");
  });

  it("받아 둔 부분 판정: 없음 → 일부 → 완성(없음) → BGM 방향만 바뀜(BGM만)", () => {
    const scenes = Array.from({ length: 12 }, (_, index) => ({ sceneNumber: index + 1, startSec: index === 0 ? 0 : 3 + (index - 1) * 4,
      endSec: index === 0 ? 3 : 3 + index * 4, narration: `장면 ${index + 1}`, visual: "정면", caption: null, sfx: null }));
    const script = { kind: "creative_script_draft" as const, durationSec: 47, scenes };
    const basis = (bgmDirection: string) => ({ source: full.source!, selected: full.selected!, script, bgmDirection });
    const chunk = (from: number, to: number) => scenes.slice(from - 1, to).map(scene => ({ sceneNumber: scene.sceneNumber, startSec: scene.startSec, endSec: scene.endSec,
      sceneSummary: `씬 ${scene.sceneNumber}`, imagePrompt: `Portrait shot ${scene.sceneNumber}.`, videoPrompt: `Dolly ${scene.sceneNumber}.` }));
    const bgm = { title: "BGM", genreAndMood: "밝게", recommendedBpmRange: null, instrumentation: "신스", dynamicStructure: "올라감", audioMixingNotes: "아래로", sunoPrompt: "Instrumental, no vocals." };
    const empty = emptyParts(basis("밝게"));
    expect(partsState(basis("밝게"), empty)).toBe("none");
    const half = { ...empty, chunks: { 1: chunk(1, 6) }, version: 7 };
    expect(partsState(basis("밝게"), half)).toBe("partial");
    const complete = { ...half, chunks: { 1: chunk(1, 6), 7: chunk(7, 12) }, bgm: { key: bgmKey(basis("밝게")), value: bgm } };
    expect(assembleScenePrompts(basis("밝게"), complete)).not.toBeNull();
    expect(partsState(basis("밝게"), complete)).toBe("none");
    expect(partsState(basis("어둡게"), complete)).toBe("bgm");
    expect(partsSummary(basis("어둡게"), complete)).toEqual({ done: 2, total: 3 });
    // F2: 장면은 다 있고 BGM만 없으면(BGM만 실패) BGM만 다시 만든다.
    const noBgm = { ...complete, bgm: null };
    expect(partsState(basis("어둡게"), noBgm)).toBe("bgm");
    expect(assembleScenePrompts(basis("어둡게"), noBgm)).toBeNull();
    expect(assembleScenePrompts(basis("어둡게"), noBgm, true)?.bgmPrompt).toBeNull();
    // 장면이 덜 모였으면 BGM 없이도 합치지 않는다.
    expect(assembleScenePrompts(basis("밝게"), { ...half, bgm: null }, true)).toBeNull();
    // 방향이 바뀐 옛 BGM은 BGM 없이 합칠 때도 쓰지 않는다.
    expect(assembleScenePrompts(basis("어둡게"), complete, true)?.bgmPrompt).toBeNull();
  });
});

// P1-08-SHORTS-ORIGINAL-RESULTS-PARITY(Master msg_88e80339e16d 배정 1): 원본 v2.01 결과 화면 조작 차이.
// ④ 고른 이유·모델 추정(SelectStep whyItWorks·잠재력 배지), ⑥ 전체 복사 장면 번호(promptCopy.formatScenePrompts),
// 보관함 장면별 이미지·영상 이름표와 복사(VaultPanel CopyBox), 지운 뒤 초점. 모두 합성 값이며 서버·공급자 호출 없음.
describe("원본 결과 화면 맞춤", () => {
  const ideas = full.ideas.map((item, index) => index === 1
    ? { ...item, selectionReason: "전후 비교가 3초 안에 보인다",
      assessment: { rationale: "비교 구도가 분명하다", potentialScore: 82, expectedRetentionPercent: 64, kind: "model_estimate" as const } }
    : index === 2 ? { ...item, assessment: null } : item);
  const chosen = (index: number): ShortsSession => ({ ...full, ideas, selected: selectionOf(ideas[index]) });

  it("④: 고른 소재에 서버가 준 이유와 모델 추정만 보이고, 없는 값은 만들지 않는다", () => {
    const plain = text(render(ShortsSelectStep, chosen(1)));
    expect(plain).toContain("잠재력 82점 · 예상 완청 64% · 모델 추정");
    expect(plain).toContain("성공 요인 · 이 소재를 고른 이유 전후 비교가 3초 안에 보인다");
    expect(plain).toContain("모델 추정 근거: 비교 구도가 분명하다");
    // 완청 추정이 없으면 그 부분만 뺀다.
    const partial = text(render(ShortsSelectStep, chosen(0)));
    expect(partial).toContain("잠재력 70점 · 모델 추정");
    expect(partial).not.toContain("예상 완청");
    // 추정이 없으면 배지·근거 없이 고른 이유만.
    const noEstimate = text(render(ShortsSelectStep, chosen(2)));
    expect(noEstimate).toContain("이 소재를 고른 이유 비교가 빠르다");
    expect(noEstimate).not.toMatch(/잠재력|모델 추정/);
    // ③ 목록에 없는 소재(합성 프로젝트의 selectedIdea)면 칸 자체가 없다.
    expect(proposalOf(full.ideas, full.selected!)).toBeNull();
    expect(text(render(ShortsSelectStep, full))).not.toMatch(/성공 요인|잠재력|모델 추정/);
    expect(estimateText(null)).toBeNull();
    expect(estimateText({ rationale: "근거", potentialScore: null, expectedRetentionPercent: null, kind: "model_estimate" })).toBeNull();
    expect(estimateText({ rationale: "근거", potentialScore: null, expectedRetentionPercent: 0, kind: "model_estimate" })).toBe("예상 완청 0% · 모델 추정");
  });

  it("⑥ 전체 복사: 장면 번호 순 [SCENE n] 머리말, 빈 프롬프트는 빼고 앞뒤 공백만 정리", () => {
    const prompts = [{ sceneNumber: 2, imagePrompt: " Second image ", videoPrompt: " " }, { sceneNumber: 1, imagePrompt: "First image", videoPrompt: "First move" }];
    expect(bulkPromptText(prompts, "image")).toBe("[SCENE 1]\nFirst image\n\n[SCENE 2]\nSecond image");
    expect(bulkPromptText(prompts, "video")).toBe("[SCENE 1]\nFirst move");
    expect(bulkPromptText([], "image")).toBe("");
    const document = fixturePromptSet();
    expect(bulkPromptText(document.prompts, "video").split("\n\n")).toEqual(document.prompts.map(prompt => `[SCENE ${prompt.sceneNumber}]\n${prompt.videoPrompt}`));
    expect(text(render(ShortsPromptsStep, full))).toContain("씬 번호 순서로 [SCENE n] 머리말을 붙여 모아 복사해요.");
  });

  it("보관함 펼친 세트: 장면마다 이미지·영상 이름표 칸과 복사, BGM은 Suno 복사", () => {
    const document = fixturePromptSet();
    const count = document.prompts.length;
    const html = renderToStaticMarkup(createElement(PromptSetDetail, { document }));
    const plain = text(html);
    expect(html.match(/<li\b/g)).toHaveLength(count + 1);
    expect(plain.match(/🖼️ Image prompt \(9:16\)/g)).toHaveLength(count);
    expect(plain.match(/🎥 Video prompt/g)).toHaveLength(count);
    expect(plain.match(/이미지 복사/g)).toHaveLength(count);
    expect(plain.match(/영상 복사/g)).toHaveLength(count);
    expect(plain.match(/Suno 복사/g)).toHaveLength(1);
    expect(plain.match(/⏱️ \d{2}:\d{2}–\d{2}:\d{2}/g)).toHaveLength(count);
    expect(plain).toContain("110–124 BPM");
    // 이미지·영상 문구는 각자 이름표 칸 안에 있다(섞이지 않음).
    expect(html).toMatch(/Image prompt \(9:16\)<\/span><p lang="en">Portrait 9:16 close-up/);
    expect(html).toMatch(/Video prompt<\/span><p lang="en">Slow dolly in/);
    // BGM이 없는 세트는 장면만.
    const noBgm = renderToStaticMarkup(createElement(PromptSetDetail, { document: { ...document, bgmPrompt: null } }));
    expect(noBgm.match(/<li\b/g)).toHaveLength(count);
    expect(text(noBgm)).not.toContain("Suno");
  });

  it("지운 뒤 초점 대상: 보이는 순서의 다음, 마지막이면 바로 앞, 혼자였거나 목록에 없으면 없음", () => {
    expect(nextFocusId(["a", "b", "c"], "a")).toBe("b");
    expect(nextFocusId(["a", "b", "c"], "b")).toBe("c");
    expect(nextFocusId(["a", "b", "c"], "c")).toBe("b");
    expect(nextFocusId(["a"], "a")).toBeNull();
    expect(nextFocusId(["a", "b"], "z")).toBeNull();
  });
});

// P1-08-SHORTS-ORIGINAL-STAGE-FEEDBACK(Master msg_962056a5a146 배정 1): ③⑤⑥ 실행 중 카드, ⑤ 목표 초과 어림 경고, ⑥ BGM 이름표.
// 실행 중 상태는 useRun 안에서만 생겨서 첫 그림에는 없다 → 카드 자체와 쉬는 화면을 여기서, 실제 실행 중 모습은 브라우저 확인(인계 문서)에서 본다.
describe("단계 진행 표시와 결과 이름표", () => {
  it("실행 중 카드: ③⑤는 끝을 모르는 진행 막대, ⑥은 받은 부분 수(범위 밖은 잘라냄), 읽어 주는 상태 문구는 RunStatus 하나", () => {
    const open = renderToStaticMarkup(createElement(RunningCard, { title: "대본 작성 중…", text: "만들고 있어요." }));
    expect(open).toContain('role="progressbar"');
    expect(open).toContain('aria-label="대본 작성 중…"');
    expect(open).toContain("data-indeterminate");
    expect(open).not.toMatch(/aria-valuenow|role="status"|aria-live/);
    const known = renderToStaticMarkup(createElement(RunningCard, { title: "프롬프트 생성 중…", text: "받고 있어요.", done: 1, total: 3 }));
    expect(known).toMatch(/aria-valuemin="0"[^>]*aria-valuemax="3"[^>]*aria-valuenow="1"[^>]*aria-valuetext="3개 부분 중 1개 받음"/);
    expect(known).toContain("width:33%");
    expect(text(known)).toContain("3개 부분 중 1개 받음");
    expect(known).not.toContain("data-indeterminate");
    const over = renderToStaticMarkup(createElement(RunningCard, { title: "t", text: "x", done: 5, total: 3 }));
    expect(over).toContain('aria-valuenow="3"');
    expect(over).toContain("width:100%");
  });

  it("쉬는 화면(③⑤⑥ 결과 있음)에는 실행 중 카드도, 흐린 결과(aria-busy)도 없다", () => {
    const ideas = { ...full, selected: null };
    for (const html of [render(ShortsIdeateStep, ideas), render(ShortsScriptStep, full), render(ShortsPromptsStep, full)]) {
      expect(html).not.toContain('role="progressbar"');
      expect(html).not.toContain("aria-busy");
    }
  });

  it("⑤ 목표 초과 어림 경고: 목표보다 15% 넘게 길 때만, 생성 검사 없이 문구와 색만, 장면마다 말하기 어림 초", () => {
    expect(speechOver(19.6, 17)).toBe(true);
    expect(speechOver(19.5, 17)).toBe(false);
    expect(speechOver(17, 17)).toBe(false);
    expect(speechOver(30, 0)).toBe(false);
    const quiet = render(ShortsScriptStep, full);
    expect(quiet).not.toContain("목표보다 길어요");
    const script = full.script!;
    const long = { ...full, script: { ...script, scenes: script.scenes.map(scene => ({ ...scene, narration: "가".repeat(60) })) } };
    const html = render(ShortsScriptStep, long);
    expect(speechSeconds(long.script.scenes.map(scene => scene.narration))).toBe(30);
    expect(text(html)).toContain("나레이션 약 30초 / 목표 17초 — ⚠️ 목표보다 길어요. 문장을 줄여 보세요.");
    expect(text(html).match(/말하기 약 10초/g)).toHaveLength(3);
    // 편집 칸은 그대로(경고가 입력을 막지 않음).
    expect(html.match(/<textarea/g)).toHaveLength(quiet.match(/<textarea/g)!.length);
    expect(html).not.toMatch(/<textarea[^>]*disabled/);
  });

  it("⑥ BGM: 서버가 준 값에만 이름표 칸, 빈 값·없는 BPM은 칸 없음, Suno 복사 단추와 제목 연결", () => {
    const bgm = full.scenePrompts!.bgmPrompt!;
    const html = renderToStaticMarkup(createElement(BgmResult, { bgm, headingId: "bgm-head" }));
    const plain = text(html);
    expect(html).toMatch(/<section[^>]*aria-labelledby="bgm-head"/);
    expect(html).toMatch(/<h4 id="bgm-head"[^>]*>[^<]*<\/h4>/);
    for (const [label, value] of [["🎼 장르·분위기", bgm.genreAndMood], ["🥁 악기", bgm.instrumentation], ["📈 전개", bgm.dynamicStructure], ["💡 믹싱 팁", bgm.audioMixingNotes]])
      expect(plain).toContain(`${label} ${value}`);
    expect(plain).toContain("🎵 Suno prompt");
    expect(plain.match(/Suno 복사/g)).toHaveLength(1);
    if (bgm.recommendedBpmRange) expect(plain).toContain(`추천 ${bgm.recommendedBpmRange.min}–${bgm.recommendedBpmRange.max} BPM`);
    const thin = text(renderToStaticMarkup(createElement(BgmResult, { bgm: { ...bgm, recommendedBpmRange: null, instrumentation: " ", audioMixingNotes: "" }, headingId: "b" })));
    expect(thin).not.toMatch(/추천 \d+–\d+ BPM|🥁 악기|💡 믹싱 팁/);
    expect(thin).toContain("📈 전개");
    expect(text(render(ShortsPromptsStep, full))).toContain("🥁 악기");
  });
});

// P1-08-SHORTS-VAULT-CONTENT-SEARCH-UI(Master msg_c58c6aa38cb8 배정 1): 보관함 내용 검색 요청. 입력 지연·취소·늦은 결과·지운 뒤 초점은 브라우저 확인(인계 문서).
describe("보관함 내용 검색 요청", () => {
  const summary = { id: "00000000-0000-4000-8000-000000000001", title: "전후 비교 프롬프트", ideaTitle: "영상 편집 전후", keyword: "영상 편집",
    sceneCount: 3, hasBgm: true, createdAt: "2026-11-22T00:00:00.000Z" };

  it("검색어: 앞뒤 공백을 빼고 120자까지(잘린 끝 공백도 정리)", () => {
    expect(shortsVaultSearchQueryLimit).toBe(120);
    expect(vaultSearchQuery("  close-up  ")).toBe("close-up");
    expect(vaultSearchQuery("   ")).toBe("");
    expect(vaultSearchQuery("가".repeat(130))).toHaveLength(120);
    expect(vaultSearchQuery(`${"가".repeat(119)} 나`)).toBe("가".repeat(119));
  });

  it("120은 코드 포인트: 이모지(보조 평면)를 반쪽으로 자르지 않는다", () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    const emoji = vaultSearchQuery("😀".repeat(121));
    expect(Array.from(emoji)).toHaveLength(120);
    expect(emoji).toHaveLength(240);
    expect(emoji).not.toMatch(lone);
    const mixed = vaultSearchQuery(`${"가".repeat(119)}😀😀`);
    expect(mixed).toBe(`${"가".repeat(119)}😀`);
    expect(mixed).not.toMatch(lone);
    // 입력 칸: 앞 공백은 두고 나머지 120 코드 포인트까지.
    expect(limitVaultSearchInput(`  ${"😀".repeat(125)}`)).toBe(`  ${"😀".repeat(120)}`);
    expect(vaultSearchQuery(limitVaultSearchInput(`  ${"😀".repeat(125)}`))).toBe("😀".repeat(120));
  });

  it("POST /prompts/search에 {query}만, 받은 요약 봉투({promptSets})를 그대로 돌려준다(다시 거르지 않음)", async () => {
    const fetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ promptSets: [summary] }));
    vi.stubGlobal("fetch", fetch);
    // 요약에는 'close-up'이 없지만 서버가 본문에서 찾았으면 그대로 보인다.
    expect(await searchPromptSets("  close-up ", new AbortController().signal)).toEqual({ kind: "ok", value: [summary] });
    const [path, init] = fetch.mock.calls[0];
    expect(path).toBe("/api/admin/shorts-vault/prompts/search");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ query: "close-up" });
    expect(init).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error" });
  });

  it("검색 응답 구분: 401·403 로그인, 503 연결 전, 400 입력, 봉투가 다르면 형식 오류", async () => {
    const answer = async (response: Response) => { vi.stubGlobal("fetch", vi.fn(async () => response)); return searchPromptSets("훅", new AbortController().signal); };
    expect(await answer(Response.json({}, { status: 401 }))).toEqual({ kind: "denied" });
    expect(await answer(Response.json({}, { status: 403 }))).toEqual({ kind: "denied" });
    expect(vaultClosed(await answer(Response.json({ code: "storage_unavailable" }, { status: 503 })))).toBe(true);
    expect(await answer(Response.json({ code: "invalid_input" }, { status: 400 }))).toEqual({ kind: "failed", code: "invalid_input", status: 400 });
    expect(await answer(Response.json({ results: [summary] }))).toEqual({ kind: "failed", code: "invalid_response", status: 200 });
  });

  it("보관함 첫 그림: 검색 칸은 내용까지 찾는다고 안내하고 120자 제한, 서버를 읽는 동안 불러오는 중", () => {
    const html = render(ShortsVaultStep, emptyShortsSession);
    expect(html).toContain('placeholder="제목·소재·키워드·프롬프트 내용으로 검색"');
    expect(html).not.toContain("maxLength"); // UTF-16 단위 제한은 쓰지 않고 입력 때 코드 포인트로 자른다
    expect(text(html)).toContain("120자까지, 입력을 멈추면 내 보관함 안에서만 찾아요. 검색어는 저장하지 않아요.");
    expect(text(html)).toContain("불러오는 중…");
  });
});

describe("P1-08-SHORTS-RUNTIME-FIXES: 정상 동작 결함 F3~F10", () => {
  const failed = (code: string, status: number) => ({ kind: "failed" as const, code, status });

  it("F3: Gemini 호출 실패(model_error)와 응답 형식 오류를 다르게 알리고, 호출 실패에는 키·모델 확인 링크를 함께 보인다", () => {
    expect(replyMessage(failed("model_error", 502))).toContain("일시 장애이거나 키·권한·사용 한도 문제일 수 있어요");
    expect(replyMessage(failed("model_error", 502))).not.toContain("형식");
    expect(replyMessage(failed("invalid_model_response", 502))).toContain("Gemini 응답이 형식에 맞지 않았어요");
    // 코드를 모르는 502는 형식 오류로 단정하지 않는다.
    expect(replyMessage(failed("something_new", 502))).toBe("Gemini가 요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    expect(failedState(failed("model_error", 502))).toMatchObject({ running: false, notConfigured: false, checkKey: true });
    expect(failedState(failed("not_configured", 503))).toMatchObject({ notConfigured: true, checkKey: false });
    expect(failedState(failed("invalid_model_response", 502))).toMatchObject({ notConfigured: false, checkKey: false });
    const html = (state: Parameters<typeof RunStatus>[0]["state"]) =>
      renderToStaticMarkup(createElement(RunStatus, { state, settingsHref: "/admin#admin-api-integrations", onCancel: () => {} }));
    expect(html(failedState(failed("model_error", 502)))).toContain("Gemini 키·쇼츠 모델 확인하기");
    expect(html(failedState(failed("invalid_model_response", 502)))).not.toContain("Gemini 키·쇼츠 모델 확인하기");
    expect(html(failedState(failed("not_configured", 503)))).toContain("API키등록·플랫폼연동 열기");
  });

  it("F4: 이미 고른 소재는 보존(keep), 다른 소재를 고를 때만 초기화(choose)", () => {
    const [first, second] = full.ideas;
    const session = { ...full, selected: selectionOf(first) };
    expect(ideaAction(session, first)).toBe("keep");
    expect(ideaAction(session, second)).toBe("choose");
    expect(ideaAction({ selected: null }, first)).toBe("choose");
    const page = text(render(ShortsIdeateStep, session));
    expect(page).toContain("고른 소재 · 전략 보기 →");
    expect(page).toContain("이 주제로 기획 확정 →");
  });

  it("F5: 점수·완청 중 없는 값은 빼고, 둘 다 없으면 카드 머리 문구를 그리지 않는다(앞에 남는 구분 기호 없음)", () => {
    const base = { rationale: "근거", kind: "model_estimate" as const };
    expect(estimateText({ ...base, potentialScore: 80, expectedRetentionPercent: 60 }, true)).toBe("잠재점수 80점 · 완청 60% · 모델 추정");
    expect(estimateText({ ...base, potentialScore: null, expectedRetentionPercent: 60 }, true)).toBe("완청 60% · 모델 추정");
    expect(estimateText({ ...base, potentialScore: 80, expectedRetentionPercent: null }, true)).toBe("잠재점수 80점 · 모델 추정");
    expect(estimateText({ ...base, potentialScore: null, expectedRetentionPercent: null }, true)).toBeNull();
    expect(estimateText({ ...base, potentialScore: 80, expectedRetentionPercent: 60 })).toBe("잠재력 80점 · 예상 완청 60% · 모델 추정");
    const ideas = full.ideas.map((idea, index) => ({ ...idea, assessment: idea.assessment && {
      ...idea.assessment,
      potentialScore: index === 0 ? null : idea.assessment.potentialScore,
      expectedRetentionPercent: index <= 1 ? null : idea.assessment.expectedRetentionPercent } }));
    const page = text(render(ShortsIdeateStep, { ...full, ideas }));
    expect(page).not.toMatch(/IDEA #1 · /);
    expect(page).not.toMatch(/IDEA #\d+ · /);
    expect(page).not.toContain(" · · ");
  });

  it("F6: 지금 근거보다 나중에 끝난 묶음 분석이 있으면 ③ 실행·소재 고르기를 막고, 근거 영상은 그대로 적는다", () => {
    const multi = { videoIds: ["A1b2C3d4E5F", "B1b2C3d4E5F"], videos: [], analyzedAt: "2026-11-22T00:00:00.000Z",
      result: { evidence: "youtube_video", videoIds: ["A1b2C3d4E5F", "B1b2C3d4E5F"],
        findings: { summary: "묶음", hook: null, composition: null, sound: null, draftPrompt: null, segments: [] } } };
    const draw = (newerMulti: unknown) => renderToStaticMarkup(createElement(ShortsIdeateStep, { pick: null, onPick: () => {}, goTo: () => {},
      settingsHref: "/admin", work: work(full, { consent: true }), newerMulti: newerMulti as ShortsStepProps["newerMulti"] }));
    const blocked = draw(multi);
    expect(text(blocked)).toContain("방금 영상 2개를 묶음으로 분석했어요");
    expect(text(blocked)).toContain(`그 전에 분석한 영상(${full.context!.videoId})`);
    expect(text(blocked)).toContain(`근거 영상 ${full.context!.videoId}`);
    expect(blocked).toMatch(/disabled="">소재 다시 발굴하기/);
    // 고른 소재가 아닌 카드는 막고, 이미 고른 소재는 ④로 옮기기만 하므로 열어 둔다.
    const choose = full.ideas.filter(idea => ideaAction(full, idea) === "choose").length;
    expect(blocked.match(/disabled="">이 주제로 기획 확정/g)?.length ?? 0).toBe(choose);
    const open = draw(null);
    expect(text(open)).not.toContain("묶음으로 분석했어요");
    expect(open).not.toMatch(/disabled="">소재 다시 발굴하기/);
    expect(open).not.toMatch(/disabled="">이 주제로 기획 확정/);
  });

  it("F8: 프로젝트 제목은 처음 정한 값을 지키고, 다시 열어도 같은 제목이다", () => {
    expect(firstTitle({ ...emptyShortsSession, keyword: "캠핑", context: full.context })).toBe("캠핑");
    expect(firstTitle({ ...full, title: "" })).toBe(full.selected!.title);
    const kept = projectDocument({ ...full, title: "처음 정한 제목" })!;
    expect(kept.title).toBe("처음 정한 제목");
    expect(sessionFromProject(kept).title).toBe("처음 정한 제목");
    expect(projectDocument({ ...full, title: "" })!.title).toBe(full.selected!.title);
  });

  it("F9: 새 분석 뒤에도 대본 설정을 남기고, 화면에서 고친 설정은 계약에 맞을 때만 남긴다", () => {
    const config = { durationSec: 45, tone: SHORTS_TONES[2], target: "자취생" };
    expect(withAnalysis({ ...full, scriptConfig: config }, "C1b2C3d4E5F", analysis(), "캠핑").scriptConfig).toEqual(config);
    expect(draftConfig({ durationSec: 60, tone: `  ${SHORTS_TONES[1]} `, target: "  " })).toEqual({ durationSec: 60, tone: SHORTS_TONES[1] });
    expect(draftConfig({ durationSec: 60, tone: "톤", target: " 2030 " })).toEqual({ durationSec: 60, tone: "톤", target: "2030" });
    for (const bad of [{ durationSec: 9, tone: "톤" }, { durationSec: 30.5, tone: "톤" }, { durationSec: Number.NaN, tone: "톤" }, { durationSec: 30, tone: "  " }])
      expect(draftConfig(bad)).toBeNull();
    // 남긴 설정으로 화면을 다시 그리면 그 값이 보이고, 남긴 설정이 든 문서도 계약을 통과한다.
    const page = render(ShortsScriptStep, { ...full, script: null, scriptConfig: config });
    expect(page).toContain('value="45"');
    expect(page).toContain('value="자취생"');
    expect(shortsVaultProjectDocument.safeParse(projectDocument({ ...full, scriptConfig: draftConfig(config)! })).success).toBe(true);
  });
});

describe("P1-08-SHORTS-RUNTIME-FIXES-F7: 지우기 확인과 열기 경합", () => {
  const a = "10000000-0000-4000-8000-000000000001", b = "10000000-0000-4000-8000-000000000002";
  it("다른 프로젝트·이미 바뀐 프로젝트를 지운 확인은 지금 작업을 건드리지 않는다", () => {
    expect(forgetPlan(b, null, a)).toBe("ignore");
    expect(forgetPlan(null, null, a)).toBe("ignore");
    expect(forgetPlan(b, a, a)).toBe("ignore");
  });
  it("지금 프로젝트를 지웠고 여는 중인 것이 없으면 비운다", () => {
    expect(forgetPlan(a, null, a)).toBe("reset");
  });
  it("지금 프로젝트를 지운 확인이 다른 프로젝트를 여는 중에 오면, 여는 요청을 끊지 않고 미룬다(같은 프로젝트를 다시 여는 중이어도)", () => {
    expect(forgetPlan(a, b, a)).toBe("defer");
    expect(forgetPlan(a, a, a)).toBe("defer");
  });
});

describe("P1-08-SHORTS-SESSION-RESTORE-OWNER: 서버 인증 계정을 끼운 쇼츠 작업실까지 전달", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("관리 허브는 서버가 확인한 email을 ShortsAccount로 프로그램 칸에 넘긴다(다른 속성·파일은 바꾸지 않음)", () => {
    expect(read("components/admin/admin-hub.tsx")).toMatch(/<ShortsAccount account=\{email\}><AdminPremierePrograms \/><\/ShortsAccount>/);
    expect(read("app/admin/page.tsx")).toMatch(/<AdminHub email=\{account\}/);
  });
  it("끼운 쇼츠 작업실은 그 계정을 받고, 계정 문맥은 프로그램 칸 파일 안에서만 쓴다", () => {
    const programs = read("components/admin/admin-premiere-programs.tsx");
    expect(programs).toMatch(/const account = useContext\(ShortsAccountContext\);\s*return <>\s*<ShortsStudio layout="embedded" account=\{account \?\? undefined\} \/>/);
    // 만들기·Provider 여닫기·useContext 한 번씩(다른 곳에서 꺼내 쓰지 않음).
    expect(programs.match(/ShortsAccountContext/g)).toHaveLength(4);
  });
  it("작업실은 계정과 세션 경계 '확인됨'이 모두 있을 때만 탭 저장 주인을 정한다", () => {
    const studio = read("components/admin/shorts-original/shorts-studio.tsx");
    expect(studio).toMatch(/const owner = account && session\?\.view === "current" && !session\.cleared \? account : null;/);
    expect(studio).toMatch(/if \(!owner \|\| tabOwner !== owner\) return;/);
    expect(studio).not.toMatch(/account \?\? null/);
  });
});

describe("P1-08-SHORTS-SESSION-RESTORE-OWNER 배정 3: 계정 전환 첫 커밋·내장 로그아웃", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("확인된 계정이 탭 저장 주인과 다를 때만 앞 계정 화면으로 본다", async () => {
    const { tabOwnerStale } = await import("@/components/admin/shorts-original/shorts-studio");
    expect(tabOwnerStale("b@example.test", "a@example.test")).toBe(true);
    expect(tabOwnerStale("a@example.test", "a@example.test")).toBe(false);
    expect(tabOwnerStale("a@example.test", null)).toBe(false);
    expect(tabOwnerStale(null, "a@example.test")).toBe(false);
    expect(tabOwnerStale(null, null)).toBe(false);
  });
  it("앞 계정 화면이면 그리는 그 순간 작업 본문 대신 안내만 그린다(effect를 기다리지 않음)", () => {
    const studio = read("components/admin/shorts-original/shorts-studio.tsx");
    expect(studio).toMatch(/const stale = tabOwnerStale\(owner, tabOwner\);/);
    expect(studio).toMatch(/const body = stale \? <p role="status" data-owner-sync="">[^<]*<\/p> : <>/);
  });
  it("관리 허브는 세션 경계 바로 안, 보호 본문 밖에 쇼츠 탭 기록 감시 부품을 둔다", () => {
    const page = read("app/admin/page.tsx");
    expect(page).toMatch(/<SessionBoundary account=\{account\}>\s*<ShortsTabGuard \/>\s*<div className=\{styles\.console\}>/);
    expect(page).toMatch(/<ShortsTabGuard \/>\s*<div className=\{styles\.console\}>\s*<AdminHub /);
    expect(read("components/admin/admin-hub.tsx")).toMatch(/<main[^>]*>\s*<h1[^>]*>[^<]+<\/h1>\s*<ProtectedContent>/);
    expect(page.match(/<ShortsTabGuard \/>/g)).toHaveLength(1);
  });
  it("감시 부품은 확정(cleared)일 때만 쇼츠 탭 기록을 지우고, 아무것도 그리지 않는다", async () => {
    const guard = read("components/admin/shorts-original/shorts-tab-guard.tsx");
    expect(guard).toMatch(/const cleared = !!useSessionBoundary\(\)\?\.cleared;/);
    expect(guard).toMatch(/useEffect\(\(\) => \{ if \(cleared\) shortsTabStorage\.clear\(\); \}, \[cleared\]\);/);
    expect(guard).not.toMatch(/fetch\(|setItem|removeItem/);
    const { ShortsTabGuard } = await import("@/components/admin/shorts-original/shorts-tab-guard");
    expect(renderToStaticMarkup(createElement(ShortsTabGuard))).toBe("");
  });
  it("합성 대역의 끼운 모드는 실제 허브처럼 감시 부품과 보호 본문 아래에 작업실을 둔다", () => {
    expect(read("tests/admin/admin-shorts-steps-fixture.tsx"))
      .toMatch(/<><ShortsTabGuard \/><main id="main-content"><ProtectedContent>\s*<ShortsStudio key=\{generation\} layout="embedded"/);
  });
});

describe("P1-08-SHORTS-RUNTIME-2 F2: BGM만 실패한 ⑥ 결과", () => {
  const scenesOnly = { ...full.scenePrompts!, bgmPrompt: null };
  it("BGM 없는 결과는 장면 프롬프트를 그리고 BGM 칸·Suno 복사는 그리지 않는다", () => {
    const plain = text(render(ShortsPromptsStep, { ...full, scenePrompts: scenesOnly }));
    expect(plain).toContain("SCENE 1");
    expect(plain).toContain("이미지 전체 복사");
    expect(plain).not.toContain("🎵 BGM");
    expect(plain).not.toContain("Suno 복사");
    expect(text(render(ShortsPromptsStep, full))).toContain("Suno 복사");
  });
  it("완료 문구는 장면 수와 BGM 실패 이유를 알린다(다시 누르기 안내는 단추 아래 힌트 하나)", () => {
    expect(bgmScenesOnlyText(12, "잠시 뒤 다시 시도해 주세요. ")).toBe("12개 장면 프롬프트를 만들었어요. BGM 프롬프트는 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    expect(bgmScenesOnlyText(3, "")).toBe("3개 장면 프롬프트를 만들었어요. BGM 프롬프트는 만들지 못했어요.");
  });
  it("모델 출력 계약은 그대로 BGM 필수, 결과·보관 문서는 BGM 없음과 예전 기록(BGM 있음)을 모두 받는다", () => {
    const generated = { prompts: full.scenePrompts!.prompts.map(prompt => ({ sceneNumber: prompt.sceneNumber, sceneSummary: prompt.sceneSummary,
      imagePrompt: prompt.imagePrompt, videoPrompt: prompt.videoPrompt })), bgmPrompt: null };
    expect(shortsScenePromptsBatchModelOutput.safeParse(generated).success).toBe(false);
    expect(shortsScenePromptsBatchModelOutput.safeParse({ ...generated, bgmPrompt: full.scenePrompts!.bgmPrompt }).success).toBe(true);
    expect(shortsVaultProjectDocument.safeParse({ ...fixtureProject(), scenePrompts: scenesOnly }).success).toBe(true);
    expect(shortsVaultProjectDocument.safeParse(fixtureProject()).success).toBe(true);
    expect(fixtureProject().scenePrompts?.bgmPrompt).not.toBeNull();
  });
  it("BGM 없는 프롬프트 세트 내려받기 글에는 BGM 절이 없다", () => {
    const document = promptSetDocument({ ...full, scenePrompts: scenesOnly })!;
    expect(document.bgmPrompt).toBeNull();
    expect(promptSetMarkdown(document)).not.toContain("## BGM");
  });
});

describe("P1-08-SHORTS-FULL-FLOW-D1-D4: Tester 결함", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("D1: 원본 셸 ② 빈 화면은 옛 1~6단계·'준비 중' 안내가 없고 중립 안내만, 분석 뒤에는 고르기 안내를 숨긴다", async () => {
    const empty = text(render(ShortsAnalyzeStep, emptyShortsSession));
    expect(empty).not.toContain("준비 중");
    expect(empty).not.toContain("쇼츠 분석 단계");
    expect(empty).toContain("공개 YouTube 쇼츠 주소를 넣거나");
    const done = text(render(ShortsAnalyzeStep, full));
    expect(done).not.toContain("공개 YouTube 쇼츠 주소를 넣거나");
    expect(done).toContain("💡 킬러 소재 발굴로");
    // 고르기 안내는 빨간 오류 상자가 아니라 중립 안내 색이다.
    expect(read("components/admin/shorts-original/shorts-studio.module.css")).toMatch(/\.pickNote \{[^}]*background: #f8fafc;[^}]*color: #334155;/);
    // 기존 단독(옛 관리자) 호출은 단계 표시를 그대로 보인다.
    const { AdminShortsAnalysis } = await import("@/components/admin/admin-shorts-analysis");
    const legacy = text(renderToStaticMarkup(createElement(AdminShortsAnalysis, {})));
    expect(legacy).toContain("3~6단계(소재 발굴부터)는 준비 중이에요.");
    expect(text(renderToStaticMarkup(createElement(AdminShortsAnalysis, { steps: false } as never)))).not.toContain("준비 중");
  });

  it("D2: 소재 발굴은 화면·주석 모두 ③이다(④ 소재 표기 없음)", () => {
    for (const path of ["components/admin/shorts-original/shorts-step-search.tsx", "components/admin/shorts-original/shorts-studio.tsx",
      "components/admin/shorts-source-steps/shorts-source-search.tsx", "components/admin/shorts-source-steps/shorts-source-analyze.tsx",
      "components/admin/shorts-source-steps/source-step-data.ts"]) {
      expect(read(path), path).not.toMatch(/④ ?(소재|연결)/);
    }
  });

  it("D3: ② 화면은 키 거절·한도를 따로 안내하고, Gemini 쪽 실패에는 API연동 링크를 붙인다(앱 로그인 거절과 섞지 않음)", () => {
    const source = read("components/admin/shorts-source-steps/shorts-source-analyze.tsx");
    expect(source).toContain('invalid_key: "Gemini가 키를 받아 주지 않았어요. API연동에서 Gemini 키와 쇼츠 모델을 확인해 주세요."');
    expect(source).toContain('quota_exceeded: "Gemini 사용 한도에 걸렸어요. 잠시 뒤 다시 시도하거나 API연동에서 키의 사용 한도를 확인해 주세요."');
    expect(source).toContain('const settingsCodes = new Set(["invalid_key", "quota_exceeded", "provider_error"]);');
    expect(source.match(/notice\.settings && <> <a className=\{s\.link\} href=\{settingsHref\}>API연동 보기<\/a><\/>/g)).toHaveLength(2);
    // 401·403은 그대로 관리자 로그인·권한 안내다(서버는 키 거절을 422로 내린다).
    expect(source).toContain('if (response.status === 401 || response.status === 403) { setNotice({ tone: "alert", text: denied }); return; }');
  });

  it("D4: 만드는 중에는 떠나면 취소된다고 미리 알리고, 셸은 머무르기·취소하고 이동을 묻는다", () => {
    const running = text(renderToStaticMarkup(createElement(RunStatus, { state: { running: true, message: "", notConfigured: false }, settingsHref: "/s", onCancel: () => {} })));
    expect(running).toContain(runningDefault);
    expect(running).toContain(leaveHint);
    const studio = read("components/admin/shorts-original/shorts-studio.tsx");
    expect(studio).toContain('role="alertdialog"');
    expect(studio).toContain(">머무르기</button>");
    expect(studio).toContain(">취소하고 이동</button>");
    expect(studio).toContain("만들던 결과를 취소하고 옮겼어요. 그 단계로 돌아가 다시 만들 수 있어요.");
    // 메뉴·로고·단계 안 이동은 모두 확인을 거친다. 프로젝트 열기·새 작업은 원래대로 바로 옮긴다.
    expect(studio).toMatch(/<NavBody view=\{view\} onView=\{requestView\}/);
    expect(studio).toContain('<Brand onHome={() => requestView("home")}');
    expect(studio).toContain("pick, goTo: requestView,");
    expect(studio).toContain("else requestView(next); };");
    for (const [path, step] of [["shorts-step-ideate", "ideate"], ["shorts-step-script", "script"], ["shorts-step-prompts", "prompts"]]) {
      expect(read(`components/admin/shorts-original/${path}.tsx`)).toContain(`useRun(work, "${step}")`);
    }
    expect(interruptedText).toBe("다른 단계로 옮겨서 만들던 결과가 취소됐어요. 다시 만들어 주세요.");
  });
});

describe("P1-08-SHORTS-FULL-FLOW-D1-D4 배정 2: Tester D5 보관함 키 모양 거절", () => {
  it("secret_rejected는 '다시 시도'가 아니라 키 모양 글을 고치라고 안내하고, 거절된 글을 되풀이하지 않는다", () => {
    const message = replyMessage({ kind: "failed", code: "secret_rejected", status: 400 });
    expect(message).toBe("API 키처럼 보이는 글이 들어 있어요. 주제·대본·프롬프트에서 키 모양 글을 지우거나 바꿔 주세요.");
    expect(message).not.toMatch(/AIza|sk-|x-goog/);
    expect(message).not.toContain("잠시 뒤 다시 시도");
    // 화면은 앞에 "저장하지 못했어요."·"보관함에 저장하지 못했어요."를 붙이므로 문구 안에서 '저장'을 되풀이하지 않는다.
    expect(message).not.toContain("저장");
  });
});
