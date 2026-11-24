import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { actorFromVerifiedUserId } from "../../lib/db/postgres/types";
import { createPrivateReferencePreviewRecord, previewReferenceProject } from "../../lib/reference-analysis/project-preview";
import { PROJECT_PREVIEW_SAMPLE, PROJECT_PREVIEW_SELECTABLE } from "@/components/reference-analysis/project-preview-sample";
import { ReferenceAnalysisLab } from "@/components/reference-analysis/reference-analysis-lab";
import { luminanceSummary, projectCopyText, togglePick } from "@/components/reference-analysis/lab-model";
import { clock, marker, owner, scope, syntheticAnalyses, type Analysis } from "./studio-project-preview-fixture";

vi.mock("server-only", () => ({}));

// T272: Studio 합성 체험의 프로젝트 미리보기 표본은 화면에 고정된 값이다. 이 시험은 같은 합성 입력을 실제 서버 전용
// 미리보기 계약(createPrivateReferencePreviewRecord → previewReferenceProject)에 시험 액터로 넣고, 그 허용 출력이
// 표본과 정확히 같은지 대조한다. 화면·브라우저는 소유자·리비전을 만들거나 검증하지 않는다.
const run = (analysis: Analysis, ids: readonly string[]) =>
  previewReferenceProject(createPrivateReferencePreviewRecord(owner, scope, 1_000, analysis), owner, clock, ids);

describe("T272 합성 프로젝트 미리보기 표본 = 서버 전용 계약의 허용 출력", () => {
  for (const media of ["video", "music", "image"] as const) {
    it(`${media}: 선택 가능한 근거 전체를 고른 계약 출력이 표본과 같다`, () => {
      const output = run(syntheticAnalyses()[media], PROJECT_PREVIEW_SELECTABLE[media]);
      expect(output.status).toBe("ready");
      if (output.status !== "ready") return;
      expect(output.proposals).toEqual(PROJECT_PREVIEW_SAMPLE[media]);
    });
  }

  it("영상 컷은 확인된 sourceSeek.ptsMs(340ms 관찰 프레임)와 편집 격자 근사(30fps 10번)를 따로 가진다", () => {
    const cut = PROJECT_PREVIEW_SAMPLE.video.find((item) => item.selectionId === "video-cut-1");
    expect(cut).toMatchObject({
      sourceSeek: { kind: "observed_pts", ptsMs: 340, findingId: "video-frame-3" },
      inference: { kind: "inference", measure: "candidate_cut", evidenceIds: ["video-difference-1", "video-frame-3"] },
      draft: { kind: "creative_proposal", target: "cut", editGridApproximation: { fps: 30, frame: 10 }, transition: { type: "cut", durationFrames: 0 } },
    });
  });

  it("표본에는 비공개 식별자·원문·파일명·픽셀·클립 위치가 없다", () => {
    const text = JSON.stringify(PROJECT_PREVIEW_SAMPLE);
    expect(text).not.toMatch(new RegExp(`${marker}|synthetic-project|synthetic-source|synthetic-rev|synthetic-analysis|${owner.id}|pixels|ownerId|assetId|startFrame|trimIn|gainDb|referenceFrame|\\.mp4|\\.wav|\\.png`));
  });

  it("다른 액터·바뀐 리비전·만료는 표본 없이 상태만 돌려준다(화면이 대신하지 않는 서버 판정)", () => {
    const record = createPrivateReferencePreviewRecord(owner, scope, 1_000, syntheticAnalyses().video);
    const other = actorFromVerifiedUserId("20000000-0000-4000-8000-000000000273");
    expect(previewReferenceProject(record, other, clock, ["video-cut-1"])).toEqual({ schemaVersion: 1, status: "owner_required" });
    expect(previewReferenceProject(record, owner, { ...clock, scope: { ...scope, sourceRevision: "next" } }, ["video-cut-1"]).status).toBe("stale");
    expect(previewReferenceProject(record, owner, { ...clock, nowMs: 2_000 }, ["video-cut-1"]).status).toBe("stale");
    expect(previewReferenceProject(record, owner, clock, []).status).toBe("selection_unavailable");
  });
});

