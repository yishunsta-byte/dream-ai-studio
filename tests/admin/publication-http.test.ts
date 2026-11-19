import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildAction, type PublicationItem } from "../../components/admin/publication-model";
import { actionBody, createHttpPublicationProvider, isPublicationList, PUBLICATION_ENDPOINT } from "../../components/admin/publication-http-provider";
import type { ServerAuthResult } from "../../lib/auth/resolve";
import { createAdminPublicationHttp, PUBLICATION_BODY_LIMIT } from "../../lib/public-showcase/admin-publication-http";
import { ACTOR_A, ACTOR_B, SITE, post, requestId, syntheticCover, syntheticStore, verified, work } from "./publication-http-fixture";

vi.mock("server-only", () => ({}));

// T297: 관리자 게시 HTTP 경계와 동일 출처 공급자. 기대값 근거: Master msg_0ab402fdbb8e(인증 뒤에만, 서버가 세션·게시자·소유 판정,
// no-store, 본문 크기·형식 제한, T289 UUID·상태 계약, T290-F1 권리·리비전·재시도 보존, 운영 저장소 미준비면 쓰기 없이 미연결).
let cover: Awaited<ReturnType<typeof syntheticCover>>;
beforeAll(async () => { cover = await syntheticCover(); });

const ENV = {};
function setup(actor: ServerAuthResult | (() => Promise<ServerAuthResult>) = verified(ACTOR_A), linked = true) {
  const fixture = syntheticStore(cover, [work(ACTOR_A, "neon-alley", 1), work(ACTOR_B, "other-owner", 2)]);
  const resolveAuth = vi.fn(typeof actor === "function" ? actor : async () => actor);
  const storeFactory = vi.fn(() => linked ? fixture.store : null);
  let clock = 1_790_000_000_000;
  const http = () => createAdminPublicationHttp({ resolveAuth, store: storeFactory, now: () => clock++, env: ENV });
  return { fixture, resolveAuth, storeFactory, http };
}
async function body(response: Response) { return response.json() as Promise<Record<string, unknown>>; }
function tracked(text: string) {
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
  return { stream };
}
const prepare = (seq: number, slug = "neon-alley") => JSON.stringify({ requestId: requestId(seq), command: "prepare", slug, expectedVersion: "0", generation: null, rightsConfirmed: true });

