import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { RegisteredAnalysisResults, StudioRegisteredAnalysis } from "../../components/reference-analysis/studio-registered-analysis";
import { analyzeStudioReference } from "../../lib/reference-analysis/studio-analysis-contract";

vi.mock("server-only", () => ({}));

const selection = { projectId: "10000000-0000-4000-8000-000000000010", assetId: "10000000-0000-7000-8000-000000000011" };
const userId = "10000000-0000-4000-8000-000000000012";

describe("Studio registered analysis UI", () => {
  it("blocks launch with no provider, no materials or no selection", () => {
    const analyze = vi.fn();
    const disconnected = renderToStaticMarkup(createElement(StudioRegisteredAnalysis));
    const empty = renderToStaticMarkup(createElement(StudioRegisteredAnalysis, { provider: { analyze, materials: [] } }));
    const connected = renderToStaticMarkup(createElement(StudioRegisteredAnalysis, {
      provider: { analyze, materials: [{ ...selection, label: "등록 이미지" }] },
    }));
    expect(disconnected).toContain("등록 자료 분석 공급자가 아직 연결되지 않았어요.");
    expect(empty).toContain("분석할 수 있는 등록 자료가 없어요.");
    expect(connected).toContain("등록 이미지");
    for (const markup of [disconnected, empty, connected]) {
      expect(markup).toMatch(/<button[^>]+disabled=""[^>]*>분석 실행/);
      expect(markup).not.toContain(selection.assetId);
      expect(markup).not.toContain("<textarea");
    }
    expect(analyze).not.toHaveBeenCalled();
  });

  it("renders the actual T284 synthetic PNG result without source metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "t291-ui-"));
    try {
      const managedRoot = await realpath(directory);
      const name = "synthetic-private.png";
      const path = join(managedRoot, name);
      const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0000" } }).png().toBuffer();
      await writeFile(path, bytes);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const result = await analyzeStudioReference(selection, {
        resolveAuth: async () => ({ kind: "verified", userId, email: "owner@example.invalid" }),
        resolveRegisteredSource: async () => ({
          status: "authorized", ownerId: userId, ...selection, sha256, path, managedRoot, name,
          mime: "image/png", sizeBytes: bytes.length, storeId: "private-store", restoreGeneration: "restore-1",
          linkGeneration: "link-1", sourceGeneration: "source-1", ownerPermissionGeneration: "owner-1", scopePermissionGeneration: "scope-1",
        }),
      });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error(`T284 fixture unavailable: ${result.reason}`);
      const markup = renderToStaticMarkup(createElement(RegisteredAnalysisResults, { result }));
      expect(markup).toContain("이미지 분석");
      expect(markup).toContain("관찰 근거");
      expect(markup).toContain("불투명도 반영 면적 100%");
      expect(markup).toContain("이 결과에 포함된 추정이 없어요.");
      expect(markup).toContain("창작 초안");
      expect(markup).toContain("분석으로 생성한 초안");
      expect(markup).toContain("내 수정본");
      expect(markup).toContain("분석 초안과 같아요.");
      expect(markup).toContain(result.proposals[0].draft.prompt);
      for (const secret of [path, name, userId, selection.projectId, selection.assetId, sha256]) expect(markup).not.toContain(secret);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
