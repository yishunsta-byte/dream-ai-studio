import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-191 공통 서버 인증 판별: 순서·거절 코드·getUser 1회·요청 간 공유 없음.
const state = vi.hoisted(() => ({
  client: true,
  calls: 0,
  reply: null as null | (() => unknown),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  createSupabaseServer: async () => state.client ? { auth: { getUser: async () => { state.calls++; return state.reply ? state.reply() : { data: { user: null }, error: null }; } } } : null,
}));

const UID = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const ok = (user: Record<string, unknown> | null, error: unknown = null) => () => ({ data: { user }, error });
const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  Object.assign(state, { client: true, calls: 0, reply: null });
});
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
function ready() {
  process.env.DREAM_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  process.env.DREAM_ALLOWED_EMAILS = "Owner@Example.com";
}
async function resolve() { return (await import("@/lib/auth/resolve")).resolveServerAuth(); }

describe("T-191 resolveServerAuth", () => {
  it("로그인이 꺼진 이 PC는 local, 인증 서버를 부르지 않는다", async () => {
    expect(await resolve()).toEqual({ kind: "local" });
    expect(state.calls).toBe(0);
  });
  it("설정이 빠졌거나 연결을 못 만들면 503, getUser 호출 없음", async () => {
    process.env.DREAM_AUTH_MODE = "supabase";
    expect(await resolve()).toEqual({ kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" });
    ready(); state.client = false;
    expect(await resolve()).toEqual({ kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" });
    expect(state.calls).toBe(0);
  });
  it("허용·확인된 계정은 verified{userId,email}, getUser는 정확히 1번", async () => {
    ready(); state.reply = ok({ id: UID.toUpperCase(), email: "owner@example.com", app_metadata: { role: "x" } });
    expect(await resolve()).toEqual({ kind: "verified", userId: UID, email: "owner@example.com" });
    expect(state.calls).toBe(1);
  });
  it.each([
    ["사용자 없음", ok(null), 401, "AUTH_REQUIRED"],
    ["만료·위조 오류", ok(null, { status: 401, name: "AuthApiError" }), 401, "AUTH_REQUIRED"],
    ["user와 error가 같이 옴", ok({ id: UID, email: "owner@example.com" }, { status: 403, name: "AuthApiError" }), 401, "AUTH_REQUIRED"],
    ["인증 서버 5xx", ok({ id: UID, email: "owner@example.com" }, { status: 502, name: "AuthApiError" }), 503, "AUTH_UNAVAILABLE"],
    ["재시도 가능 네트워크 오류", ok(null, { name: "AuthRetryableFetchError" }), 503, "AUTH_UNAVAILABLE"],
    ["허용 밖 이메일", ok({ id: UID, email: "stranger@example.com" }), 403, "AUTH_FORBIDDEN"],
    ["이메일 없음", ok({ id: UID }), 403, "AUTH_FORBIDDEN"],
    ["허용 밖 + 잘못된 UUID는 허용 검사가 먼저", ok({ id: "not-a-uuid", email: "stranger@example.com" }), 403, "AUTH_FORBIDDEN"],
    ["허용 계정의 잘못된 UUID", ok({ id: "owner@example.com", email: "owner@example.com" }), 503, "AUTH_UNAVAILABLE"],
    ["허용 계정의 id 없음", ok({ email: "owner@example.com" }), 503, "AUTH_UNAVAILABLE"],
    ["getUser 예외", () => { throw new Error("network"); }, 503, "AUTH_UNAVAILABLE"],
  ] as const)("%s → %i %s", async (_name, reply, status, code) => {
    ready(); state.reply = reply as () => unknown;
    expect(await resolve()).toEqual({ kind: "denied", status, code });
    expect(state.calls).toBe(1);
  });
  it("요청마다 새로 판별한다: 앞 요청의 확인 결과가 다음 요청에 남지 않는다", async () => {
    ready();
    state.reply = ok({ id: UID, email: "owner@example.com" });
    expect((await resolve()).kind).toBe("verified");
    state.reply = ok(null);
    expect(await resolve()).toEqual({ kind: "denied", status: 401, code: "AUTH_REQUIRED" });
    state.reply = ok({ id: UID, email: "stranger@example.com" });
    expect((await resolve()).kind).toBe("denied");
    expect(state.calls).toBe(3);
  });
});

describe("T-191 requireApiAuth 호환 함수", () => {
  async function guard() { return (await import("@/lib/auth/api")).requireApiAuth(); }
  it("local·verified는 예전처럼 null", async () => {
    expect(await guard()).toBeNull();
    ready(); state.reply = ok({ id: UID, email: "owner@example.com" });
    expect(await guard()).toBeNull();
    expect(state.calls).toBe(1);
  });
  it.each([
    [ok(null), 401, "AUTH_REQUIRED"],
    [ok({ id: UID, email: "stranger@example.com" }), 403, "AUTH_FORBIDDEN"],
    [ok({ id: "bad", email: "owner@example.com" }), 503, "AUTH_UNAVAILABLE"],
  ] as const)("거절은 {error,code}·no-store·리다이렉트 없음(%#)", async (reply, status, code) => {
    ready(); state.reply = reply;
    const response = await guard();
    expect(response?.status).toBe(status);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("location")).toBeNull();
    const body = await response?.json();
    expect(body.code).toBe(code);
    expect(typeof body.error).toBe("string");
    expect(Object.keys(body).sort()).toEqual(["code", "error"]);
  });
});

describe("T-191 화면 계정 표시", () => {
  it("verified만 이메일을 보여 주고, 거절·local은 null", async () => {
    const { currentAccountEmail } = await import("@/lib/auth/render");
    expect(await currentAccountEmail()).toBeNull();
    ready(); state.reply = ok({ id: UID, email: "owner@example.com" });
    expect(await currentAccountEmail()).toBe("owner@example.com");
    state.reply = ok({ id: UID, email: "stranger@example.com" });
    expect(await currentAccountEmail()).toBeNull();
  });
});
