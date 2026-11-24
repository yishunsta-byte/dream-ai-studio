import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { analyzeStudioReference } from "../../lib/reference-analysis/studio-analysis-contract";
import { studioAnalysisResultSchema, type StudioAnalysisResult } from "../../lib/reference-analysis/studio-analysis-result-dto";

// 서버 분석 결과 형식과 브라우저 안전 결과 DTO가 같은지 타입 검사로 지킨다.
// (DTO·화면은 서버 계약을 import하지 않으므로, 둘을 잇는 검사는 이 시험에만 둔다.)
type ServerResult = Awaited<ReturnType<typeof analyzeStudioReference>>;

describe("분석 결과 DTO와 서버 결과 형식", () => {
  it("스키마가 서버 결과 형식을 만족한다(기존 satisfies 검사와 같다)", () => {
    expectTypeOf(studioAnalysisResultSchema).toExtend<z.ZodType<ServerResult>>();
  });

  it("DTO 결과 형식과 서버 결과 형식이 양쪽으로 대입 가능하다", () => {
    expectTypeOf<StudioAnalysisResult>().toExtend<ServerResult>();
    expectTypeOf<ServerResult>().toExtend<StudioAnalysisResult>();
  });

  it("DTO·분석 화면·보호 셸은 서버 계약을 import하지 않는다", () => {
    for (const file of [
      "lib/reference-analysis/studio-analysis-result-dto.ts",
      "components/reference-analysis/studio-registered-analysis.tsx",
      "components/reference-analysis/studio-registered-analysis-page.tsx",
      "components/reference-analysis/prompt-comparison.tsx",
    ]) expect(readFileSync(file, "utf8"), file).not.toMatch(/from "[^"]*studio-analysis-contract"/);
  });
});