describe("T297 GET — 관리자 인증 뒤에만 목록", () => {
  it.each([
    [{ kind: "denied", status: 401, code: "AUTH_REQUIRED" } as const, 401],
    [{ kind: "denied", status: 403, code: "AUTH_FORBIDDEN" } as const, 403],
    [{ kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" } as const, 503],
    [{ kind: "local" } as const, 503],
  ])("인증 거절·로컬은 저장소를 열지 않고 no-store 오류(%o)", async (auth, status) => {
    const { http, storeFactory, fixture } = setup(auth);
    const response = await http().handleGet();
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(storeFactory).not.toHaveBeenCalled();
    expect(fixture.counts.transactions).toBe(0);
  });
  it("인증 확인 중 예외는 503 AUTH_UNAVAILABLE", async () => {
    const { http } = setup(async () => { throw new Error("auth down"); });
    const response = await http().handleGet();
    expect([response.status, (await body(response)).code]).toEqual([503, "AUTH_UNAVAILABLE"]);
  });
  it("운영 저장소 미준비(null)면 200 closed — 화면은 '게시 서버 미연결'만 보여요", async () => {
    const { http } = setup(verified(ACTOR_A), false);
    const response = await http().handleGet();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await body(response)).toEqual({ kind: "closed" });
  });
  it("기본값(운영)은 저장소가 없어 closed다", async () => {
    const response = await createAdminPublicationHttp({ resolveAuth: async () => verified(ACTOR_A), env: ENV }).handleGet();
    expect(await body(response)).toEqual({ kind: "closed" });
  });
  it("A(게시자)는 자기 작품만, B(게시자 아님)는 closed. 요청 하나에 인증 1회", async () => {
    const a = setup(verified(ACTOR_A));
    const list = await body(await a.http().handleGet());
    expect(isPublicationList(list)).toBe(true);
    expect((list.items as PublicationItem[]).map((item) => item.slug)).toEqual(["neon-alley"]);
    expect(a.resolveAuth).toHaveBeenCalledTimes(1);
    const b = setup(verified(ACTOR_B));
    expect(await body(await b.http().handleGet())).toEqual({ kind: "closed" });
  });
});

describe("T297 POST — 인가 전 본문 읽기 금지·형식·크기 제한", () => {
  it("다른 사이트·Origin 없음은 403, 저장소·본문 읽기 0(인증 판정 다음, 본문 전)", async () => {
    for (const headers of [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
      const { http, storeFactory } = setup();
      const request = post(tracked(prepare(1)).stream, headers);
      const response = await http().handlePost(request);
      expect([response.status, (await body(response)).code]).toEqual([403, "AUTH_ORIGIN_REJECTED"]);
      expect(storeFactory).not.toHaveBeenCalled();
      expect(request.bodyUsed).toBe(false);
    }
  });
  it("JSON이 아닌 형식은 415, 저장소 0", async () => {
    const { http, storeFactory } = setup();
    const response = await http().handlePost(post(prepare(1), { "content-type": "text/plain" }));
    expect(response.status).toBe(415);
    expect(storeFactory).not.toHaveBeenCalled();
  });
  it("인증 실패면 본문을 읽지 않고 401·403", async () => {
    for (const [auth, status] of [[{ kind: "denied", status: 401, code: "AUTH_REQUIRED" }, 401], [{ kind: "denied", status: 403, code: "AUTH_FORBIDDEN" }, 403]] as const) {
      const { http, fixture } = setup(auth);
      const request = post(tracked(prepare(1)).stream);
      const response = await http().handlePost(request);
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(request.bodyUsed).toBe(false);
      expect(fixture.counts.transactions).toBe(0);
    }
  });
  it("운영 저장소 미준비면 본문을 읽지 않고 503 PUBLICATION_UNLINKED, 쓰기 0", async () => {
    const { http, fixture } = setup(verified(ACTOR_A), false);
    const request = post(tracked(prepare(1)).stream);
    const response = await http().handlePost(request);
    expect([response.status, (await body(response)).code]).toEqual([503, "PUBLICATION_UNLINKED"]);
    expect(request.bodyUsed).toBe(false);
    expect(fixture.counts.transactions).toBe(0);
  });
  it("크기 제한: 선언 길이 초과·스트림 초과는 413, 서비스 0", async () => {
    const big = JSON.stringify({ pad: "x".repeat(PUBLICATION_BODY_LIMIT) });
    const declared = setup();
    expect((await declared.http().handlePost(post(big, { "content-length": String(big.length) }))).status).toBe(413);
    const streamed = setup();
    const { stream } = tracked(big);
    expect((await streamed.http().handlePost(post(stream))).status).toBe(413);
    expect(declared.fixture.counts.transactions + streamed.fixture.counts.transactions).toBe(0);
  });
  it("깨진 JSON·배열·깨진 UTF-8은 400, 서비스 0", async () => {
    for (const raw of ["{", "[]", "null"]) {
      const { http, fixture } = setup();
      expect((await http().handlePost(post(raw))).status).toBe(400);
      expect(fixture.counts.transactions).toBe(0);
    }
    const bad = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([0x7b, 0xff, 0x7d])); c.close(); } });
    expect((await setup().http().handlePost(post(bad))).status).toBe(400);
  });
  it("화면이 actor·owner를 넣어도 서비스가 invalid(계약 밖 필드)로 거절하고 쓰기 0", async () => {
    const { http, fixture } = setup();
    const forged = JSON.stringify({ ...JSON.parse(prepare(1)), actorId: ACTOR_B, ownerId: ACTOR_B });
    const response = await http().handlePost(post(forged));
    expect([response.status, await body(response)]).toEqual([200, { status: "invalid" }]);
    expect(fixture.counts.saves).toBe(0);
  });
});

