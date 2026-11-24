import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  checkLocalInput, copyOutcome, currentInput, initialLabState, isBusy, labReducer, promptText, SAMPLES, TONES, type LabState,
} from "@/components/reference-analysis/lab-model";
import { PROJECT_PREVIEW_SAMPLE } from "@/components/reference-analysis/project-preview-sample";
import { ReferenceAnalysisLab } from "@/components/reference-analysis/reference-analysis-lab";
import { isAnonymousPublicPath, isPublicPath } from "@/lib/auth/config";

// T-266 REA 2 Studio 합성 체험 화면. 기대값 근거: T265 명세(docs/handoffs/T265-REA-RESULT-UX.md),
// T265-R 수정 요구(이전 결과 소속·늦은 결과 차단·복사 대기 중 초안 변경·대체 입력 키보드 순서), Master msg_ddeaf40b77cc.
const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const start = (state: LabState = initialLabState) => labReducer(state, { type: "startSample", sample: "video", scenario: "complete" });

describe("T-266 작업 상태 규칙", () => {
  it("작업 이벤트는 그 작업 번호에만 적용되고 정해진 순서만 따른다", () => {
    let s = start();
    expect(s.job).toMatchObject({ id: 1, phase: "queued" });
    expect(isBusy(s)).toBe(true);
    s = labReducer(s, { type: "jobEvent", jobId: 1, phase: "complete" }); // queued → complete 건너뛰기 불가
    expect(s.job?.phase).toBe("queued");
    s = labReducer(s, { type: "jobEvent", jobId: 1, phase: "running" });
    s = labReducer(s, { type: "jobEvent", jobId: 1, phase: "complete" });
    expect(s.job?.phase).toBe("complete");
    s = labReducer(s, { type: "jobEvent", jobId: 1, phase: "failed" }); // 종료 뒤 이벤트 무시
    expect(s.job?.phase).toBe("complete");
  });

  it("취소 요청 뒤에는 종료 확인만 받고, 늦게 온 완료·이전 작업 이벤트는 현재 화면에 적용하지 않는다", () => {
    let s = start();
    s = labReducer(s, { type: "jobEvent", jobId: 1, phase: "running" });
    s = labReducer(s, { type: "jobEvent", jobId: 1, phase: "cancelRequested" });
    s = labReducer(s, { type: "jobEvent", jobId: 1, phase: "complete" }); // 늦은 결과
    expect(s.job?.phase).toBe("cancelRequested");
    expect(isBusy(s)).toBe(true);
    s = labReducer(s, { type: "jobEvent", jobId: 1, phase: "canceled" });
    expect(s.job?.phase).toBe("canceled");
    s = start(s); // 다시 시작 → 작업 #2
    expect(s.job).toMatchObject({ id: 2, phase: "queued" });
    s = labReducer(s, { type: "jobEvent", jobId: 1, phase: "running" }); // 이전 작업의 늦은 이벤트
    expect(s.job).toMatchObject({ id: 2, phase: "queued" });
  });

  it("진행 중에는 입력 방식 변경·새 시작·입력 확인을 받지 않는다", () => {
    const s = start();
    expect(labReducer(s, { type: "source", source: "url" })).toBe(s);
    expect(labReducer(s, { type: "startSample", sample: "music", scenario: "empty" })).toBe(s);
    expect(labReducer(s, { type: "inputChecked", notice: checkLocalInput({ kind: "url", url: "x" }) })).toBe(s);
  });

  it("완료 뒤 새 입력을 확인하면 이전 결과를 닫고 그 사실을 표시한다(새 입력의 결과로 읽히지 않음)", () => {
    let s = start();
    s = labReducer(s, { type: "jobEvent", jobId: 1, phase: "running" });
    s = labReducer(s, { type: "jobEvent", jobId: 1, phase: "complete" });
    s = labReducer(s, { type: "source", source: "url" });
    s = labReducer(s, { type: "inputChecked", notice: checkLocalInput({ kind: "url", url: "https://example.com/watch" }) });
    expect(s.job).toBeNull();
    expect(s.closedPrevious).toBe(true);
    s = labReducer(s, { type: "jobEvent", jobId: 1, phase: "complete" });
    expect(s.job).toBeNull();
  });
});

