import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectLocalSubtitles } from "@/components/cloud/project-local-subtitles";

// 로컬 PG 자막 편집 화면(a4554d4 명세, 0dbc51d API).
const id = "01900000-0000-7000-8000-000000000001";
const source = readFileSync("components/cloud/project-local-subtitles.tsx", "utf8");
const page = readFileSync("app/(cloud)/cloud/projects/[id]/subtitles/page.tsx", "utf8");
const detail = readFileSync("app/(cloud)/cloud/projects/[id]/page.tsx", "utf8");

describe("자막 편집: 처음 그림과 안내", () => {
  it("저장된 자막을 불러오는 중으로 시작하고 영역이 초점을 받을 수 있다", () => {
    const html = renderToStaticMarkup(createElement(ProjectLocalSubtitles, { projectId: id }));
    expect(html).toContain("자막 편집</h2>");
    expect(html).toContain('role="status"');
    expect(html).toContain('tabindex="-1"');
  });
  it("영상 길이와 입력 가능한 끝 프레임을 다른 이름으로, 보호 레이어와 MP4 제약을 저장 전에 안내한다", () => {
    expect(source).toContain("영상 길이 {server.videoFrames}프레임");
    expect(source).toContain("입력 가능한 끝 프레임 {server.maxEndFrame}");
    expect(source).toContain("필수 표기와 잠긴 글자 레이어는 보호돼요.");
    expect(source).toContain("검수를 승인한 버전의 자막은 영상 만들기에서 MP4에 함께 들어가요.");
    expect(source).not.toContain("MP4로 만들 수 없어요");
    expect(source).toContain("필수 표기가 필요한 작품은 표기가 영상 전체 구간에 있어야 만들 수 있어요.");
  });
  it("차단 사유마다 돌아갈 화면을 안내한다", () => {
    for (const code of ["PRODUCE_APPROVAL_REQUIRED", "BASE_TIMELINE_REQUIRED", "INVALID_BASE_TIMELINE", "BASE_TIMELINE_STALE"]) {
      const line = source.split(/\r?\n/).find(text => text.trim().startsWith(`${code}: { text: "`));
      expect(line).toContain("href: id => `/cloud/projects/${id}");
    }
  });
});

