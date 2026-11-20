import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ANALYSIS_URI, PUBLICATIONS_URI, analysisInputIssue, createAdminReferenceAnalysisClient, draftFromResult, failureMessage, validateDraft,
  type AdminTransport, type AnalysisMedia, type AnalysisSource, type ReadyResult,
} from "@/components/admin/admin-reference-analysis-model";
import { AdminReferenceAnalysis } from "@/components/admin/admin-reference-analysis";
import { SpectrumResults } from "@/components/admin/admin-reference-analysis-spectrum";
import { PublishedAnalysisResults } from "@/components/reference-analysis/published-analysis-results";

// 관리자 콘텐츠 분석·공개 화면 계약(합성 응답만). 서버 저장·권한 판정은 서버 시험 범위다.
const time = (startMs: number, endMs = startMs) => ({ kind: "time" as const, startMs, endMs });
export const READY: Record<"image" | "music" | "video", ReadyResult> = {
  image: { schemaVersion: 1, status: "ready", media: "image", proposals: [{ media: "image", selectionId: "image-1",
    observations: [{ kind: "observation", findingId: "region-1", measure: "region_color_luminance", location: { kind: "region", x: 0, y: 0, width: 1, height: 1 },
      alphaCoverage: 1, palette: [{ bucket: "#3366cc", visibleShare: 0.6 }], luminanceShares: [0.25, 0.25, 0.25, 0.25], luminanceEdges: [0, 0.25, 0.5, 0.75, 1] }],
    draft: { kind: "creative_proposal", target: "image", prompt: "푸른 색이 넓게 퍼진 장면" } }] },
  music: { schemaVersion: 1, status: "ready", media: "music", proposals: [{ media: "music", selectionId: "music-1",
    observations: [{ kind: "observation", findingId: "onsets-1", measure: "energy_onsets", location: time(0, 4000), timesMs: [0, 500, 1000, 1500, 2000], medianIntervalMs: 500 }],
    inference: { kind: "inference", findingId: "bpm-1", measure: "estimated_bpm", location: time(0, 4000), bpm: 120, evidenceIds: ["onsets-1"] },
    draft: { kind: "creative_proposal", target: "music", role: "music", prompt: "120 BPM의 경쾌한 배경 음악" } }] },
  video: { schemaVersion: 1, status: "ready", media: "video", proposals: [
    { media: "video", selectionId: "video-1", observations: [{ kind: "observation", findingId: "frame-1", measure: "decoded_frame", location: time(125) }],
      sourceSeek: { kind: "observed_pts", findingId: "frame-1", ptsMs: 125 },
      inference: { kind: "inference", findingId: "cut-1", measure: "candidate_cut", location: time(125), evidenceIds: ["frame-1"] },
      draft: { kind: "creative_proposal", target: "cut", prompt: "125ms에서 장면을 바꾸는 컷" } },
    { media: "video", selectionId: "video-2", observations: [{ kind: "observation", findingId: "frame-2", measure: "decoded_frame", location: time(500) }],
      sourceSeek: { kind: "observed_pts", findingId: "frame-2", ptsMs: 500 },
      draft: { kind: "creative_proposal", target: "cut", prompt: "두 번째 컷" } }] },
};
const ID = "10000000-0000-4000-8000-000000000001";
const item = (over: Record<string, unknown> = {}) => ({ id: ID, title: "음악 분석 결과", summary: "요약", prompt: "프롬프트", media: "music",
  status: "published", publishedAt: "2026-11-20T03:00:00.000Z", ...over });

type Sent = { uri: string; method: string; body: unknown };
function transportOf(...replies: Array<{ status: number; body?: unknown } | "throw">) {
  const sent: Sent[] = [];
  const transport: AdminTransport = async (uri, init) => {
    sent.push({ uri, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : undefined });
    const reply = replies.shift() ?? "throw";
    if (reply === "throw") throw new TypeError("network");
    return { status: reply.status, json: async () => { if (reply.body === undefined) throw new SyntaxError("empty"); return reply.body; } };
  };
  return { transport, sent };
}