describe("T266-F1 파일 선택·권한은 지금 입력 칸에만 속한다", () => {
  const png = { name: "a.png", size: 10, type: "image/png" };
  const pickAndAuthorize = () => {
    let s = labReducer(initialLabState, { type: "source", source: "file" });
    s = labReducer(s, { type: "pickFile", file: png });
    return labReducer(s, { type: "authorize", authorized: true });
  };
  it("파일 → URL → 파일, 파일 → 본문 → 파일이면 빈 선택으로 거절하고 다시 고르면 정상 확인", () => {
    for (const away of ["url", "body", "sample"] as const) {
      let s = pickAndAuthorize();
      expect(checkLocalInput(currentInput(s, "", "")!).alternatives).toEqual(["sample"]);
      s = labReducer(s, { type: "source", source: away });
      s = labReducer(s, { type: "source", source: "file" });
      expect(s.file).toBeNull();
      expect(s.authorized).toBe(false);
      s = labReducer(s, { type: "authorize", authorized: true });
      const refused = checkLocalInput(currentInput(s, "", "")!);
      expect(refused).toMatchObject({ tone: "error", invalidField: true, text: "확인할 자료를 입력하거나 선택해 주세요." });
      s = labReducer(s, { type: "pickFile", file: png });
      expect(checkLocalInput(currentInput(s, "", "")!)).toMatchObject({ tone: "info", alternatives: ["sample"] });
    }
  });
  it("같은 방식을 다시 눌러도 선택은 유지되고, 파일 칸 밖에서 온 선택은 받지 않는다", () => {
    const s = pickAndAuthorize();
    const same = labReducer(s, { type: "source", source: "file" });
    expect(same.file).toEqual(png);
    expect(same.authorized).toBe(true);
    expect(labReducer(initialLabState, { type: "pickFile", file: png }).file).toBeNull();
  });
  it("본문 권한 체크는 파일로 넘어가지 않는다", () => {
    let s = labReducer(initialLabState, { type: "source", source: "body" });
    s = labReducer(s, { type: "authorize", authorized: true });
    s = labReducer(s, { type: "source", source: "file" });
    expect(s.authorized).toBe(false);
  });
});

describe("T-266 입력 확인(T263 계약 classifyReferenceInput, 전송 없음)", () => {
  it("잘못된 주소는 필드 오류, 정상·프로필 주소는 본문·파일 대체 안내", () => {
    const bad = checkLocalInput({ kind: "url", url: "ftp://example.com/a" });
    expect(bad).toMatchObject({ tone: "error", invalidField: true, alternatives: [] });
    const normal = checkLocalInput({ kind: "url", url: "https://example.com/video/1" });
    expect(normal).toMatchObject({ tone: "info", invalidField: false, alternatives: ["body", "file"] });
    const profile = checkLocalInput({ kind: "url", url: "https://www.youtube.com/@someone" });
    expect(profile.text).toContain("채널·프로필");
    expect(profile.alternatives).toEqual(["body", "file"]);
  });

  it("본문·파일은 권한 확인 전엔 대체 안내, 권한이 있으면 형식만 확인하고 합성 표본으로 안내한다", () => {
    expect(checkLocalInput({ kind: "body", text: "합성 문구", authorized: false }).alternatives).toEqual(["body", "file"]);
    expect(checkLocalInput({ kind: "body", text: "합성 문구", authorized: true })).toMatchObject({ alternatives: ["sample"], invalidField: false });
    expect(checkLocalInput({ kind: "body", text: "   ", authorized: true })).toMatchObject({ tone: "error", invalidField: true });
    expect(checkLocalInput({ kind: "file", file: null, authorized: true })).toMatchObject({ tone: "error", invalidField: true });
    expect(checkLocalInput({ kind: "file", file: { name: "a.png", size: 10, type: "image/png" }, authorized: true }).alternatives).toEqual(["sample"]);
    expect(checkLocalInput({ kind: "file", file: { name: "a.gif", size: 10, type: "image/gif" }, authorized: true }).text).toContain("지원하지 않는");
    expect(checkLocalInput({ kind: "file", file: { name: "a.png", size: 10, type: "video/mp4" }, authorized: true }).text).toContain("맞지 않아요");
    expect(checkLocalInput({ kind: "file", file: { name: "a.png", size: 65 * 1024 * 1024, type: "image/png" }, authorized: true }).text).toContain("64MB");
  });

  it("안내 문구에 입력 원문(주소·본문·파일명)을 넣지 않는다", () => {
    const secret = "PRIVATE-MARKER-266";
    const notices = [
      checkLocalInput({ kind: "url", url: `https://example.com/${secret}` }),
      checkLocalInput({ kind: "body", text: secret, authorized: true }),
      checkLocalInput({ kind: "file", file: { name: `${secret}.png`, size: 10, type: "image/png" }, authorized: true }),
    ];
    for (const notice of notices) expect(notice.text).not.toContain(secret);
  });
});