describe("자막 편집: 입력 검사", () => {
  it("공백 문구·500자·시작 0 이상·끝>시작·끝 상한·100개를 검사하고 문제 입력에 초점을 둔다", () => {
    expect(source).toContain("공백만으로는 저장할 수 없어요.");
    expect(source).toContain("const MAX_LENGTH = 500;");
    expect(source).toContain("const MAX_SUBTITLES = 100;");
    expect(source).toContain("시작 프레임은 0 이상의 정수로 입력해 주세요.");
    expect(source).toContain("끝 프레임은 시작 프레임보다 커야 해요.");
    expect(source).toMatch(/if \(issue\) \{\s*setProblem\(issue\);\s*setSelected\(issue\.id\);\s*setFocusField/);
    expect(source).toContain('aria-describedby={describe("end") ?? "subtitle-end-limit"}');
  });
  it("행을 고르면 바로 문구 입력으로 초점이 간다", () => {
    expect(source).toMatch(/setSelected\(row\.id\);\s*setFocusField\(prev => \(\{ id: row\.id, field: "content"/);
  });
  it("다른 탭 변경 뒤 받기 409 CURRENT_TIMELINE_CONFLICT면 옛 버전 받기 버튼을 거두고 다시 불러오기·재승인을 안내한다", () => {
    expect(source).toContain('body?.code === "REVIEW_APPROVAL_REQUIRED" || body?.code === "CURRENT_TIMELINE_CONFLICT") setApprovalLost(true);');
    expect(source).toContain("CURRENT_TIMELINE_CONFLICT: \"그 사이 다른 곳에서 자막이 바뀌어 이 승인본은 받을 수 없어요.");
    const after = source.indexOf("downloadOutcome && (!reviewApproved || approvalLost");
    expect(source.indexOf(">저장된 자막 다시 불러오기")).toBeGreaterThan(after);
  });
  it("편집 입력 순서는 추가 → 삭제 → 문구 → 시작 → 끝 → 저장이라 끝 다음 Tab이 바로 저장이다", () => {
    const order = [">자막 추가</button>", "이 자막 삭제", 'id="subtitle-content"', 'id="subtitle-start"', 'id="subtitle-end"', '<Button type="button" loading={saving}'].map(text => source.indexOf(text));
    expect(order.every(at => at > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    const between = source.slice(order[4], order[5]);
    expect(between).not.toMatch(/<button|<Button|<a |<Link|<input|<textarea/);
  });
  it("상한을 넘는 기존 범위는 손대지 않으면 그대로 둘 수 있다", () => {
    expect(source).toContain("if (end > server.maxEndFrame && !same(row, saved.get(row.id)))");
  });
});

describe("자막 편집: 저장과 복구", () => {
  it("삭제하지 않은 편집 가능 자막 전체를 기준 두 값·UUIDv7 키와 보낸다", () => {
    expect(source).toMatch(/key: v7\(\), body: \{ expectedContentRevision: server\.contentRevision, expectedTimelineId: server\.timelineId,\s*subtitles: rows\.filter\(row => !row\.deleted\)/);
    expect(source).toContain('"Idempotency-Key": attempt.key');
  });
  it("응답이 끊기면 같은 키·본문으로만 다시 확인한다", () => {
    expect(source).toMatch(/catch \{[\s\S]{0,80}setRetry\(attempt\);/);
    expect(source).toContain('retry ? "같은 저장 요청 다시 확인"');
  });
  it("먼저 저장된 경우 최신본을 기준으로 바꾸되 초안은 덮어쓰지 않고, 최신본에만 있는 자막은 보이게 남긴다", () => {
    expect(source).toMatch(/\["CURRENT_TIMELINE_CONFLICT", "BASE_TIMELINE_STALE", "REQUEST_CONFLICT"\]\.includes\(result\.code\)\) \{\s*await showLatest\(\);/);
    expect(source).toMatch(/setRows\(current => \{[\s\S]*?\.\.\.marked, \.\.\.latest\.subtitles\.filter\(item => !known\.has\(item\.id\)\)/);
    expect(source).toContain("내 초안은 그대로 두었어요.");
  });
  it("changed에 따라 재검수 안내 또는 '저장된 자막과 같아요'를 보인다", () => {
    expect(source).toContain("자막을 저장했어요. 현재 내용의 편집 완료와 검수를 다시 진행해 주세요.");
    expect(source).toContain("저장된 자막과 같아요.");
  });
  it("결과 문구는 저장 버튼 바로 앞이라 Tab 한 번으로 재시도에 닿는다", () => {
    expect(source).toMatch(/\{outcomeNode\}\s*<Button type="button" loading=\{saving\}/);
    expect(source).toMatch(/savingNow\.current = true;\s*root\.current\?\.focus\(\);/);
  });
});

describe("자막 편집: 승인 자막 받기(808fc01)", () => {
  it("승인 전이면 받기 버튼 없이 검수로 안내한다", () => {
    expect(source).toContain("검수를 승인한 버전의 자막만 받을 수 있어요.");
    expect(page).toContain('reviewApproved={result.data.stages.some(stage => stage.stage === "review" && stage.status === "approved")}');
  });
  it("현재 내용 리비전·타임라인 ID를 그대로 붙여 SRT/VTT를 요청하고, 성공을 확인한 뒤에만 파일로 받는다", () => {
    expect(source).toContain("new URLSearchParams({ format, revision: String(server.contentRevision), timelineId: server.timelineId })");
    expect(source).toContain("fetch(`${endpoint}/download?${query}`");
    expect(source).toMatch(/if \(response\.ok\) \{[\s\S]*?URL\.createObjectURL\(await response\.blob\(\)\)/);
    expect(source).toContain(">SRT 받기</Button>");
    expect(source).toContain(">VTT 받기</Button>");
  });
  it("빈 자막과 승인 무효화를 안내하고, 저장으로 바뀌면 받기를 막는다", () => {
    expect(source).toContain("승인된 버전에 자막이 없어요.");
    expect(source).toContain("if (result.changed) setApprovalLost(true);");
    expect(source).toContain('if (body?.code === "REVIEW_APPROVAL_REQUIRED" ||');
    for (const code of ["REVIEW_APPROVAL_REQUIRED", "CURRENT_TIMELINE_CONFLICT", "BASE_TIMELINE_STALE", "SUBTITLES_EMPTY"]) expect(source).toContain(`  ${code}: "`);
  });
  it("받기 결과 문구에 초점을 두고 버튼 바로 앞에 둔다", () => {
    expect(source).toContain("if (downloadTick) downloadRef.current?.focus();");
    const note = source.indexOf("{downloadOutcome && <p ref={downloadRef} tabIndex={-1}");
    expect(note).toBeGreaterThan(0);
    expect(source.indexOf(">SRT 받기</Button>")).toBeGreaterThan(note);
  });
});

describe("자막 편집: 경로", () => {
  it("다른 로컬 화면과 같은 기능·인증 조건을 쓴다", () => {
    expect(page).toContain("if (!localProjectFormEnabled()) notFound();");
    expect(page).toContain('if (result.data.menuId !== "shopping-shorts") notFound();');
  });
  it("상세에서 편집 음원 → 자막 편집 → 영상 만들기 순으로 이어진다", () => {
    const audio = detail.indexOf("/editing-audio`}>편집 음원 선택</Link>");
    const subtitles = detail.indexOf("/subtitles`}>자막 편집</Link>");
    const render = detail.indexOf("/render`}>영상 만들기</Link>");
    expect(audio).toBeGreaterThan(0);
    expect(subtitles).toBeGreaterThan(audio);
    expect(render).toBeGreaterThan(subtitles);
  });
});