describe("T272 화면 경계", () => {
  const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");
  it("표본 파일은 서버 전용 모듈을 런타임에 가져오지 않는다(타입만)", () => {
    const source = read("components/reference-analysis/project-preview-sample.ts");
    for (const match of source.matchAll(/^import\s+(type\s+)?[^;]*from\s+"([^"]+)"/gm)) {
      if (match[2].includes("project-preview")) expect(match[1], match[0]).toBe("type ");
    }
    expect(source).not.toMatch(/server-only|actorFromVerifiedUserId|createPrivateReferencePreviewRecord|previewReferenceProject\(/);
  });
  it("화면은 미리보기 판정을 다시 하지 않고, 요청·전송·저장 코드를 두지 않는다", () => {
    const lab = read("components/reference-analysis/reference-analysis-lab.tsx");
    expect(lab).not.toMatch(/fetch\(|FormData|sendBeacon|localStorage|ownerId|sourceRevision|analysisRevision|"use server"/);
  });
  it("첫 화면에는 아직 프로젝트 미리보기 탭이 없다(완료된 합성 작업에만 속함)", () => {
    const html = renderToStaticMarkup(createElement(ReferenceAnalysisLab, { projectPreview: PROJECT_PREVIEW_SAMPLE }));
    expect(html).not.toContain("프로젝트 미리보기");
  });
});

describe("T272 고른 순서와 복사 문구", () => {
  it("화면이 고른 순서대로 표본을 보여 주는 것은 서버 계약이 같은 순서 요청에 내는 응답과 같다", () => {
    const orders = [["video-cut-1", "video-frame-1"], ["video-frame-3", "video-cut-1", "video-frame-2"], ["image-region-1", "image-region-0"]];
    for (const ids of orders) {
      const media = ids[0].startsWith("image") ? "image" : "video";
      const output = run(syntheticAnalyses()[media], ids);
      if (output.status !== "ready") throw new Error("expected ready");
      const byId = new Map(PROJECT_PREVIEW_SAMPLE[media].map((item) => [item.selectionId, item]));
      expect(output.proposals).toEqual(ids.map((key) => byId.get(key)));
    }
  });
  it("근거 선택은 누른 순서를 지키고 다시 누르면 빠진다", () => {
    let picked: string[] = [];
    for (const key of ["video-cut-1", "video-frame-1", "video-cut-1", "video-frame-2"]) picked = togglePick(picked, key);
    expect(picked).toEqual(["video-frame-1", "video-frame-2"]);
  });
  it("복사 문구는 고른 순서의 제안 문장만(수치·근거 번호·원본 위치·초 표기 없음)", () => {
    const text = projectCopyText(PROJECT_PREVIEW_SAMPLE.video, ["video-cut-1", "video-frame-1"]);
    expect(text.split("\n")).toEqual([PROJECT_PREVIEW_SAMPLE.video[3].draft.prompt, PROJECT_PREVIEW_SAMPLE.video[0].draft.prompt]);
    expect(text).not.toMatch(/video-|0\.68|340|초|fps/);
    expect(projectCopyText(PROJECT_PREVIEW_SAMPLE.video, [])).toBe("");
  });
});

describe("T272-F1 이미지 명도 근거", () => {
  it("표본의 명도 구간·비중으로 대표 구간을 표시하고, 계약 제안의 명도 방향과 같은 구간이다", () => {
    const [whole, center] = PROJECT_PREVIEW_SAMPLE.image;
    const observed = (item: typeof whole) => { const o = item.observations[0]; if (o.measure !== "region_color_luminance") throw new Error("expected region"); return o; };
    expect(luminanceSummary(observed(whole).luminanceShares, observed(whole).luminanceEdges)).toEqual({
      dominant: "명도 0.75–1.00 구간 90%", all: "0.00–0.25 0% · 0.25–0.50 0% · 0.50–0.75 10% · 0.75–1.00 90%",
    });
    expect(luminanceSummary(observed(center).luminanceShares, observed(center).luminanceEdges).dominant).toBe("명도 0.75–1.00 구간 100%");
    for (const item of [whole, center]) expect(item.draft.prompt).toContain("밝은 명도");
  });
  it("복사 문구에는 명도 수치·구간이 들어가지 않는다(제안 문장만)", () => {
    const text = projectCopyText(PROJECT_PREVIEW_SAMPLE.image, ["image-region-1", "image-region-0"]);
    expect(text).not.toMatch(/0\.75|90%|비중|구간/);
  });
});