describe("분석 요청", () => {
  const urlSource = (url: string, media: AnalysisMedia = "image"): AnalysisSource => ({ kind: "url", url, media });

  it.each(["image", "music", "video"] as const)("%s 결과를 받고 URL과 권리 확인을 함께 보낸다", async (media) => {
    const { transport, sent } = transportOf({ status: 200, body: { result: READY[media] } });
    const url = `https://mdn.github.io/a.${{ image: "jpg", music: "mp3", video: "mp4" }[media]}`;
    expect(await createAdminReferenceAnalysisClient(transport).analyze(urlSource(url, media))).toEqual({ kind: "ready", result: READY[media] });
    expect(sent).toEqual([{ uri: ANALYSIS_URI, method: "POST", body: { url, authorized: true, media } }]);
  });

  it("파일 원본과 인코딩한 이름·선택한 매체를 그대로 전송한다", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "작은 사진.jpg", { type: "image/jpeg" });
    const signal = new AbortController().signal;
    const transport: AdminTransport = async (uri, init) => {
      expect(uri).toBe(ANALYSIS_URI);
      expect(init).toEqual({ method: "POST", signal, body: file,
        headers: { "content-type": "application/octet-stream", "x-dream-media": "image", "x-dream-filename": encodeURIComponent(file.name) } });
      expect(init.body).toBe(file);
      return Response.json({ result: READY.image });
    };
    expect(await createAdminReferenceAnalysisClient(transport).analyze({ kind: "file", file, media: "image" }, signal))
      .toEqual({ kind: "ready", result: READY.image });
  });

  it("직접 URL과 매체별 확장자를 구분하고 파일 한도를 4 MiB까지 허용한다", () => {
    const limit = 4 * 1024 * 1024;
    const valid = new File([new Uint8Array(limit)], "photo.JPG");
    const oversized = new File([new Uint8Array(limit + 1)], "photo.jpg");
    expect(analysisInputIssue({ kind: "file", file: valid, media: "image" })).toBeUndefined();
    expect(analysisInputIssue({ kind: "file", file: oversized, media: "image" })).toContain("4 MiB");
    expect(analysisInputIssue({ kind: "file", file: new File([], "photo.jpg"), media: "image" })).toContain("내용이 있는");
    expect(analysisInputIssue(urlSource("https://www.threads.com/@demo/post/a"))).toContain("직접 HTTPS");
    expect(analysisInputIssue(urlSource("https://mdn.github.io/a.jpg?token=secret"))).toContain("쿼리");
    expect(analysisInputIssue(urlSource("https://mdn.github.io/a.mp4"))).toContain("‘영상’");
  });

  it("서버 판정을 화면 분류로 옮기고 서버 문장은 쓰지 않는다", async () => {
    const client = (status: number, body?: unknown) => createAdminReferenceAnalysisClient(transportOf({ status, body }).transport);
    expect(await client(401).analyze(urlSource("https://x"))).toEqual({ kind: "login" });
    expect(await client(403).analyze(urlSource("https://x"))).toEqual({ kind: "forbidden" });
    expect(await client(422, { error: "unsupported_origin", message: "<b>내부</b>" }).analyze(urlSource("https://x"))).toEqual({ kind: "rejected", code: "unsupported_origin" });
    expect(await client(400, { error: "모르는 코드" }).analyze(urlSource("https://x"))).toEqual({ kind: "failed" });
    // 서버(admin-reference-http) 상태·코드 짝: 413 too_large, 429 analysis_busy, 400 invalid_input
    expect(await client(413, { error: "too_large" }).analyze(urlSource("https://x"))).toEqual({ kind: "rejected", code: "too_large" });
    expect(await client(429, { error: "analysis_busy" }).analyze(urlSource("https://x"))).toEqual({ kind: "rejected", code: "analysis_busy" });
    expect(await client(400, { error: "invalid_input" }).analyze(urlSource("https://x"))).toEqual({ kind: "rejected", code: "invalid_input" });
    expect(await client(400, { error: "invalid_file" }).analyze(urlSource("https://x"))).toEqual({ kind: "rejected", code: "invalid_file" });
    expect(await client(422, { error: "file_type_mismatch" }).analyze(urlSource("https://x"))).toEqual({ kind: "rejected", code: "file_type_mismatch" });
    expect(await client(500, { error: "analysis_failed" }).analyze(urlSource("https://x"))).toEqual({ kind: "failed" });
    expect(await client(200, { result: { schemaVersion: 1, status: "unavailable", reason: "timed_out" } }).analyze(urlSource("https://x"))).toEqual({ kind: "unavailable", reason: "timed_out" });
    // 여분 필드·형식이 다른 결과는 받지 않는다(strict).
    expect(await client(200, { result: { ...READY.image, sourceUrl: "https://secret" } }).analyze(urlSource("https://x"))).toEqual({ kind: "failed" });
    expect(await client(200, { result: READY.music }).analyze(urlSource("https://x"))).toEqual({ kind: "failed" });
    expect(await createAdminReferenceAnalysisClient(transportOf("throw").transport).analyze(urlSource("https://x"))).toEqual({ kind: "failed" });
    expect(failureMessage({ kind: "rejected", code: "unsupported_origin" })).toBe("지원하는 공개 원본의 주소만 분석할 수 있어요.");
  });

  it("취소된 요청은 늦게 성공해도 실패로 닫는다", async () => {
    const controller = new AbortController();
    const transport: AdminTransport = async () => ({ status: 200, json: async () => { controller.abort(); return { result: READY.image }; } });
    expect(await createAdminReferenceAnalysisClient(transport).analyze(urlSource("https://x"), controller.signal)).toEqual({ kind: "failed" });
  });
});

