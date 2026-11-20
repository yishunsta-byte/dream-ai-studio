import { describe, expect, it, vi } from "vitest";
import { isAnonymousPublicPath } from "../../lib/auth/config";
import { createSupabaseServer } from "../../lib/auth/server";
import { createAdminReferenceHttp } from "../../lib/reference-analysis/admin-reference-http";
import { AnalysisStageError, MediaUrlError } from "../../lib/reference-analysis/media-url-error";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/auth/server", () => ({ createSupabaseServer: vi.fn() }));

const origin = "https://studio.example.com";
const actor = { kind: "verified", userId: "10000000-0000-4000-8000-000000000011", email: "admin@example.com" } as const;
const entry = {
  id: "10000000-0000-4000-8000-000000000022",
  title: "영상 분석",
  summary: "컷 길이와 구도",
  prompt: "짧은 영상 프롬프트",
  media: "video" as const,
  authorized: true as const,
};

function request(method: string, body?: unknown, sender = origin) {
  return new Request(`${origin}/api/admin/reference-analysis`, {
    method,
    headers: { host: "studio.example.com", origin: sender, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("관리자 콘텐츠 분석 및 결과 공개 경계", () => {
  it("인증과 현재 요청 출처를 분석 및 저장소 호출보다 먼저 확인한다", async () => {
    const analyze = vi.fn();
    const openStore = vi.fn();
    const anonymous = createAdminReferenceHttp({ authenticate: async () => ({ kind: "local" }), analyze, openStore });
    expect((await anonymous.analyze(request("POST", {}))).status).toBe(401);
    expect((await anonymous.publications(request("GET"))).status).toBe(401);

    const admin = createAdminReferenceHttp({ authenticate: async () => actor, env: { DREAM_SITE_URL: origin }, analyze, openStore });
    expect((await admin.analyze(request("POST", {}, "https://other.example.com"))).status).toBe(403);
    expect((await admin.publications(request("POST", entry, "https://other.example.com"))).status).toBe(403);
    expect(analyze).not.toHaveBeenCalled();
    expect(openStore).not.toHaveBeenCalled();
  });

  it("권리 확인이 있어야 분석하며 서버의 미디어 오류만 노출한다", async () => {
    const analyze = vi.fn(async () => { throw new MediaUrlError("unsupported_origin", "private detail"); });
    const admin = createAdminReferenceHttp({ authenticate: async () => actor, env: { DREAM_SITE_URL: origin }, analyze });
    const url = "https://example.com/material.jpg";
    const missing = await admin.analyze(request("POST", { url, authorized: false }));
    expect(await missing.json()).toEqual({ error: "rights_required" });
    expect(analyze).not.toHaveBeenCalled();
    const unsupported = await admin.analyze(request("POST", { url, authorized: true }));
    expect(unsupported.status).toBe(422);
    expect(await unsupported.json()).toEqual({ error: "unsupported_origin" });
    // 요청 취소 신호는 분석에 넘기지 않는다(운영 라우트에서 일찍 끝나 정상 분석을 끊던 원인 후보).
    expect(analyze).toHaveBeenCalledWith(url, undefined, undefined);
  });

  it("본문을 읽은 뒤 요청 신호가 일찍 끝나도 분석은 끊기지 않고 진단 헤더로만 알린다", async () => {
    const ready = { schemaVersion: 1 as const, status: "ready" as const, sourceUrl: "https://x", sha256: "0".repeat(64), sizeBytes: 1, media: "image" as const,
      proposals: [{ media: "image" as const, selectionId: "image-1", observations: [{ kind: "observation" as const, findingId: "region-1", measure: "region_color_luminance" as const,
        location: { kind: "region" as const, x: 0, y: 0, width: 1, height: 1 }, alphaCoverage: 1, palette: [{ bucket: "#3366cc", visibleShare: 0.6 }],
        luminanceShares: [0.25, 0.25, 0.25, 0.25], luminanceEdges: [0, 0.25, 0.5, 0.75, 1] }],
        draft: { kind: "creative_proposal" as const, target: "image" as const, prompt: "푸른 장면" } }] };
    const controller = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const analyze = vi.fn(async (_url: string, _origin?: string, signal?: AbortSignal) => { seen.push(signal); controller.abort(); return ready as never; });
    const admin = createAdminReferenceHttp({ authenticate: async () => actor, env: { DREAM_SITE_URL: origin }, analyze });
    const live = new Request(`${origin}/api/admin/reference-analysis`, { method: "POST", signal: controller.signal,
      headers: { host: "studio.example.com", origin, "content-type": "application/json" }, body: JSON.stringify({ url: "https://mdn.github.io/a.png", authorized: true }) });
    const response = await admin.analyze(live);
    expect(response.status).toBe(200);
    expect(seen).toEqual([undefined]);
    expect(response.headers.get("x-dream-request-signal")).toBe("aborted");
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["result"]);
    expect(Object.keys(body.result).sort()).toEqual(["media", "proposals", "schemaVersion", "status"]);
  });

  it("분석 실패는 단계·오류 이름만 진단으로 돌려주고 URL·서버 문장은 숨긴다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const url = "https://interactive-examples.mdn.mozilla.net/media/secret-name.jpg";
    const cases: Array<[unknown, Record<string, unknown>]> = [
      [new AnalysisStageError("fetch", "AbortError"), { stage: "fetch", detail: "AbortError" }],
      [new AnalysisStageError("inspect", "unverified_analysis"), { stage: "inspect", detail: "unverified_analysis" }],
      [Object.assign(new Error("/tmp/private path " + url), { name: "TypeError" }), { stage: "result", detail: "TypeError" }],
    ];
    for (const [thrown, expected] of cases) {
      const admin = createAdminReferenceHttp({ authenticate: async () => actor, env: { DREAM_SITE_URL: origin }, analyze: vi.fn(async () => { throw thrown; }) });
      const response = await admin.analyze(request("POST", { url, authorized: true }));
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body).toEqual({ error: "analysis_failed", ...expected, requestAborted: false });
      expect(response.headers.get("x-dream-request-signal")).toBe("live");
      expect(JSON.stringify(body)).not.toMatch(/secret-name|tmp|private/);
    }
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/secret-name|tmp|private/);
    error.mockRestore();
  });

  it("공개·철회는 인증 계정과 명시 승인만 사용하며 같은 요청 ID를 돌려준다", async () => {
    const published = {
      id: entry.id, title: entry.title, summary: entry.summary, prompt: entry.prompt, media: entry.media,
      status: "published" as const, publishedAt: "2026-11-20T02:00:00.000Z",
    };
    const legacy = {
      ...published,
      id: "10000000-0000-4000-8000-000000000033",
      summary: "기존 공개 기록 https://example.invalid/previous",
    };
    const store = { list: vi.fn(async () => [published, legacy]), publish: vi.fn(async () => published), revoke: vi.fn(async () => true) };
    const openStore = vi.fn<(ownerId: string) => Promise<typeof store>>(async () => store);
    const admin = createAdminReferenceHttp({ authenticate: async () => actor, env: { DREAM_SITE_URL: origin }, openStore });
    expect((await admin.publications(request("POST", { ...entry, ownerId: "another account" }))).status).toBe(400);
    expect(store.publish).not.toHaveBeenCalled();
    const created = await admin.publications(request("POST", entry));
    expect(await created.json()).toEqual({ item: published });
    expect(created.headers.get("cache-control")).toBe("no-store");
    expect(openStore).toHaveBeenCalledWith(actor.userId);
    expect(store.publish).toHaveBeenCalledWith(entry);
    expect(await (await admin.publications(request("GET"))).json()).toEqual({ items: [published, legacy] });
    expect(store.list).toHaveBeenCalledOnce();
    expect(await (await admin.publications(request("DELETE", { id: entry.id }))).json()).toEqual({ ok: true });
    expect(store.revoke).toHaveBeenCalledWith(entry.id);
    expect(await (await admin.publications(request("DELETE", { id: legacy.id }))).json()).toEqual({ ok: true });
    expect(store.revoke).toHaveBeenLastCalledWith(legacy.id);
  });

  it("POST의 모든 공개 문구에서 원본 주소·계정·키 형태를 거부하고 본문을 노출하지 않는다", async () => {
    const publish = vi.fn();
    const store = { publish, list: vi.fn(), revoke: vi.fn() };
    const admin = createAdminReferenceHttp({ authenticate: async () => actor, env: { DREAM_SITE_URL: origin }, openStore: async () => store });
    const textCases = [
      "https://example.invalid/analysis-source",
      "file:///C:/private/source.jpg",
      "operator@example.invalid",
      "AIza" + "SyntheticFixture_Only_123456789",
      "sk_" + "synthetic_fixture_only_123456789",
    ];
    for (const field of ["title", "summary", "prompt"] as const) {
      for (const text of textCases) {
        const result = await admin.publications(request("POST", { ...entry, [field]: `공개 입력 ${text}` }));
        expect(result.status, field).toBe(400);
        expect(await result.json()).toEqual({ error: "invalid_publication" });
      }
    }
    expect(publish).not.toHaveBeenCalled();
  });

  it("정상 문구를 같은 ID로 재제출하면 실제 저장 어댑터가 기존 공개 결과를 돌려준다", async () => {
    const { authorized, ...fields } = entry;
    const stored = { ...fields, status: "published", published_at: "2026-11-20T02:00:00.000Z" };
    const legacy = {
      ...stored,
      id: "10000000-0000-4000-8000-000000000033",
      summary: "기존 기록 https://example.invalid/prior",
    };
    const single = vi.fn().mockResolvedValueOnce({ error: null, data: stored }).mockResolvedValueOnce({ error: { code: "23505" } });
    const read = vi.fn(async () => ({ error: null, data: stored }));
    const byId = vi.fn(() => ({ maybeSingle: read }));
    const limit = vi.fn(async () => ({ error: null, data: [stored, legacy] }));
    const insert = vi.fn(() => ({ select: () => ({ single }) }));
    const from = vi.fn(() => ({ insert, select: () => ({ eq: byId, order: () => ({ limit }) }) }));
    const session = { auth: { getUser: async () => ({ data: { user: { id: actor.userId } }, error: null }) }, from };
    const supabase = vi.mocked(createSupabaseServer);
    const client = session as unknown as Awaited<ReturnType<typeof createSupabaseServer>>;
    supabase.mockResolvedValueOnce(client).mockResolvedValueOnce(client).mockResolvedValueOnce(client);
    const admin = createAdminReferenceHttp({ authenticate: async () => actor, env: { DREAM_SITE_URL: origin } });

    const initial = await admin.publications(request("POST", { ...fields, authorized }));
    const retry = await admin.publications(request("POST", { ...fields, authorized }));
    expect(initial.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(await initial.json());
    expect(insert.mock.calls).toEqual([[fields], [fields]]);
    expect(byId).toHaveBeenCalledOnce();
    expect(byId).toHaveBeenCalledWith("id", entry.id);
    expect(from).toHaveBeenCalledWith("reference_analysis_publications");
    const list = await admin.publications(request("GET"));
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ items: [{ id: entry.id }, { id: legacy.id, summary: legacy.summary }] });
  });

  it("웹에서 읽기 공개되는 경로를 결과 목록 하나로 제한한다", () => {
    expect(isAnonymousPublicPath("/analysis-results")).toBe(true);
    expect(isAnonymousPublicPath("/analysis-results/arbitrary")).toBe(false);
    expect(isAnonymousPublicPath("/api/admin/reference-publications")).toBe(false);
  });
});