describe("T297 POST — T289 UUID·상태 계약과 T290-F1 보존", () => {
  it("준비 → 게시 → 철회, 같은 UUID 재전송은 같은 결과(원장 재생, 저장 추가 0)", async () => {
    const { http, fixture } = setup();
    const send = async (raw: string) => body(await http().handlePost(post(raw)));
    expect(await send(prepare(10))).toEqual({ status: "prepared", version: "1", generation: "1" });
    const publish = JSON.stringify({ requestId: requestId(11), command: "complete", slug: "neon-alley", expectedVersion: "1", generation: "1", rightsConfirmed: true });
    expect(await send(publish)).toEqual({ status: "published", version: "2", generation: "1" });
    const saves = fixture.counts.saves;
    expect(await send(publish)).toEqual({ status: "published", version: "2", generation: "1" });
    expect(fixture.counts.saves).toBe(saves);
    const revoke = JSON.stringify({ requestId: requestId(12), command: "revoke", slug: "neon-alley", expectedVersion: "2", generation: "1", rightsConfirmed: false });
    expect(await send(revoke)).toEqual({ status: "revoked", version: "3", generation: "1" });
    const list = await body(await http().handleGet());
    expect((list.items as PublicationItem[])[0]).toMatchObject({ version: "3", pendingGeneration: null, activeGeneration: null });
  });
  it("커밋 전 실패는 unavailable(원장 없음) → 같은 UUID 재전송이 처리", async () => {
    const { http, fixture } = setup();
    fixture.hooks.failCommit = 1;
    expect(await body(await http().handlePost(post(prepare(20))))).toEqual({ status: "unavailable" });
    expect(fixture.snapshot().ledger.size).toBe(0);
    expect(await body(await http().handlePost(post(prepare(20))))).toEqual({ status: "prepared", version: "1", generation: "1" });
  });
  it("권리 증빙 없음은 source-unavailable로 원장에 고정, 증빙을 고쳐도 같은 UUID는 당시 결과", async () => {
    const { http, fixture } = setup();
    fixture.setEvidence("neon-alley", null);
    expect(await body(await http().handlePost(post(prepare(30))))).toEqual({ status: "source-unavailable" });
    fixture.setEvidence("neon-alley", undefined);
    expect(await body(await http().handlePost(post(prepare(30))))).toEqual({ status: "source-unavailable" });
    expect(fixture.snapshot().works[0].revision).toBe("0");
  });
  it("버전 충돌은 conflict, 같은 UUID에 다른 의도는 invalid", async () => {
    const { http } = setup();
    const stale = JSON.stringify({ requestId: requestId(40), command: "prepare", slug: "neon-alley", expectedVersion: "5", generation: null, rightsConfirmed: true });
    expect(await body(await http().handlePost(post(stale)))).toEqual({ status: "conflict" });
    const other = JSON.stringify({ requestId: requestId(40), command: "prepare", slug: "neon-alley", expectedVersion: "0", generation: null, rightsConfirmed: true });
    expect(await body(await http().handlePost(post(other)))).toEqual({ status: "invalid" });
  });
  it("B는 A 작품을 바꿀 수 없다(게시자 아님·다른 소유자 모두 denied), A 작품 그대로", async () => {
    const b = setup(verified(ACTOR_B));
    expect(await body(await b.http().handlePost(post(prepare(50))))).toEqual({ status: "denied" });
    b.fixture.publishers.add(ACTOR_B);
    expect(await body(await b.http().handlePost(post(prepare(51))))).toEqual({ status: "denied" });
    expect(b.fixture.snapshot().works[0]).toMatchObject({ slug: "neon-alley", revision: "0" });
    expect(b.fixture.counts.saves).toBe(0);
  });
});

