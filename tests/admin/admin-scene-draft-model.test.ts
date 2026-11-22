import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { lostSaveOutcome, PROMPT_LIMIT, promptProblem, readSceneDraftState, saveBody, sceneDraftPath } from "@/components/admin/admin-scene-draft-model";
import { SceneDraftProvider } from "@/components/admin/admin-scene-draft-save";
import { AudioReport } from "@/components/admin/admin-music-semantic";

const scene = { projectId: "0190a0b0-0000-7000-8000-000000000001", sceneId: "0190a0b0-0000-7000-8000-000000000011" };
const basis = { planId: "0190a0b0-0000-7000-8000-0000000000a1", contentRevision: 3 };
const state = (version: number, draft: unknown = null) => ({ ...scene, kind: "image", basis, version, draft });
const draft = (version: number, text = "edited", suggested = "suggested", language = "ko") =>
  ({ id: "d", version, text, suggested, language, source: "edited", analysis: { program: "image", proof: "client_supplied" }, savedAt: "2026-11-21T03:00:00.000Z" });
const input = { language: "ko" as const, suggested: "suggested", text: "edited" };

describe("P1-06 관리자 이미지 결과 → 장면 이미지 초안 명시 저장(판단)", () => {
  it("기존 GET 경로를 쓰고, 지금 장면의 이미지 응답만 읽는다", () => {
    expect(sceneDraftPath(scene)).toBe(`/api/projects/${scene.projectId}/scenes/${scene.sceneId}/prompts/image`);
    expect(readSceneDraftState(state(0), scene)).toEqual({ ...scene, basis, version: 0, draft: null });
    expect(readSceneDraftState(state(2, draft(2)), scene)?.draft).toMatchObject({ version: 2, text: "edited", suggested: "suggested", language: "ko", proof: "client_supplied" });
    for (const other of [{ ...state(0), sceneId: "0190a0b0-0000-7000-8000-000000000012" }, { ...state(0), kind: "music" },
      { ...state(0), version: -1 }, { ...state(0), basis: { planId: 1, contentRevision: 3 } }, state(1, { version: 1 }), null, "x"]) {
      expect(readSceneDraftState(other, scene)).toBeUndefined();
    }
  });

  it("PUT 본문은 GET의 버전·기준과 카드의 원문·편집문·언어, 프로그램 image뿐(원본 URL·파일 없음)", () => {
    const body = saveBody({ version: 2, basis }, input);
    expect(body).toEqual({ expectedVersion: 2, expectedBasis: basis, text: "edited", suggested: "suggested", language: "ko", analysis: { program: "image" } });
    expect(Object.keys(body).sort()).toEqual(["analysis", "expectedBasis", "expectedVersion", "language", "suggested", "text"]);
  });

  it("빈 결과·공백·NUL·16,000자 초과는 요청 전에 막는다", () => {
    expect(promptProblem({ suggested: "", text: "a" })).toMatch(/제안 원문이 없어/);
    expect(promptProblem({ suggested: "a", text: "   " })).toMatch(/빈 프롬프트/);
    expect(promptProblem({ suggested: "a", text: "a\0b" })).toMatch(/문자/);
    expect(promptProblem({ suggested: "a", text: "x".repeat(PROMPT_LIMIT) })).toBeUndefined();
    expect(promptProblem({ suggested: "a", text: "x".repeat(PROMPT_LIMIT + 1) })).toMatch(/16,000자를 넘어/);
    expect(promptProblem({ suggested: "x".repeat(PROMPT_LIMIT + 1), text: "a" })).toMatch(/제안 원문이 16,000자/);
  });

  it("응답이 끊긴 저장은 최신 상태로 판정: 바로 다음 버전이 같은 값이면 저장됨, 그대로면 안 됨, 그 밖은 바뀜", () => {
    const sent = { version: 2, basis };
    const latest = (version: number, row: unknown, planBasis = basis) => readSceneDraftState({ ...state(version, row), basis: planBasis }, scene)!;
    expect(lostSaveOutcome(latest(3, draft(3)), sent, input)).toBe("saved");
    expect(lostSaveOutcome(latest(2, draft(2, "older")), sent, input)).toBe("not_saved");
    expect(lostSaveOutcome(latest(3, draft(3, "someone else")), sent, input)).toBe("changed");
    expect(lostSaveOutcome(latest(3, draft(3, "edited", "suggested", "en")), sent, input)).toBe("changed");
    expect(lostSaveOutcome(latest(4, draft(4)), sent, input)).toBe("changed");
    expect(lostSaveOutcome(latest(3, draft(3), { ...basis, contentRevision: 4 }), sent, input)).toBe("changed");
  });

});

