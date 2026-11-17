/// <reference types="vite/client" />
// T-213(F209-1): 다른 탭 로그아웃·계정 변경 뒤 이전 계정 표시가 남지 않게.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: null as null | { id: string; email?: string }, fail: false, getUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  createSupabaseServer: async () => ({ auth: { getUser: async () => {
    state.getUser();
    if (state.fail) throw new Error("private provider detail");
    return { data: { user: state.user }, error: null };
  } } }),
}));

const envKeys = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS", "DREAM_SITE_URL", "DREAM_PROJECT_READ_BACKEND"] as const;
let saved: (string | undefined)[];
const A = { id: "11111111-1111-4111-8111-111111111213", email: "owner@example.invalid" };
beforeEach(() => {
  saved = envKeys.map((key) => process.env[key]);
  envKeys.forEach((key) => delete process.env[key]);
  Object.assign(process.env, {
    DREAM_AUTH_MODE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-public",
    DREAM_ALLOWED_EMAILS: "owner@example.invalid,second@example.invalid", VERCEL: "1", DREAM_PROJECT_READ_BACKEND: "postgres", DREAM_SITE_URL: "https://studio.vercel.app",
  });
  Object.assign(state, { user: A, fail: false });
  vi.clearAllMocks();
});
afterEach(() => {
  envKeys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sameSite = (body: unknown, headers: Record<string, string> = {}) => new Request("https://studio.vercel.app/api/auth/session", {
  method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
  headers: { host: "studio.vercel.app", origin: "https://studio.vercel.app", "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
});
async function call(request: Request) { const { POST } = await import("@/app/api/auth/session/route"); return POST(request); }

describe("세션 확인 API /api/auth/session", () => {
  it.each([
    ["로그인 없음", () => { state.user = null; }, 401, "AUTH_REQUIRED"],
    ["허용 밖 계정", () => { state.user = { id: A.id, email: "other@example.invalid" }; }, 403, "AUTH_FORBIDDEN"],
    ["인증 서버 오류", () => { state.fail = true; }, 503, "AUTH_UNAVAILABLE"],
  ] as const)("%s → 기존 resolver 거절 그대로, no-store, 본문 미읽기", async (_name, arrange, status, code) => {
    arrange();
    const request = sameSite({ account: A.email });
    const read = vi.spyOn(request, "json");
    const response = await call(request);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(read).not.toHaveBeenCalled();
    expect(state.getUser).toHaveBeenCalledOnce();
  });
  it("클라우드(VERCEL·postgres)에서도 열린다: 같은 계정 same, 다른 계정 changed(대소문자·공백 무시). 이메일·id를 돌려주지 않는다", async () => {
    for (const [account, expected] of [[A.email, "same"], ["  OWNER@example.invalid ", "same"], ["second@example.invalid", "changed"]] as const) {
      const response = await call(sameSite({ account }));
      const text = await response.text();
      expect(response.status).toBe(200);
      expect(JSON.parse(text)).toEqual({ state: expected });
      expect(text).not.toContain(A.email);
      expect(text).not.toContain(A.id);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(state.getUser).toHaveBeenCalledTimes(3);
  });
  it("다른 사이트 요청·JSON 아님·형식 오류는 거절(no-store)", async () => {
    expect((await call(sameSite({ account: A.email }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await call(sameSite({ account: A.email }, { "content-type": "text/plain" }))).status).toBe(415);
    for (const body of ["not json", {}, { account: 3 }, { account: "" }, { account: "a".repeat(321) }]) {
      const response = await call(sameSite(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
  it("로그인 꺼진 이 PC 설정은 local(getUser 없음)", async () => {
    delete process.env.DREAM_AUTH_MODE; delete process.env.VERCEL;
    const response = await call(sameSite({ account: "x@example.invalid" }, { host: "127.0.0.1:3013", origin: "http://127.0.0.1:3013" }));
    expect(await response.json()).toEqual({ state: "local" });
    expect(state.getUser).not.toHaveBeenCalled();
  });
  it("업무 데이터·DB·legacy 서비스를 가져오지 않는다", () => {
    const source = readFileSync("app/api/auth/session/route.ts", "utf8");
    const imports = source.split(/\r?\n/).filter((line) => line.startsWith("import "));
    expect(imports.join("\n")).not.toMatch(/lib\/db|postgres|sqlite|lib\/services|legacy-gate/i);
    expect(source).not.toMatch(/requireApiAuth\(/);
    expect(source).toMatch(/resolveServerAuth\(\)/);
  });
});

class FakeChannel {
  static all: FakeChannel[] = [];
  static posted: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(public name: string) { FakeChannel.all.push(this); }
  postMessage(data: unknown) {
    FakeChannel.posted.push(data);
    for (const other of FakeChannel.all) if (other !== this && !other.closed && other.name === this.name) other.onmessage?.({ data } as MessageEvent);
  }
  close() { this.closed = true; }
}
function browser() {
  FakeChannel.all = []; FakeChannel.posted = [];
  const store = new Map<string, string>(), session = new Map<string, string>();
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const win = {
    addEventListener: (type: string, fn: (event: unknown) => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn); },
    removeEventListener: (type: string, fn: (event: unknown) => void) => { listeners.get(type)?.delete(fn); },
    location: { reload: vi.fn() },
    emit: (type: string, event: unknown) => listeners.get(type)?.forEach((fn) => fn(event)),
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", { setItem: (k: string, v: string) => store.set(k, v), getItem: (k: string) => store.get(k) ?? null });
  vi.stubGlobal("sessionStorage", { setItem: (k: string, v: string) => session.set(k, v), getItem: (k: string) => session.get(k) ?? null });
  return { win, store };
}

describe("탭 사이 알림 도우미(lib/auth/session-sync)", () => {
  it("알림에는 고정 신호와 시각·난수만 실린다(토큰·이메일·UUID 없음). 채널·storage 모두 받는다", async () => {
    const { win, store } = browser();
    const { announceSessionChange, onSessionSignal } = await import("@/lib/auth/session-sync");
    const heard = vi.fn();
    const stop = onSessionSignal(heard);
    announceSessionChange();
    expect(FakeChannel.posted).toEqual(["changed"]);
    expect(heard).toHaveBeenCalledTimes(1);
    const value = [...store.values()][0];
    expect(value).toMatch(/^\d+-[a-z0-9]+$/);
    expect(value).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-|eyJ/);
    win.emit("storage", { key: "dream-auth-session-signal", newValue: value });
    win.emit("storage", { key: "other", newValue: "x" });
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    expect(win.count("storage")).toBe(0);
    expect(FakeChannel.all.filter((channel) => !channel.closed)).toEqual([]);
  });
  it("BroadcastChannel·저장소가 막혀도 예외 없이 넘어간다", async () => {
    browser();
    vi.stubGlobal("BroadcastChannel", class { constructor() { throw new Error("unsupported"); } });
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("blocked"); } });
    const { announceSessionChange, onSessionSignal } = await import("@/lib/auth/session-sync");
    expect(() => announceSessionChange()).not.toThrow();
    expect(() => onSessionSignal(() => {})()).not.toThrow();
  });
  it.each([
    [200, { state: "same" }, "same"],
    [200, { state: "local" }, "same"],
    [200, { state: "changed" }, "changed"],
    [401, { code: "AUTH_REQUIRED" }, "signed-out"],
    [403, { code: "AUTH_FORBIDDEN" }, "forbidden"],
    [403, { code: "AUTH_ORIGIN_REJECTED" }, "unavailable"],
    [503, { code: "AUTH_UNAVAILABLE" }, "unavailable"],
    [200, { state: "weird" }, "unavailable"],
  ] as const)("서버 %s %j → %s", async (status, body, expected) => {
    browser();
    const fetch = vi.fn(async () => Response.json(body, { status }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("navigator", { onLine: true });
    const { checkSession } = await import("@/lib/auth/session-sync");
    expect(await checkSession(A.email)).toBe(expected);
    expect(fetch).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({ method: "POST", cache: "no-store", body: JSON.stringify({ account: A.email }) }));
  });
  it("오프라인은 요청 없이 offline, 연결 실패는 unavailable(성공으로 숨기지 않음)", async () => {
    browser();
    const fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", fetch);
    const { checkSession } = await import("@/lib/auth/session-sync");
    vi.stubGlobal("navigator", { onLine: false });
    expect(await checkSession(A.email)).toBe("offline");
    expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { onLine: true });
    expect(await checkSession(A.email)).toBe("unavailable");
  });
  it("판단: 같음만 표시, 바뀜은 다시 받기, 로그인 없음·허용 밖은 로그인 이동, 확인 불가는 의심일 때만 숨김", async () => {
    const { decideSession } = await import("@/lib/auth/session-sync");
    expect(decideSession("same", true)).toEqual({ view: "current" });
    expect(decideSession("changed", false)).toEqual({ view: "checking", go: "reload" });
    expect(decideSession("signed-out", false)).toEqual({ view: "checking", go: "login" });
    expect(decideSession("forbidden", true)).toEqual({ view: "checking", go: "forbidden" });
    expect(decideSession("offline", true)).toEqual({ view: "offline" });
    expect(decideSession("unavailable", true)).toEqual({ view: "unavailable" });
    expect(decideSession("offline", false)).toEqual({ view: "keep" });
    expect(decideSession("unavailable", false)).toEqual({ view: "keep" });
  });
  it("다시 받기는 15초 안에 한 번만(무한 새로고침 방지), 저장소가 막히면 하지 않는다", async () => {
    const { win } = browser();
    const { reloadOnce } = await import("@/lib/auth/session-sync");
    expect(reloadOnce(100_000)).toBe(true);
    expect(reloadOnce(110_000)).toBe(false);
    expect(reloadOnce(116_000)).toBe(true);
    expect(win.location.reload).toHaveBeenCalledTimes(2);
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(reloadOnce(300_000)).toBe(false);
    expect(win.location.reload).toHaveBeenCalledTimes(2);
  });
});

describe("화면 연결(정적 계약)", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("감시 훅: 알림·focus·보이기·online·pageshow(persisted)만 듣고, 주기 확인이 없다", () => {
    const hook = read("components/auth/use-session-watch.ts");
    for (const event of ['"focus"', '"online"', '"pageshow"', '"visibilitychange"']) expect(hook).toContain(event);
    expect(hook).toMatch(/event\.persisted/);
    expect(hook).toMatch(/visibilityState === "visible"/);
    expect(hook).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    expect(hook).toMatch(/reloadOnce\(\)/);
    expect(hook).toMatch(/again\.current/);
  });
  it("계정 메뉴: 확인 전에는 이메일을 숨기고, 로그아웃 완료·부분 때만 알린다", () => {
    const menu = read("components/auth/account-menu.tsx");
    expect(menu).toMatch(/useSessionWatch\(email, busy\)/);
    expect(menu).toMatch(/confirmed\s*\?\s*<span[^>]*title=\{email\}/);
    // 확인 안내는 좁은 화면에서도 숨기지 않는 별도 스타일(이메일 .email은 600px 이하에서 숨김)
    expect(menu).toMatch(/className=\{styles\.accountNotice\} role="status"/);
    expect(readFileSync("components/auth/login.module.css", "utf8")).not.toMatch(/\.accountNotice[^{]*\{[^}]*display:\s*none/);
    expect(menu.match(/announceSessionChange\(\)/g)).toHaveLength(2);
    expect(menu).toMatch(/state === "ended"\) \{ announceSessionChange\(\)/);
    expect(menu).toMatch(/state === "partial"\) \{ announceSessionChange\(\)/);
  });
  it("로그인 성공·비밀번호 변경 뒤 로그아웃(완료·부분)만 알린다", () => {
    const login = read("components/auth/login-form.tsx");
    expect(login).toMatch(/await post\("\/api\/auth\/login"[^\n]*\r?\n[^\n]*\r?\n\s*announceSessionChange\(\);\r?\n\s*window\.location\.assign\(next\)/);
    expect(login.match(/announceSessionChange\(\)/g)).toHaveLength(1);
    const password = read("components/auth/new-password-form.tsx");
    expect(password.match(/announceSessionChange\(\)/g)).toHaveLength(2);
    expect(password).toMatch(/"ended"\) \{ announceSessionChange\(\)/);
    expect(password).toMatch(/"partial"\) \{ announceSessionChange\(\)/);
  });
  it("알림 도우미는 계정 값을 보내지 않는다(postMessage 고정 문자열)", () => {
    const sync = read("lib/auth/session-sync.ts");
    expect(sync).toMatch(/postMessage\("changed"\)/);
    expect(sync.match(/postMessage\(/g)).toHaveLength(1);
  });
});