describe("T297 동일 출처 HTTP 공급자", () => {
  const item: PublicationItem = { slug: "neon-alley", title: "합성", kind: "image", version: "0", pendingGeneration: null, activeGeneration: null, approvedMs: null, source: { revision: "11", finished: true }, rights: "confirmed" };
  const action = buildAction(item, "prepare", requestId(60), true)!;
  it("서버 경계에 그대로 연결하면 같은 출처·no-store·리다이렉트 거부로 보내고 결과를 받는다", async () => {
    const { http } = setup();
    const calls: RequestInit[] = [];
    const provider = createHttpPublicationProvider(async (url, init) => {
      calls.push(init);
      expect(url).toBe(PUBLICATION_ENDPOINT);
      if (init.method === "GET") return http().handleGet();
      return http().handlePost(post(init.body as string, { "content-type": String((init.headers as Record<string, string>)["content-type"]) }));
    });
    expect(await provider.list()).toMatchObject({ kind: "ok", items: [{ slug: "neon-alley", version: "0" }] });
    expect(await provider.apply(action)).toEqual({ status: "prepared", version: "1", generation: "1" });
    for (const init of calls) expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin", redirect: "error" });
    expect(JSON.parse(calls[1].body as string)).toEqual({ requestId: requestId(60), command: "prepare", slug: "neon-alley", expectedVersion: "0", generation: null, rightsConfirmed: true });
  });
  it("본문은 계약 필드만 담는다", () => {
    expect(Object.keys(JSON.parse(actionBody({ ...action, extra: "x" } as typeof action))).sort()).toEqual(["command", "expectedVersion", "generation", "requestId", "rightsConfirmed", "slug"]);
  });
  it.each([[401, "denied"], [403, "denied"], [400, "invalid"], [413, "invalid"], [415, "invalid"], [503, "unavailable"], [500, "unavailable"], [302, "unavailable"]])(
    "쓰기 HTTP %i → %s", async (status, expected) => {
      const provider = createHttpPublicationProvider(async () => new Response("{}", { status }));
      expect(await provider.apply(action)).toEqual({ status: expected });
    });
  it("네트워크·형식 오류: 쓰기는 unavailable(같은 UUID 재시도), 목록은 failed", async () => {
    const down = createHttpPublicationProvider(async () => { throw new TypeError("network"); });
    expect(await down.apply(action)).toEqual({ status: "unavailable" });
    expect(await down.list()).toEqual({ kind: "failed" });
    const odd = createHttpPublicationProvider(async () => Response.json({ status: "published", version: "x", generation: "1" }));
    expect(await odd.apply(action)).toEqual({ status: "unavailable" });
    for (const value of [{ kind: "ok" }, { kind: "ok", items: [item, item] }, { kind: "closed", extra: 1 }, { kind: "ok", items: [{ ...item, ownerEmail: "x" }] }]) {
      expect(await createHttpPublicationProvider(async () => Response.json(value)).list()).toEqual({ kind: "failed" });
    }
    expect(await createHttpPublicationProvider(async () => Response.json({ kind: "closed" }, { status: 401 })).list()).toEqual({ kind: "failed" });
  });
});

describe("T297 화면·라우트 소스", () => {
  it("관리자 화면은 인증 판정 뒤 같은 캐시 인증으로 첫 목록을 읽고, 보호 영역 안에 큐를 그린다", () => {
    const page = readFileSync("app/admin/page.tsx", "utf8");
    expect(page.indexOf("createAdminPublicationHttp({ resolveAuth: getRenderAuth }).list()")).toBeGreaterThan(page.indexOf('if (auth.kind === "denied")'));
    expect(page).toMatch(/<ProtectedContent>\s*<AdminHub email=\{account\} projects=\{projects\} review=\{<PublicationHttpQueue initial=\{publications\} \/>\} \/>\s*<\/ProtectedContent>/);
  });
  it("라우트는 서버 경계만 부르고 nodejs·동적이다", () => {
    const route = readFileSync("app/api/admin/publications/route.ts", "utf8");
    expect(route).toContain("createAdminPublicationHttp().handleGet()");
    expect(route).toContain("createAdminPublicationHttp().handlePost(request)");
    expect(route).toContain('export const runtime = "nodejs";');
  });
  it("화면 래퍼는 운영 표시(source=server)와 한 번 만든 HTTP 공급자를 쓴다", () => {
    const wrapper = readFileSync("components/admin/publication-http-queue.tsx", "utf8");
    expect(wrapper).toContain("useState(createHttpPublicationProvider)");
    expect(wrapper).toContain('source="server"');
    expect(wrapper).not.toMatch(/createMemoryPublicationProvider|synthetic/);
  });
  it("SITE 상수는 루프백 시험 주소다", () => { expect(SITE.startsWith("http://127.0.0.1:")).toBe(true); });
});

