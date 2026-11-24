import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectLocalEditingZip } from "@/components/cloud/project-local-editing-zip";

// 로컬 PG 재편집 ZIP 만들기·목록·받기 화면(편집 담당 계약, 서버 미포함).
const id = "01900000-0000-7000-8000-000000000001";
const source = readFileSync("components/cloud/project-local-editing-zip.tsx", "utf8");
const page = readFileSync("app/(cloud)/cloud/projects/[id]/editing-zip/page.tsx", "utf8");
const detail = readFileSync("app/(cloud)/cloud/projects/[id]/page.tsx", "utf8");

describe("재편집 ZIP 화면: 처음 그림과 경로", () => {
  it("묶는 내용을 밝히고 상태를 불러오는 중으로 시작한다", () => {
    const html = renderToStaticMarkup(createElement(ProjectLocalEditingZip, { projectId: id }));
    expect(html).toContain("재편집 ZIP</h2>");
    expect(html).toContain("장면 PNG·WAV 원본·타임라인·자막(SRT/VTT)·권리 기록");
    expect(html).toContain('role="status"');
    expect(html).toContain('tabindex="-1"');
  });
  it("페이지는 로컬 기능·쇼핑숏츠 조건을 쓰고, 상세에서 영상 만들기 다음에 링크한다", () => {
    expect(page).toContain("if (!localProjectFormEnabled()) notFound();");
    expect(page).toContain('if (result.data.menuId !== "shopping-shorts") notFound();');
    expect(detail.indexOf("/editing-zip`}>재편집 ZIP</Link>")).toBeGreaterThan(detail.indexOf("/render`}>영상 만들기</Link>"));
  });
});

describe("재편집 ZIP 화면: 계약", () => {
  it("현재 내용 리비전·타임라인 ID와 UUIDv7 키로 만들고, 불명확하면 같은 키·본문으로 다시 확인한다", () => {
    expect(source).toContain("const endpoint = `/api/projects/${encodeURIComponent(projectId)}/exports`;");
    expect(source).toContain("{ key: v7(), body: { revision: state.contentRevision, timelineId: state.timelineId } }");
    expect(source).toContain('"Idempotency-Key": attempt.key');
    expect(source).toContain("const attempt = pending ?? (");
    expect(source).toContain("setPending(attempt);");
    expect(source).toContain("(response.status === 201 || response.status === 200) && body?.result?.status === \"succeeded\"");
  });
  it("409·404 코드를 우리말로 안내한다", () => {
    for (const code of ["CURRENT_TIMELINE_CONFLICT", "EXPORT_REVIEW_REQUIRED", "EXPORT_IN_PROGRESS", "REQUEST_CONFLICT", "PROJECT_MISSING", "EXPORT_MISSING"]) {
      expect(source).toContain(`  ${code}: "`);
    }
  });
  it("받기는 현재 승인본 행만, 성공을 확인한 뒤에만 파일로 저장하고 실패면 최신 상태로 바꾼다", () => {
    expect(source).toContain('row.status === "succeeded" && row.contentRevision === state.contentRevision && row.timelineId === state.timelineId');
    expect(source).toContain("const response = await fetch(row.downloadHref, { cache: \"no-store\" });");
    expect(source.indexOf("if (response.ok) {")).toBeLessThan(source.indexOf("URL.createObjectURL"));
    expect(source).toContain("이전 버전이라 받을 수 없어요");
    const failed = source.slice(source.indexOf("} else {", source.indexOf("URL.createObjectURL")), source.indexOf("ZIP 파일을 받지 못했어요"));
    expect(failed).toContain("await load();");
  });
  it("e30db53의 409·503 코드도 우리말로 안내하고, 503은 같은 키·본문 다시 확인으로 이어진다", () => {
    for (const code of ["EXPORT_TIMELINE_INVALID", "EXPORT_ASSET_UNAVAILABLE", "EXPORT_ASSET_CHANGED", "EXPORT_SNAPSHOT_CHANGED", "EXPORT_CLAIM_LOST", "EXPORT_UNAVAILABLE", "EXPORT_READ_UNAVAILABLE", "EXPORT_FONT_UNAVAILABLE", "EXPORT_INPUT_INVALID", "EXPORT_CANCELED"]) {
      expect(source).toContain(`  ${code}: "`);
    }
    const retry = source.slice(source.indexOf("response.status >= 500) {"), source.indexOf("setPending(undefined);"));
    expect(retry).toContain("setPending(attempt);");
    expect(retry).toContain("같은 요청으로 다시 확인해 주세요.");
  });
  it("409 뒤에는 상태를 다시 읽을 때까지 다시 불러오기만 제공한다", () => {
    expect(source).toContain("if (response.status === 409) setLoadFailed(true);");
    const fallback = source.slice(source.indexOf("{loadFailed ? <>"), source.indexOf(": !state ? <p"));
    expect(fallback).toContain("마지막 확인 버전");
    expect(fallback.indexOf("{reloadButton}")).toBeGreaterThan(fallback.indexOf("{outcomeNode"));
    expect(fallback).not.toMatch(/<Button|<Link/);
    expect(source.indexOf("setLoadFailed(false);")).toBeGreaterThan(source.indexOf("setState({ contentRevision:"));
    expect(source).toContain('const after = (fresh: boolean) => fresh ? "최신 상태를 다시 불러왔어요." : reloadHint;');
    expect(source.match(/다시 불러왔어요/g)).toHaveLength(1);
    expect(source).toContain("const reloadHint = \"최신 상태를 불러오지 못했어요. '상태 다시 불러오기'를 눌러 주세요.\";");
  });
  it("미승인·빈 타임라인 안내에 다음 화면 링크를 준다", () => {
    expect(source).toContain("{messages.EXPORT_REVIEW_REQUIRED} <Link href={`/cloud/projects/${projectId}/review`}>검수로 이동</Link>");
    expect(source).toContain("첫 타임라인을 먼저 저장해 주세요.");
  });
  it("결과 문구는 만들기·받기 버튼 바로 앞에 있고 초점을 받는다", () => {
    const note = source.indexOf("        {outcomeNode}");
    expect(note).toBeGreaterThan(0);
    expect(source.indexOf('aria-label="현재 버전 ZIP"')).toBeGreaterThan(note);
    expect(source).toContain("if (focusTick) (outcomeRef.current ?? root.current)?.focus();");
  });
});
