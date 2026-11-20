import { describe, expect, it, vi } from "vitest";
import { isAnonymousPublicPath } from "../../lib/auth/config";
import { createAdminReferenceHttp } from "../../lib/reference-analysis/admin-reference-http";
import { MediaUrlError } from "../../lib/reference-analysis/media-url-error";

vi.mock("server-only", () => ({}));

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
    expect(analyze).toHaveBeenCalledWith(url, undefined, expect.any(AbortSignal));
  });

  it("공개·철회는 인증 계정과 명시 승인만 사용하며 같은 요청 ID를 돌려준다", async () => {
    const published = {
      id: entry.id, title: entry.title, summary: entry.summary, prompt: entry.prompt, media: entry.media,
      status: "published" as const, publishedAt: "2026-11-20T02:00:00.000Z",
    };
    const store = { list: vi.fn(async () => [published]), publish: vi.fn(async () => published), revoke: vi.fn(async () => true) };
    const openStore = vi.fn<(ownerId: string) => Promise<typeof store>>(async () => store);
    const admin = createAdminReferenceHttp({ authenticate: async () => actor, env: { DREAM_SITE_URL: origin }, openStore });
    expect((await admin.publications(request("POST", { ...entry, ownerId: "another account" }))).status).toBe(400);
    expect(store.publish).not.toHaveBeenCalled();
    const created = await admin.publications(request("POST", entry));
    expect(await created.json()).toEqual({ item: published });
    expect(created.headers.get("cache-control")).toBe("no-store");
    expect(openStore).toHaveBeenCalledWith(actor.userId);
    expect(store.publish).toHaveBeenCalledWith(entry);
    expect(await (await admin.publications(request("GET"))).json()).toEqual({ items: [published] });
    expect(store.list).toHaveBeenCalledOnce();
    expect(await (await admin.publications(request("DELETE", { id: entry.id }))).json()).toEqual({ ok: true });
    expect(store.revoke).toHaveBeenCalledWith(entry.id);
  });

  it("웹에서 읽기 공개되는 경로를 결과 목록 하나로 제한한다", () => {
    expect(isAnonymousPublicPath("/analysis-results")).toBe(true);
    expect(isAnonymousPublicPath("/analysis-results/arbitrary")).toBe(false);
    expect(isAnonymousPublicPath("/api/admin/reference-publications")).toBe(false);
  });
});