describe("공개·철회", () => {
  it("공개는 요청 id·다듬은 승인 필드·권리 확인만 보내고, 같은 id의 공개 결과만 받는다", async () => {
    const { transport, sent } = transportOf({ status: 200, body: { item: item() } }, { status: 200, body: { item: item({ id: "10000000-0000-4000-8000-000000000002" }) } });
    const client = createAdminReferenceAnalysisClient(transport);
    const draft = { title: " 음악 분석 결과 ", summary: "요약\n", prompt: "프롬프트", media: "music" as const };
    expect(await client.publish(ID, draft)).toEqual({ kind: "ok", item: item() });
    expect(sent[0]).toEqual({ uri: PUBLICATIONS_URI, method: "POST",
      body: { id: ID, title: "음악 분석 결과", summary: "요약", prompt: "프롬프트", media: "music", authorized: true } });
    expect(await client.publish(ID, draft)).toEqual({ kind: "failed" });
    // 같은 id에 다른 내용이면 서버가 409 publication_conflict로 확정한다. 미확정(failed)이 아니라 거절로 분류해 새 요청을 요구한다.
    const conflict = createAdminReferenceAnalysisClient(transportOf({ status: 409, body: { error: "publication_conflict" } }).transport);
    expect(await conflict.publish(ID, draft)).toEqual({ kind: "rejected", code: "publication_conflict" });
    expect(failureMessage({ kind: "rejected", code: "publication_conflict" })).toContain("공개 목록을 확인한 뒤 다시 동의하고 공개해 주세요");
    // 목록 다시 읽기의 성공 여부를 모르는 시점의 문구라, 이미 불러왔다고 단정하지 않는다(목록 결과는 목록 영역이 따로 알린다).
    for (const code of ["publication_conflict", "not_found", "already_revoked"] as const) expect(failureMessage({ kind: "rejected", code })).not.toContain("불러왔");
  });

  it("목록은 형식이 맞을 때만 받고, 철회는 id만 보낸다", async () => {
    const { transport, sent } = transportOf(
      { status: 200, body: { items: [item(), item({ id: "10000000-0000-4000-8000-000000000003", status: "revoked", media: "video" })] } },
      { status: 200, body: { items: [{ ...item(), ownerId: ID }] } },
      { status: 200, body: { ok: true } }, { status: 404, body: { error: "not_found" } }, { status: 403 });
    const client = createAdminReferenceAnalysisClient(transport);
    expect((await client.list()).kind).toBe("ok");
    expect(await client.list()).toEqual({ kind: "failed" });
    expect(await client.revoke(ID)).toEqual({ kind: "ok" });
    expect(await client.revoke(ID)).toEqual({ kind: "rejected", code: "not_found" });
    expect(await client.revoke(ID)).toEqual({ kind: "forbidden" });
    expect(sent.slice(2).map(({ method, body }) => [method, body])).toEqual([["DELETE", { id: ID }], ["DELETE", { id: ID }], ["DELETE", { id: ID }]]);
  });

  it("초안은 고른 결과의 생성 프롬프트로 채우고, 길이 한도를 지킨다", () => {
    expect(draftFromResult(READY.music, 0)).toEqual({ title: "음악 분석 결과", summary: "음악 소스에서 추정 템포 120 BPM를 측정했어요.", prompt: "120 BPM의 경쾌한 배경 음악", media: "music" });
    expect(draftFromResult(READY.video, 1).prompt).toBe("두 번째 컷");
    expect(draftFromResult(READY.image, 0).summary).toBe("이미지 소스에서 관찰 근거 1개를 측정했어요.");
    expect(validateDraft({ title: " ", summary: "a".repeat(601), prompt: "ok", media: "image" })).toEqual({ title: "제목을 입력하세요.", summary: "요약은 600자 이하로 줄여 주세요." });
  });
});