describe("P1-07 관리자 음악 Suno 프롬프트 → 장면 음악 초안 명시 저장", () => {
  const music = (version: number, row: unknown = null) => ({ ...scene, kind: "music", basis, version, draft: row });
  const musicDraft = (version: number, text = "edited", suggested = "suggested") =>
    ({ id: "m", version, text, suggested, source: "edited", analysis: { program: "music", proof: "client_supplied" }, savedAt: "2026-11-21T03:00:00.000Z" });
  const suno = { suggested: "suggested", text: "edited" };

  it("기존 prompts/music 경로를 쓰고, 지금 장면의 음악 응답만 읽으며 출처는 client_supplied로 남는다", () => {
    expect(sceneDraftPath(scene, "music")).toBe(`/api/projects/${scene.projectId}/scenes/${scene.sceneId}/prompts/music`);
    expect(readSceneDraftState(music(0), scene, "music")).toEqual({ ...scene, basis, version: 0, draft: null });
    expect(readSceneDraftState(music(1, musicDraft(1)), scene, "music")?.draft).toEqual({ version: 1, text: "edited", suggested: "suggested",
      savedAt: "2026-11-21T03:00:00.000Z", proof: "client_supplied" });
    expect(readSceneDraftState(state(0), scene, "music")).toBeUndefined();
    expect(readSceneDraftState(music(0), scene)).toBeUndefined();
  });

  it("PUT 본문은 버전·기준과 Suno 제안 원문·편집문, 프로그램 music뿐이고 language는 보내지 않는다", () => {
    const body = saveBody({ version: 4, basis }, { ...suno, language: "ko" }, "music");
    expect(body).toEqual({ expectedVersion: 4, expectedBasis: basis, text: "edited", suggested: "suggested", analysis: { program: "music" } });
    expect(Object.keys(body).sort()).toEqual(["analysis", "expectedBasis", "expectedVersion", "suggested", "text"]);
    const sent = { version: 4, basis };
    expect(lostSaveOutcome(readSceneDraftState(music(5, musicDraft(5)), scene, "music")!, sent, suno)).toBe("saved");
    expect(lostSaveOutcome(readSceneDraftState(music(4, musicDraft(4, "older")), scene, "music")!, sent, suno)).toBe("not_saved");
  });

  it("장면 문맥이 있을 때 음악 보고서(음악·자동 음악)에만 저장 버튼이 있고, 음성·판별 불가에는 없다", () => {
    const studio = { ...scene, position: 1, title: "첫 장면" };
    const report = { genre: "앰비언트", instruments: null, tempoBpm: null, structure: null, sunoPrompt: "Ambient piano, 96 BPM" };
    const inScene = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(SceneDraftProvider, { scene: studio, kind: "music", children: node }));
    const autoMusic = inScene(createElement(AudioReport, { result: { schemaVersion: 1, requestedMode: "auto", kind: "music", status: "ready", provider: "gemini", report } }));
    expect(autoMusic).toContain("자동 판별 결과 · 음악");
    expect(autoMusic.match(/장면 1 초안에 저장/g)).toHaveLength(1);
    expect(autoMusic).toContain("작업실 장면 1 · 첫 장면의 음악 초안으로 Suno 프롬프트 제안 원문과 지금 편집문을 저장해요.");
    expect(autoMusic).not.toMatch(/이미지 초안|한국어·영어/);
    expect(autoMusic).toMatch(/<button[^>]*disabled=""[^>]*>장면 1 초안에 저장/);
    const speech = inScene(createElement(AudioReport, { result: { schemaVersion: 1, requestedMode: "speech", kind: "speech", status: "ready", provider: "gemini",
      report: { summary: "요약", topicsAndKeywords: null, actionItems: null, fullTranscription: null } } }));
    expect(speech).not.toContain("초안에 저장");
    const undetermined = inScene(createElement(AudioReport, { result: { schemaVersion: 1, requestedMode: "auto", kind: "undetermined", status: "unavailable", reason: "undetermined" } }));
    expect(undetermined).not.toContain("초안에 저장");
    const noSuno = inScene(createElement(AudioReport, { result: { schemaVersion: 1, requestedMode: "music", kind: "music", status: "partial", provider: "gemini", report: { ...report, sunoPrompt: null } } }));
    expect(noSuno).not.toContain("초안에 저장");
    // 장면 문맥이 없으면(작업실에서 열지 않음) 버튼 없음.
    expect(renderToStaticMarkup(createElement(AudioReport, { result: { schemaVersion: 1, requestedMode: "music", kind: "music", status: "ready", provider: "gemini", report } })))
      .not.toContain("초안에 저장");
  });
});
