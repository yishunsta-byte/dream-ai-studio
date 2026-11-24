import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectLocalRender } from "@/components/cloud/project-local-render";

// 로컬 PG 렌더 요청(8117f19)·수동 실행(d67a9d3)·현재 버전 MP4 받기 화면.
const id = "01900000-0000-7000-8000-000000000001";
const source = readFileSync("components/cloud/project-local-render.tsx", "utf8");
const page = readFileSync("app/(cloud)/cloud/projects/[id]/render/page.tsx", "utf8");
const detail = readFileSync("app/(cloud)/cloud/projects/[id]/page.tsx", "utf8");

describe("로컬 렌더 화면: 처음 그림", () => {
  it("지원 범위를 밝히고 상태를 불러오는 중으로 시작한다", () => {
    const html = renderToStaticMarkup(createElement(ProjectLocalRender, { projectId: id, produceApproved: true, reviewApproved: true }));
    expect(html).toContain("영상 만들기</h2>");
    expect(html).toContain("PNG 장면 1~2개 · 컷 전환 · 첨부한 WAV 음원 1~2개 · 승인된 한글 자막과 필수 표기");
    expect(source).toContain('RENDER_CANCELED: "영상 만들기가 중간에 멈췄어요.');
    expect(html).toContain('role="status"');
    expect(html).toContain('tabindex="-1"');
  });
});

describe("로컬 렌더 화면: 요청·실행·받기 규칙", () => {
  it("요청은 현재 내용 리비전·타임라인과 UUIDv7 키로 보내고, 불명확하면 같은 키·본문으로만 다시 확인한다", () => {
    expect(source).toMatch(/key: v7\(\), body: \{ revision: state\.contentRevision, timelineId: state\.timelineId \}/);
    expect(source).toContain('"Idempotency-Key": attempt.key');
    expect(source).toMatch(/catch \{[\s\S]{0,120}setPending\(attempt\);/);
    expect(source).toContain('{pending ? "같은 요청 다시 확인" : "이 버전으로 영상 요청"}');
  });
  it("이전 버전(stale)은 받기 링크 없이 구분하고, 현재 버전 완료만 MP4 링크를 준다", () => {
    expect(source).toContain("const current = state?.requests.find(item => !item.stale);");
    expect(source).toContain("이전 버전이라 받을 수 없어요");
    expect(source).toMatch(/current\.status === "succeeded" \? <>[\s\S]*?<a href=\{href\(current\.jobId\)\} download>현재 버전 MP4 받기<\/a>/);
    expect(source).toContain("`${endpoint}/${encodeURIComponent(jobId)}/execute`");
  });
  it("실행은 대기·실패·실행 중 상태에 따라 이름이 바뀌고, 실패 사유를 우리말로 안내한다", () => {
    expect(source).toContain('current.status === "queued" ? "영상 만들기 실행" : current.status === "running" ? "이어서 실행" : "다시 실행"');
    for (const code of ["REVIEW_APPROVAL_REQUIRED", "RENDER_RUNNING", "RENDER_RETRY_UNAVAILABLE", "RENDER_SOURCE_UNAVAILABLE", "RENDER_INPUT_UNSUPPORTED", "RENDER_EXECUTION_FAILED"])
      expect(source).toMatch(new RegExp(`${code}: "[^"]+요[.]`));
  });
  it("동작 중 버튼이 꺼져도 초점은 영역 → 결과 문구로 옮긴다", () => {
    expect(source).toMatch(/busyNow\.current = true;\s*root\.current\?\.focus\(\);/);
    expect(source).toContain("(outcomeRef.current ?? root.current)?.focus()");
    expect(source).toMatch(/<p ref=\{outcomeRef\} tabIndex=\{-1\} role=\{outcome\.tone\}>/);
  });
});

describe("로컬 렌더 화면: 검수에서 도착", () => {
  it("#local-render-heading으로 들어오고 초점이 BODY일 때만 도착 제목에 초점을 둔다", () => {
    const html = renderToStaticMarkup(createElement(ProjectLocalRender, { projectId: id, produceApproved: true, reviewApproved: true }));
    expect(html).toMatch(/<h2 id="local-render-heading" tabindex="-1">영상 만들기<\/h2>/);
    expect(source).toMatch(/if \(window\.location\.hash !== "#local-render-heading"\) return;[\s\S]{0,120}if \(active && active !== document\.body\) return;[\s\S]{0,40}getElementById\("local-render-heading"\)\?\.focus\(\);/);
  });
});

describe("로컬 렌더 화면: 실행 실패 안내(편집 담당 공유 코드)", () => {
  it("필수 표기 누락은 자막 편집·검수로 가는 수정·재승인 경로를 준다", () => {
    expect(source).toContain('RENDER_REQUIRED_DISCLOSURE_MISSING: "필수 표기가 영상에 들어가지 않아 만들 수 없어요.');
    expect(source).toContain('body?.code === "RENDER_REQUIRED_DISCLOSURE_MISSING" && { fix: "disclosure" as const }');
    expect(source).toContain("/subtitles`}>자막 편집으로 이동</Link>");
    expect(source).toContain("/review`}>검수로 이동</Link>");
  });
  it("결과 문구는 실행·요청 버튼 바로 앞이라 Tab 한 번으로 다시 실행이나 안내 링크에 닿는다", () => {
    const note = source.indexOf("        {outcomeNode}");
    expect(note).toBeGreaterThan(0);
    expect(source.indexOf('{current ? <div className="stack" aria-label="현재 버전 영상">')).toBeGreaterThan(note);
  });
  it("글꼴·실행 도구 오류는 운영 점검을 안내한다", () => {
    for (const code of ["RENDER_FONT_MISSING", "RENDER_BROWSER_UNAVAILABLE"]) {
      const line = source.split(String.fromCharCode(10)).find(text => text.trim().startsWith(`${code}: "`));
      expect(line).toContain("운영 담당자에게 실행 환경 점검을 요청해 주세요.");
    }
  });
});

describe("로컬 렌더 화면: 경로", () => {
  it("편집 음원 페이지와 같은 기능·인증 조건을 쓰고 제작·검수 승인을 넘긴다", () => {
    expect(page).toContain("if (!localProjectFormEnabled()) notFound();");
    expect(page).toContain('if (result.data.menuId !== "shopping-shorts") notFound();');
    expect(page).toContain('produceApproved={approved("produce")} reviewApproved={approved("review")}');
  });
  it("프로젝트 상세에서 편집 음원 다음에 '영상 만들기'로 이어진다", () => {
    const audio = detail.indexOf("/editing-audio`}>편집 음원 선택</Link>");
    const render = detail.indexOf("/render`}>영상 만들기</Link>");
    expect(audio).toBeGreaterThan(0);
    expect(render).toBeGreaterThan(audio);
  });
});