describe("T-266 복사 귀속(T266-F1)", () => {
  const ticket = { id: 3, text: promptText("video", "clear"), draftVersion: 5, jobId: 2 };
  const now = { ticketId: 3, draftVersion: 5, jobId: 2 as number | null, onSameTab: true, focusUnchanged: true };
  it("누른 그대로면 성공 알림, 거절이면 표시 문구 선택", () => {
    expect(copyOutcome(ticket, now, true)).toBe("copied");
    expect(copyOutcome(ticket, now, false)).toBe("denied");
  });
  it("같은 작업에서 초안이 바뀌었거나 탭을 벗어나면 알림만(초점·선택 없음)", () => {
    expect(copyOutcome(ticket, { ...now, draftVersion: 6 }, false)).toBe("staleFailed");
    expect(copyOutcome(ticket, { ...now, draftVersion: 6 }, true)).toBe("staleCopied");
    expect(copyOutcome(ticket, { ...now, onSameTab: false }, false)).toBe("staleFailed");
  });
  it("T272-F1: 누른 그대로여도 기다리는 사이 초점을 옮겼으면 거절은 알림만(deniedAway), 성공은 그대로", () => {
    expect(copyOutcome(ticket, { ...now, focusUnchanged: false }, false)).toBe("deniedAway");
    expect(copyOutcome(ticket, { ...now, focusUnchanged: false }, true)).toBe("copied");
    expect(copyOutcome(ticket, { ...now, focusUnchanged: false, jobId: 3 }, false)).toBe("ignore");
    expect(copyOutcome(ticket, { ...now, focusUnchanged: false, draftVersion: 6 }, false)).toBe("staleFailed");
  });
  it("작업이 바뀌었거나 결과가 닫혔거나 더 새 요청이 있으면 늦은 성공·실패 모두 무시", () => {
    for (const ok of [true, false]) {
      expect(copyOutcome(ticket, { ...now, jobId: 3 }, ok)).toBe("ignore"); // 새 작업 결과
      expect(copyOutcome(ticket, { ...now, jobId: null }, ok)).toBe("ignore"); // 결과 닫힘
      expect(copyOutcome(ticket, { ...now, ticketId: 0 }, ok)).toBe("ignore"); // 새 작업 시작 때 요청 무효화
      expect(copyOutcome(ticket, { ...now, ticketId: 4 }, ok)).toBe("ignore"); // 더 새 요청
      expect(copyOutcome(ticket, { ...now, jobId: 3, draftVersion: 9, onSameTab: false }, ok)).toBe("ignore");
    }
  });
  it("복사 문구는 표본 제안과 표현 방향 문장만이다", () => {
    for (const sample of ["video", "music", "image"] as const) for (const tone of ["clear", "soft", "active"] as const) {
      expect(promptText(sample, tone)).toBe(`${SAMPLES[sample].note} ${TONES[tone].line}`);
    }
  });
});

describe("T-266 화면·경로", () => {
  it("첫 화면: 합성 체험 표시, 입력 방식 4개, 상태 안내 하나, 결과 없음", () => {
    const html = renderToStaticMarkup(createElement(ReferenceAnalysisLab, { projectPreview: PROJECT_PREVIEW_SAMPLE }));
    expect(html).toContain("합성 체험");
    expect(html).toContain("실제 자료를 보내거나 분석하지 않아요");
    expect(html.match(/aria-pressed="(true|false)"/g)).toHaveLength(4);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain("시작 전");
    expect(html).toContain("아직 결과가 없어요");
    expect(html).not.toContain('role="tablist"');
  });

  it("화면 코드는 전송·파일 읽기·서버 전용 모듈을 쓰지 않는다", () => {
    for (const path of ["components/reference-analysis/reference-analysis-lab.tsx", "components/reference-analysis/lab-model.ts", "components/reference-analysis/project-preview-panel.tsx"]) {
      const source = read(path);
      expect(source, path).not.toMatch(/fetch\(|FormData|FileReader|arrayBuffer\(|\.text\(\)|XMLHttpRequest|sendBeacon|localStorage|server-only|local-file|projection/);
      for (const match of source.matchAll(/from\s+"([^"]+)"/g)) expect(match[1], path).toMatch(/^(react|\.\/lab-model|\.\/project-preview-sample|\.\/project-preview-panel|\.\/reference-analysis-lab\.module\.css|@\/lib\/reference-analysis\/input)$/);
    }
  });

  it("새 경로는 Studio 보호 경로이고 화면보다 먼저 legacyPageGate를 부르며, 작업실에 진입 링크가 하나 있다", () => {
    expect(isAnonymousPublicPath("/studio/reference-analysis")).toBe(false);
    expect(isPublicPath("/studio/reference-analysis")).toBe(false);
    const page = read("app/(studio)/studio/reference-analysis/page.tsx");
    expect(page).toContain("const blocked=await legacyPageGate();if(blocked)return blocked;");
    expect(page.indexOf("await legacyPageGate()")).toBeLessThan(page.indexOf("<ReferenceAnalysisLab"));
    const studio = read("app/(studio)/studio/page.tsx");
    expect(studio.match(/href="\/studio\/reference-analysis"/g)).toHaveLength(1);
  });
});