// T297-F1(T297-R F297-1·F297-2): Origin은 현재 요청의 실제 출처와 정확히 같아야 하고(별도 등록 출처도 거절, 전달 머리글 무시),
// 본문 초과 413은 취소 정리를 기다리지 않는다.
describe("T297-F1 출처는 현재 요청과 정확히 같아야 한다", () => {
  const TWO = { DREAM_SITE_URL: "https://a.example,https://b.example" };
  const request = (headers: Record<string, string>, raw = prepare(70)) => {
    const req = new Request("https://a.example/api/admin/publications", { method: "POST", body: raw, headers: { "content-type": "application/json", ...headers } });
    return req;
  };
  const run = async (env: Record<string, string | undefined>, headers: Record<string, string>, raw?: string) => {
    const fixture = syntheticStore(cover, [work(ACTOR_A, "neon-alley", 1)]);
    const storeFactory = vi.fn(() => fixture.store);
    const req = request(headers, raw);
    const response = await createAdminPublicationHttp({ resolveAuth: async () => verified(ACTOR_A), store: storeFactory, env }).handlePost(req);
    return { response, storeFactory, bodyUsed: req.bodyUsed, fixture };
  };
  it("두 출처가 등록돼도 현재 host와 다른 등록 출처는 403, 본문·저장소 0(Fetch Metadata 없음)", async () => {
    const { response, storeFactory, bodyUsed } = await run(TWO, { host: "a.example", origin: "https://b.example" }, "{");
    expect([response.status, (await body(response)).code]).toEqual([403, "AUTH_ORIGIN_REJECTED"]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(storeFactory).not.toHaveBeenCalled();
    expect(bodyUsed).toBe(false);
  });
  it("현재 host의 등록 출처와 같으면 통과해 서비스까지 간다(a·b 각각)", async () => {
    for (const site of ["a", "b"]) {
      const { response, fixture } = await run(TWO, { host: `${site}.example`, origin: `https://${site}.example` });
      expect(await body(response)).toEqual({ status: "prepared", version: "1", generation: "1" });
      expect(fixture.counts.saves).toBe(1);
    }
  });
  it("전달 머리글(x-forwarded-host·proto)로 출처를 바꿀 수 없다", async () => {
    const forwarded = await run(TWO, { host: "a.example", "x-forwarded-host": "b.example", "x-forwarded-proto": "https", origin: "https://b.example" }, "{");
    expect(forwarded.response.status).toBe(403);
    const scheme = await run(TWO, { host: "a.example", "x-forwarded-proto": "http", origin: "http://a.example" }, "{");
    expect(scheme.response.status).toBe(403);
    expect(forwarded.storeFactory).not.toHaveBeenCalled();
    expect(scheme.storeFactory).not.toHaveBeenCalled();
  });
  it("등록 안 된 host·Host 없음·같은 host에 scheme이 둘 등록되면 거절", async () => {
    expect((await run(TWO, { host: "evil.example", origin: "https://evil.example" }, "{")).response.status).toBe(403);
    expect((await run(TWO, { origin: "https://a.example" }, "{")).response.status).toBe(403);
    const both = { DREAM_SITE_URL: "https://a.example,http://a.example" };
    expect((await run(both, { host: "a.example", origin: "https://a.example" }, "{")).response.status).toBe(403);
  });
  it("루프백은 이 PC 실행에서만, 같은 host·포트일 때만", async () => {
    expect((await run({}, { host: "127.0.0.1:43297", origin: "http://127.0.0.1:43297" })).response.status).toBe(200);
    expect((await run({}, { host: "127.0.0.1:43297", origin: "http://localhost:43297" }, "{")).response.status).toBe(403);
    expect((await run({}, { host: "127.0.0.1:43297", origin: "http://127.0.0.1:43298" }, "{")).response.status).toBe(403);
    expect((await run({ VERCEL: "1" }, { host: "127.0.0.1:43297", origin: "http://127.0.0.1:43297" }, "{")).response.status).toBe(403);
  });
  it("Fetch Metadata가 same-origin이 아니면 같은 Origin이어도 거절, JSON 아니면 415", async () => {
    expect((await run(TWO, { host: "a.example", origin: "https://a.example", "sec-fetch-site": "same-site" }, "{")).response.status).toBe(403);
    expect((await run(TWO, { host: "a.example", origin: "https://a.example", "content-type": "text/plain" }, "{")).response.status).toBe(415);
  });
  it("인증이 먼저다: 출처가 틀려도 로그인 없음은 401", async () => {
    const response = await createAdminPublicationHttp({ resolveAuth: async () => ({ kind: "denied", status: 401, code: "AUTH_REQUIRED" }), env: TWO })
      .handlePost(request({ host: "a.example", origin: "https://b.example" }));
    expect(response.status).toBe(401);
  });
});

describe("T297-F1 본문 초과 413은 취소 정리를 기다리지 않는다", () => {
  const within = <T>(promise: Promise<T>, ms: number) => Promise.race([promise, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms))]);
  const overStream = (cancel: () => Promise<void>, endless = false) => {
    const calls = { cancel: 0 };
    const chunk = new Uint8Array(600).fill(0x20);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(chunk); controller.enqueue(chunk); if (!endless) { /* 끝을 알리지 않은 미완료 스트림 */ } },
      pull(controller) { if (endless) controller.enqueue(chunk); },
      cancel() { calls.cancel++; return cancel(); },
    });
    return { stream, calls };
  };
  for (const [name, cancel] of [
    ["취소가 끝나지 않음", () => new Promise<void>(() => undefined)],
    ["취소가 실패", () => Promise.reject(new Error("cancel failed"))],
    ["취소가 느림(2초)", () => new Promise<void>((resolve) => setTimeout(resolve, 2000))],
  ] as const) {
    it(`${name}: 미완료 스트림에서도 바로 413, 취소 호출, 저장소 0`, async () => {
      const { http, fixture } = setup();
      const { stream, calls } = overStream(cancel);
      const result = await within(http().handlePost(post(stream)), 150);
      expect(result).not.toBe("timeout");
      const response = result as Response;
      expect([response.status, (await body(response)).code]).toEqual([413, "PAYLOAD_TOO_LARGE"]);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(calls.cancel).toBe(1);
      expect(fixture.counts.transactions).toBe(0);
    });
  }
  it("끝없이 이어지는 스트림도 상한에서 멈추고 413", async () => {
    const { http, fixture } = setup();
    const { stream, calls } = overStream(() => new Promise<void>(() => undefined), true);
    const result = await within(http().handlePost(post(stream)), 150);
    expect((result as Response).status).toBe(413);
    expect(calls.cancel).toBe(1);
    expect(fixture.counts.transactions).toBe(0);
  });
  it("상한 이하(1024바이트 정확히)는 읽어서 처리한다", async () => {
    const { http } = setup();
    const raw = prepare(80);
    const padded = raw.slice(0, -1) + " ".repeat(PUBLICATION_BODY_LIMIT - raw.length) + "}";
    expect(new TextEncoder().encode(padded).length).toBe(PUBLICATION_BODY_LIMIT);
    expect(await body(await http().handlePost(post(padded)))).toEqual({ status: "prepared", version: "1", generation: "1" });
  });
});