describe("화면", () => {
  it("소스·매체와 단일 권리 확인 동작을 표시하고, 분석 전에는 예시 결과를 표시하지 않는다", () => {
    const html = renderToStaticMarkup(createElement(AdminReferenceAnalysis, { client: createAdminReferenceAnalysisClient(transportOf().transport) }));
    expect(html).toContain("콘텐츠 프롬프트 분석기");
    expect(html).toContain("스펙트럼 랩");
    expect(html).toContain("URL 주소");
    expect(html).toContain("파일 업로드");
    expect(html).toContain("https://tonejs.github.io");
    expect(html).toContain("MP4 · MOV · WEBM");
    expect(html).toContain("분석할 권리가 있는 자료만 실행하세요.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*권리 확인하고 분석/);
    expect(html).not.toMatch(/type="checkbox"|예시 결과|<meter|공개 준비/);
    expect(html).toContain("공개 목록을 불러오고 있어요.");
    expect(html).toContain('href="/analysis-results"');
  });

  it("관찰 화면에는 응답의 시간, 색상, 비중과 추정 값을 그대로 표시한다", () => {
    const render = (media: AnalysisMedia) => renderToStaticMarkup(createElement(SpectrumResults, { result: READY[media] }));
    const music = render("music");
    expect(music).toContain("0, 500, 1000, 1500, 2000");
    expect(music).toContain("추정 템포 120 BPM");
    expect(music).toContain("관련 관찰 근거 1번");
    expect(render("image")).toContain("#3366cc");
    expect(render("image")).toContain("60%");
    expect(render("video")).toContain("원본 프레임 표시 시각 125 ms");
    expect(render("video")).toContain("500 ms");
  });

  it("공개 페이지는 승인 필드만 평문으로 그리고, 3종·빈 목록·장애를 구분한다", () => {
    const items = (["image", "music", "video"] as const).map((media, index) => ({ id: `10000000-0000-4000-8000-00000000001${index}`, media,
      title: `${media} <script>alert(1)</script>`, summary: "줄1\n줄2", prompt: "<a href=x>링크</a>", publishedAt: "2026-11-20T03:00:00.000Z" }));
    const html = renderToStaticMarkup(createElement(PublishedAnalysisResults, { feed: { kind: "ok", items } }));
    expect(html).toContain("이미지"); expect(html).toContain("음악"); expect(html).toContain("영상");
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<a href=x>"); expect(html).toContain("2026");
    expect(html).toContain('aria-label="공개 분석 결과 3개"');
    expect(renderToStaticMarkup(createElement(PublishedAnalysisResults, { feed: { kind: "ok", items: [] } }))).toContain("아직 공개된 분석 결과가 없어요");
    const down = renderToStaticMarkup(createElement(PublishedAnalysisResults, { feed: { kind: "unavailable" } }));
    expect(down).toContain("지금은 결과를 불러올 수 없어요");
    expect(down).not.toContain("<article");
  });
});
