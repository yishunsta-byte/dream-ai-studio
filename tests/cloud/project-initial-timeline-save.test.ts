import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { ProjectInitialTimelineSave } from "@/components/cloud/project-initial-timeline-save";

// 첫 타임라인 저장 화면(42314b4 API, FIRST-WORK-PG-INITIAL-TIMELINE).
const id = "01900000-0000-7000-8000-000000000001";
const render = (props: { basis?: { contentRevision: number; timelineId: string | null }; produceApproved: boolean }) =>
  renderToStaticMarkup(createElement(ProjectInitialTimelineSave, { projectId: id, ...props }));
const source = readFileSync("components/cloud/project-initial-timeline-save.tsx", "utf8");
const page = readFileSync("app/(cloud)/cloud/projects/[id]/editing-audio/page.tsx", "utf8");

describe("첫 타임라인 저장: 사전 조건 안내", () => {
  it("승인되고 기준이 없으면 저장 버튼이 켜진다", () => {
    const html = render({ basis: { contentRevision: 7, timelineId: null }, produceApproved: true });
    expect(html).toContain("첫 타임라인 저장</h2>");
    expect(html).toMatch(/<button[^>]*>첫 타임라인 저장<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>첫 타임라인 저장/);
    expect(html).not.toContain("승인해 주세요");
  });
  it("제작 승인 전에는 안내와 함께 버튼이 꺼진다", () => {
    const html = render({ basis: { contentRevision: 7, timelineId: null }, produceApproved: false });
    expect(html).toContain("장면 제작을 먼저 승인해 주세요.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>첫 타임라인 저장/);
  });
  it("이미 기준 타임라인이 있으면 저장 버튼 없이 안내만 한다", () => {
    const html = render({ basis: { contentRevision: 8, timelineId: "01900000-0000-7000-8000-0000000000aa" }, produceApproved: true });
    expect(html).toContain("기준 타임라인이 이미 저장돼 있어요.");
    expect(html).not.toContain("<button");
  });
  it("저장 기준을 못 읽으면 버튼 없이 안내한다", () => {
    const html = render({ produceApproved: true });
    expect(html).toContain("저장 기준을 불러오지 못했어요.");
    expect(html).not.toContain("<button");
  });
});

describe("첫 타임라인 저장: 요청과 복구 규칙", () => {
  it("initial 경로에 UUIDv7 키와 null 기준으로 보낸다", () => {
    expect(source).toContain("/timeline/initial`");
    expect(source).toContain('"Idempotency-Key": attempt.key');
    expect(source).toMatch(/key: v7\(\), body: \{ expectedContentRevision: basis\.contentRevision, expectedTimelineId: null \}/);
  });
  it("결과가 불명확하면 같은 키·본문을 보관해 다시 확인하고, 충돌이면 최신 기준을 읽는다", () => {
    expect(source).toMatch(/catch \{\s*setRetry\(attempt\);/);
    expect(source).toMatch(/CURRENT_TIMELINE_CONFLICT" \|\| result\.code === "REQUEST_CONFLICT"\) \{[\s\S]*?setConflictBasis[\s\S]*?refreshBasis\(\);/);
    expect(source).toMatch(/SCENE_RESULTS_REQUIRED: "모든 장면에 검토를 마친/);
  });
  it("저장 중 버튼이 꺼져도 초점이 사라지지 않게 영역과 결과 문구로 옮긴다", () => {
    expect(source).toMatch(/savingNow\.current = true;\s*root\.current\?\.focus\(\);/);
    expect(source).toMatch(/<p ref=\{outcomeRef\} tabIndex=\{-1\} role=\{outcome\.tone\}>/);
  });
  it("편집 음원 페이지에서 배경 음악 저장 위에 같은 기준 값으로 놓인다", () => {
    const at = page.indexOf("<ProjectInitialTimelineSave");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(page.indexOf("<ProjectAudioTimelineSave"));
    expect(page.match(/basis=\{result\.data\.editBasis\}/g)).toHaveLength(2);
  });
});
