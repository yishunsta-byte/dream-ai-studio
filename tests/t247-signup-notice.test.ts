import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T-247 가입 안내 문구. mock SDK 시험이며 실제 메일 발송·계정 조회는 없다.
// 기대값 근거: 허용 밖·이미 있는 계정·실제 요청 모두 같은 조건부 문구(계정 존재 미노출), 실발송 단정 금지, 진짜 실패는 실패 응답.
const calls = vi.hoisted(() => ({ signup: 0, error: null as null | { status?: number; code?: string } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  createSupabaseServer: async () => ({ auth: { signUp: async () => { calls.signup++; return { error: calls.error }; } } }),
}));

const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS", "DREAM_SITE_URL", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  Object.assign(calls, { signup: 0, error: null });
  process.env.DREAM_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  process.env.DREAM_ALLOWED_EMAILS = "owner@example.com";
});
afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
async function signup(email: string) {
  const { POST } = await import("@/app/api/auth/signup/route");
  return POST(new Request("http://localhost:43182/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password: "dream-2026-test" }), headers: { host: "127.0.0.1:43182", origin: "http://127.0.0.1:43182", "content-type": "application/json" } }));
}

describe("T-247 가입 안내는 조건부 접수 문구", () => {
  it("문구가 실발송을 단정하지 않고, 메일이 안 올 때 다음 행동을 알려 준다", async () => {
    const { message: SIGNUP_ACCEPTED } = await (await signup("stranger@example.com")).json();
    expect(SIGNUP_ACCEPTED).not.toMatch(/보냈어요/);
    expect(SIGNUP_ACCEPTED).toContain("가입할 수 있는 주소라면 확인 메일이 가요");
    expect(SIGNUP_ACCEPTED).toContain("비밀번호 찾기");
  });
  it("허용 밖·이미 있는 계정·정상 요청 응답이 모두 같다(계정 존재 미노출)", async () => {
    const stranger = await (await signup("stranger@example.com")).json();
    expect(calls.signup).toBe(0);
    const fresh = await (await signup("owner@example.com")).json();
    calls.error = { status: 422, code: "user_already_exists" };
    const existing = await (await signup("owner@example.com")).json();
    expect(calls.signup).toBe(2);
    expect(stranger.message).toContain("가입 요청을 받았어요");
    for (const body of [fresh, existing]) expect(body).toEqual(stranger);
  });
  it("진짜 실패는 성공 문구가 아니다(429·가입 꺼짐·그 밖 오류)", async () => {
    const cases: [{ status?: number; code?: string }, number, string][] = [
      [{ status: 429 }, 429, "RATE_LIMITED"],
      [{ status: 422, code: "signup_disabled" }, 403, "SIGNUP_DISABLED"],
      [{ status: 500, code: "unexpected_failure" }, 502, "AUTH_SEND_FAILED"],
    ];
    for (const [error, status, code] of cases) {
      calls.error = error;
      const response = await signup("owner@example.com");
      expect(response.status, code).toBe(status);
      const body = await response.json();
      expect(body.code).toBe(code);
      expect(body.ok).toBeUndefined();
    }
  });
});
