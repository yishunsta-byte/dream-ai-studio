import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createAnalysisCredentialStores, readGeminiCredentialKeyRing, type StyleDnaGenerationCredentialStore } from "@/lib/reference-analysis/analysis-credential-store";
import {
  styleDnaGenerationCredentialPath, styleDnaGenerationKey, styleDnaGenerationKeyCharacters, styleDnaGenerationKeyLimits,
} from "@/lib/reference-analysis/style-dna-generation-credential-contract";
import {
  acceptsGenerationKey, styleDnaGenerationCredentialPath as clientPath, styleDnaGenerationProviders,
} from "@/components/admin/style-dna-generation-credentials-client";
import { createStyleDnaGenerationCredentialHttp } from "@/lib/reference-analysis/style-dna-generation-credential-http";
import { runtimeGenerationCredentials, runtimeImageGenerators, seedreamRuntimeCredentials } from "@/lib/reference-analysis/style-dna-generation-runtime";
import { seedreamEndpoint } from "@/lib/reference-analysis/style-dna-seedream-provider";
import { fluxEndpoint } from "@/lib/reference-analysis/style-dna-flux-provider";

vi.mock("server-only", () => ({}));

const origin = "https://studio.example.invalid";
const owner = "10000000-0000-4000-8000-000000000001";
const actor = { kind: "verified", userId: owner, email: "admin@example.invalid" } as const;
// 합성 키(형식만 흉내): UUID형과 영숫자·기호형.
const uuidKey = "0f3c2a1e-9b7d-4c55-8e21-6a0b9c8d7e6f";
const legacyKey = "ark-synthetic_Key.0123456789ABCDEF";
// BFL 공식 문서의 형식 bfl_<random-string>을 흉내 낸 합성 키(길이·글자는 문서에 없어 공통 규칙 안에서 만든다).
const bflKey = "bfl_SyntheticKey0123456789abcdefXYZ";
const updatedAt = "2026-11-25T00:00:00.000Z";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const put = (value: unknown, headers: Record<string, string> = {}) => new Request(origin + styleDnaGenerationCredentialPath, {
  method: "PUT", headers: { origin, host: "studio.example.invalid", "content-type": "application/json", ...headers },
  body: typeof value === "string" ? value : JSON.stringify(value),
});
function fakeStore(initial?: number) {
  let version = initial ?? 0;
  const keys: string[] = [];
  const store = {
    metadata: vi.fn(async () => version ? { byteplus: { version, updatedAt } } : {}),
    write: vi.fn(async (_owner: string, _provider: "byteplus" | "bfl", apiKey: string, expected: number) => {
      if (expected !== version) return "stale" as const;
      keys.push(apiKey);
      version = expected + 1;
      return { version, updatedAt };
    }),
  };
  return { store, keys };
}
const http = (store: ReturnType<typeof fakeStore>["store"] | null, auth: unknown = actor) => createStyleDnaGenerationCredentialHttp({
  authenticate: async () => auth as typeof actor, env: { DREAM_SITE_URL: origin }, store: () => store,
});
async function read(response: Response) {
  const text = await response.text();
  return { status: response.status, cache: response.headers.get("cache-control"), text, body: JSON.parse(text) as Record<string, unknown> };
}

describe("생성 키 형식", () => {
  it("새·기존 형식은 받고 공백·제어 문자·비ASCII·길이 밖은 거절한다", () => {
    for (const key of [uuidKey, legacyKey, "A".repeat(16), "x".repeat(256), "AKLT-abc_DEF.ghi~jkl/mno+pqr="]) {
      expect(styleDnaGenerationKey.safeParse(key).success, key.slice(0, 8)).toBe(true);
    }
    for (const key of ["short-key-15chr", "x".repeat(257), ` ${uuidKey}`, `${uuidKey} `, "abc def ghij klmnop", `${uuidKey}\n`,
      `${uuidKey}\t`, `${uuidKey}\0`, `${uuidKey}\u007f`, `${uuidKey}\u00e9`, `${uuidKey}\u200b`, ""]) {
      expect(styleDnaGenerationKey.safeParse(key).success).toBe(false);
    }
  });
});

// 공통 계약 경계표(RFC 6750 b64token 문자, 16~256자). 화면 판정(acceptsGenerationKey)과 서버 PUT이 같은 답을 내야 한다.
const sharedAccepted: [string, string][] = [
  ["UUID형", uuidKey], ["기존 영숫자·기호형", legacyKey], ["새 ark 형식", "ark-6f1d0c9e-2b7a-4c3e-9d58-0a1b2c3d4e5f-synthetic"],
  ["합성 Bearer 패딩 1개", "c3ludGhldGljLWJ5dGVwbHVzLWtleQ="], ["합성 Bearer 패딩 2개", "c3ludGhldGljLWtleS0wMDAx=="],
  ["토큰 기호 전부", "AKLT-abc_DEF.ghi~jkl/mno+pqr="], ["하한 16자", "A".repeat(16)], ["상한 256자", "x".repeat(255) + "="],
];
const sharedRejected: [string, string][] = [
  ["15자", "A".repeat(15)], ["257자(잘라 받지 않음)", "x".repeat(257)], ["앞 공백", ` ${uuidKey}`], ["뒤 공백", `${uuidKey} `],
  ["뒤 개행", `${uuidKey}\n`], ["뒤 CRLF", `${uuidKey}\r\n`], ["가운데 개행", "synthetic-part-1\nsynthetic-part-2"], ["탭", `${uuidKey}\t`],
  ["중간 공백", "abc def ghij klmnop"], ["NUL", `${uuidKey}\0`], ["DEL", `${uuidKey}\u007f`], ["비ASCII", `${uuidKey}\u00e9`],
  ["폭 없는 공백", `${uuidKey}\u200b`], ["쉼표", "synthetic-key-0001,synthetic-key-0002"], ["중간 패딩", "c3ludGhldGlj=LWtleS0wMDAx"],
  ["패딩만", "=".repeat(16)], ["콜론", "synthetic:key:0001:abcd"], ["따옴표", '"synthetic-key-0001-abcd"'], ["Bearer 머리말 포함", `Bearer ${uuidKey}`],
  ["빈 값", ""],
];

describe("생성 키 공통 판정(화면·서버)", () => {
  it("경계표의 받음·거절이 계약·화면 판정·서버 PUT에서 모두 같고, 거절은 저장소를 부르지 않는다", async () => {
    for (const [name, key] of sharedAccepted) {
      expect([name, styleDnaGenerationKey.safeParse(key).success, acceptsGenerationKey(key)]).toEqual([name, true, true]);
      const { store, keys } = fakeStore();
      const answer = await read(await http(store).put(put({ provider: "byteplus", expectedVersion: 0, apiKey: key })));
      expect([name, answer.status]).toEqual([name, 200]);
      expect(keys).toEqual([key]);
    }
    for (const [name, key] of sharedRejected) {
      expect([name, styleDnaGenerationKey.safeParse(key).success, acceptsGenerationKey(key)]).toEqual([name, false, false]);
      const { store } = fakeStore();
      const answer = await read(await http(store).put(put({ provider: "byteplus", expectedVersion: 0, apiKey: key })));
      expect([name, answer.status, answer.body]).toEqual([name, 422, { code: "invalid_key" }]);
      expect(store.write).not.toHaveBeenCalled();
    }
  });

  it("화면은 서버와 같은 등록 경로·공급자·한도를 쓰고, 붙여 넣는 원문 검사는 키 글자 밖을 막는다", () => {
    expect(clientPath).toBe(styleDnaGenerationCredentialPath);
    expect([...styleDnaGenerationProviders]).toEqual(["byteplus", "bfl", "openai"]);
    expect(styleDnaGenerationKeyLimits).toEqual({ min: 16, max: 256 });
    for (const [, key] of sharedAccepted) expect(styleDnaGenerationKeyCharacters(key)).toBe(true);
    for (const text of [`${uuidKey}\n`, `${uuidKey} `, "a,b", `${uuidKey}\u00e9`, "part-1\r\npart-2"]) expect(styleDnaGenerationKeyCharacters(text)).toBe(false);
  });
});

describe("GET/PUT /api/admin/style-dna/generation-credentials", () => {
  it("등록 전·후 상태는 메타데이터만이고, 저장은 공급자 호출 없이 한 번 쓴다", async () => {
    const outbound = vi.fn(async () => { throw new Error("no network in this test"); });
    vi.stubGlobal("fetch", outbound);
    const { store, keys } = fakeStore();
    const api = http(store);
    expect(await read(await api.get())).toMatchObject({ status: 200, cache: "private, no-store",
      body: { providers: { byteplus: { configured: false, version: 0, updatedAt: null }, bfl: { configured: false, version: 0, updatedAt: null }, openai: { configured: false, version: 0, updatedAt: null } } } });
    const saved = await read(await api.put(put({ provider: "byteplus", expectedVersion: 0, apiKey: uuidKey })));
    expect(saved).toMatchObject({ status: 200, cache: "private, no-store",
      body: { provider: "byteplus", setting: { configured: true, version: 1, updatedAt } } });
    const rotated = await read(await api.put(put({ provider: "byteplus", expectedVersion: 1, apiKey: legacyKey })));
    expect(rotated.body).toEqual({ provider: "byteplus", setting: { configured: true, version: 2, updatedAt } });
    const status = await read(await api.get());
    expect(status.body).toEqual({ providers: { byteplus: { configured: true, version: 2, updatedAt }, bfl: { configured: false, version: 0, updatedAt: null }, openai: { configured: false, version: 0, updatedAt: null } } });
    expect(keys).toEqual([uuidKey, legacyKey]);
    expect(store.write).toHaveBeenCalledWith(owner, "byteplus", uuidKey, 0);
    for (const answer of [saved, rotated, status]) {
      for (const key of [uuidKey, legacyKey]) for (const part of [key, key.slice(0, 6), key.slice(-6)]) expect(answer.text).not.toContain(part);
      expect(answer.text).not.toMatch(/apiKey|keyHint|length/i);
    }
    expect(outbound).not.toHaveBeenCalled();
  });

  it("옛 버전 저장(키 회전 경합)은 409 stale이고 저장하지 않는다", async () => {
    const { store, keys } = fakeStore(3);
    const api = http(store);
    expect((await read(await api.put(put({ provider: "byteplus", expectedVersion: 2, apiKey: uuidKey })))).body).toEqual({ code: "stale" });
    expect((await read(await api.put(put({ provider: "byteplus", expectedVersion: 0, apiKey: uuidKey })))).status).toBe(409);
    expect(keys).toEqual([]);
    const answers = await Promise.all([1, 2].map(() => api.put(put({ provider: "byteplus", expectedVersion: 3, apiKey: legacyKey }))));
    expect(answers.map(answer => answer.status).sort()).toEqual([200, 409]);
    expect(keys).toEqual([legacyKey]);
  });

  it("모양 오류는 400, 키 글자 오류는 422 invalid_key이고 둘 다 저장소를 부르지 않는다", async () => {
    const { store } = fakeStore();
    const api = http(store);
    for (const body of [{ provider: "anthropic", expectedVersion: 0, apiKey: uuidKey }, { provider: "byteplus", expectedVersion: -1, apiKey: uuidKey },
      { provider: "byteplus", expectedVersion: 0 }, { provider: "byteplus", expectedVersion: 0, apiKey: uuidKey, modelId: "seedream" },
      { provider: "byteplus", expectedVersion: 1.5, apiKey: uuidKey }, { provider: "byteplus", expectedVersion: 0, apiKey: 12345 }, "{oops"]) {
      expect((await read(await api.put(put(body)))).body).toEqual({ code: "invalid_input" });
    }
    for (const apiKey of [`${uuidKey} `, `${uuidKey}\n`, "short", "x".repeat(300), `${uuidKey}\u00e9`]) {
      const answer = await read(await api.put(put({ provider: "byteplus", expectedVersion: 0, apiKey })));
      expect([answer.status, answer.body]).toEqual([422, { code: "invalid_key" }]);
      expect(answer.text).not.toContain(apiKey.trim());
    }
    expect((await api.put(put("x".repeat(9000)))).status).toBe(413);
    expect(store.metadata).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });

  it("미로그인·외부 출처·저장소 없음·저장소 오류는 각각 401·403·503이다", async () => {
    const { store } = fakeStore();
    expect((await http(store, { kind: "local" }).get()).status).toBe(401);
    expect((await http(store, { kind: "denied", code: "AUTH_FORBIDDEN", status: 403 }).put(put({ provider: "byteplus", expectedVersion: 0, apiKey: uuidKey }))).status).toBe(403);
    expect((await http(store).put(put({ provider: "byteplus", expectedVersion: 0, apiKey: uuidKey }, { origin: "https://outside.example.invalid" }))).status).toBe(403);
    expect((await http(store).put(put({ provider: "byteplus", expectedVersion: 0, apiKey: uuidKey }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(store.write).not.toHaveBeenCalled();
    expect((await read(await http(null).get())).body).toEqual({ code: "storage_unavailable" });
    expect((await read(await http(null).put(put({ provider: "byteplus", expectedVersion: 0, apiKey: uuidKey })))).body).toEqual({ code: "storage_unavailable" });
    const broken = { metadata: vi.fn(async () => { throw new Error(`db down ${uuidKey}`); }), write: vi.fn(async () => { throw new Error(`db down ${uuidKey}`); }) };
    for (const response of [await http(broken).get(), await http(broken).put(put({ provider: "byteplus", expectedVersion: 0, apiKey: uuidKey }))]) {
      const answer = await read(response);
      expect([answer.status, answer.body]).toEqual([503, { code: "storage_unavailable" }]);
      expect(answer.text).not.toContain(uuidKey);
    }
  });
});

describe("기본 생성기 지연 연결", () => {
  const fullStore = (saved?: { version: number; apiKey: string }): StyleDnaGenerationCredentialStore => ({
    metadata: vi.fn(async () => saved ? { byteplus: { version: saved.version, updatedAt } } : {}),
    open: vi.fn(async () => saved && { version: saved.version, updatedAt, apiKey: saved.apiKey }),
    whileCurrent: vi.fn(async (_owner, _provider, version, run) => saved?.version === version ? run() : undefined),
    write: vi.fn(),
  });

  it("만들 때는 저장소를 열지 않고, 요청마다 연다. 저장소가 없으면 미등록과 같다", async () => {
    const open = vi.fn(() => null);
    const generators = runtimeImageGenerators({ store: open, send: vi.fn() });
    expect(open).not.toHaveBeenCalled();
    const credentials = generators.seedream.credentials;
    expect(await credentials.metadata?.(owner)).toBeUndefined();
    expect(await credentials.open(owner)).toBeUndefined();
    expect(await credentials.whileCurrent(owner, 1, async () => "saved")).toBeUndefined();
    expect(open).toHaveBeenCalledTimes(3);
  });

  it("등록된 계정만 버전을 주고, 목록용 metadata는 키를 열지 않으며, 확정은 같은 버전에서만 실행한다", async () => {
    const store = fullStore({ version: 4, apiKey: uuidKey });
    const credentials = seedreamRuntimeCredentials(() => store);
    expect(await credentials.metadata?.(owner)).toEqual({ version: 4 });
    expect(store.open).not.toHaveBeenCalled();
    expect(await credentials.open(owner)).toEqual({ apiKey: uuidKey, version: 4 });
    expect(store.open).toHaveBeenCalledWith(owner, "byteplus");
    expect(await credentials.whileCurrent(owner, 4, async () => "saved")).toBe("saved");
    expect(await credentials.whileCurrent(owner, 3, async () => "saved")).toBeUndefined();
    expect(await seedreamRuntimeCredentials(() => fullStore()).metadata?.(owner)).toBeUndefined();
    const failing = seedreamRuntimeCredentials(() => { throw new Error("half configured"); });
    await expect(failing.open(owner)).rejects.toThrow();
  });

  it("BFL 키는 FLUX.2 생성기에만 연결되고 BytePlus 키와 버전을 섞지 않는다", async () => {
    const opened: string[] = [];
    const store = {
      metadata: vi.fn(async () => ({ byteplus: { version: 7, updatedAt }, bfl: { version: 2, updatedAt } })),
      open: vi.fn(async (_owner: string, provider: "byteplus" | "bfl") => { opened.push(provider);
        return provider === "bfl" ? { version: 2, updatedAt, apiKey: bflKey } : { version: 7, updatedAt, apiKey: uuidKey }; }),
      whileCurrent: vi.fn(async (_owner: string, provider: "byteplus" | "bfl", version: number, run: () => Promise<unknown>) =>
        (provider === "bfl" ? version === 2 : version === 7) ? run() : undefined),
      write: vi.fn(),
    } as unknown as StyleDnaGenerationCredentialStore;
    const generators = runtimeImageGenerators({ store: () => store, send: vi.fn() });
    expect(await generators.flux.credentials.metadata?.(owner)).toEqual({ version: 2 });
    expect(await generators.seedream.credentials.metadata?.(owner)).toEqual({ version: 7 });
    expect(await generators.flux.credentials.open(owner)).toEqual({ apiKey: bflKey, version: 2 });
    expect(await generators.seedream.credentials.open(owner)).toEqual({ apiKey: uuidKey, version: 7 });
    expect(opened).toEqual(["bfl", "byteplus"]);
    expect(await generators.flux.credentials.whileCurrent(owner, 7, async () => "saved")).toBeUndefined();
    expect(await generators.flux.credentials.whileCurrent(owner, 2, async () => "saved")).toBe("saved");
    const onlyByteplus = { ...store, metadata: vi.fn(async () => ({ byteplus: { version: 7, updatedAt } })) } as unknown as StyleDnaGenerationCredentialStore;
    expect(await runtimeGenerationCredentials(() => onlyByteplus, "bfl").metadata?.(owner)).toBeUndefined();
  });

  it("BFL 키는 공통 규칙으로 받고, BytePlus와 따로 저장·조회된다", async () => {
    expect(styleDnaGenerationKey.safeParse(bflKey).success).toBe(true);
    expect(acceptsGenerationKey(bflKey)).toBe(true);
    for (const bad of [`${bflKey} `, "bfl_short", `bfl_${"x".repeat(253)}`, "bfl_key with space0001"]) expect(styleDnaGenerationKey.safeParse(bad).success).toBe(false);
    const saved: Record<string, number> = {};
    const store = {
      metadata: vi.fn(async () => Object.fromEntries(Object.entries(saved).map(([provider, version]) => [provider, { version, updatedAt }]))),
      write: vi.fn(async (_owner: string, provider: string, _apiKey: string, expected: number) => {
        if ((saved[provider] ?? 0) !== expected) return "stale" as const;
        saved[provider] = expected + 1;
        return { version: expected + 1, updatedAt };
      }),
    };
    const api = http(store as never);
    expect((await read(await api.put(put({ provider: "bfl", expectedVersion: 0, apiKey: bflKey })))).body)
      .toEqual({ provider: "bfl", setting: { configured: true, version: 1, updatedAt } });
    expect((await read(await api.put(put({ provider: "bfl", expectedVersion: 0, apiKey: bflKey })))).body).toEqual({ code: "stale" });
    expect((await read(await api.put(put({ provider: "byteplus", expectedVersion: 0, apiKey: uuidKey })))).status).toBe(200);
    expect((await read(await api.get())).body).toEqual({ providers: { byteplus: { configured: true, version: 1, updatedAt },
      bfl: { configured: true, version: 1, updatedAt }, openai: { configured: false, version: 0, updatedAt: null } } });
    expect((await read(await api.put(put({ provider: "bfl", expectedVersion: 1, apiKey: `${bflKey}\n` })))).body).toEqual({ code: "invalid_key" });
    expect(store.write).toHaveBeenCalledWith(owner, "bfl", bflKey, 0);
    const text = JSON.stringify(store.metadata.mock.results) + (await (await api.get()).text());
    expect(text).not.toContain(bflKey);
  });

  it("FLUX.2 어댑터는 주입한 전송 함수로 BFL 생성 주소에만 x-key로 보낸다", async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json({ detail: "unauthorized" }, { status: 401 }));
    const { flux } = runtimeImageGenerators({ store: () => null, send });
    await expect(flux.adapter.generate({ apiKey: bflKey, prompt: "a red bicycle" })).rejects.toMatchObject({ code: "provider_rejected" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(fluxEndpoint);
    expect(new Headers(send.mock.calls[0][1]?.headers).get("x-key")).toBe(bflKey);
  });

  it("어댑터는 주입한 전송 함수로 BytePlus 생성 주소에만 보낸다", async () => {
    const send = vi.fn<typeof fetch>(async () => Response.json({ error: { code: "AuthenticationError" } }, { status: 401 }));
    const { seedream } = runtimeImageGenerators({ store: () => null, send });
    await expect(seedream.adapter.generate({ apiKey: uuidKey, prompt: "a red bicycle" })).rejects.toMatchObject({ code: "provider_rejected" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(seedreamEndpoint);
  });
});

describe("키 저장소 거래 중 연결 끊김", () => {
  it("결과 저장을 기다리는 동안 빌린 연결이 끊겨도 처리되지 않은 오류가 없고, 저장소 오류로 끝나며 연결을 버린다", async () => {
    const client = Object.assign(new EventEmitter(), {
      release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (/^(COMMIT|ROLLBACK)/.test(sql)) throw new Error("Connection terminated unexpectedly");
        if (sql.includes("AS allowed")) return { rows: [{ allowed: true }], rowCount: 1 };
        if (sql.includes("FOR SHARE")) return { rows: [{}], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    });
    const ring = readGeminiCredentialKeyRing(JSON.stringify({ primary: "k1", keys: { k1: Buffer.alloc(32, 7).toString("base64url") } }));
    const { generators } = createAnalysisCredentialStores({ connect: async () => client } as never, ring);
    const run = vi.fn(async () => {
      // 실제 소켓처럼 다음 차례에 error 이벤트를 낸다. 듣는 곳이 없으면 처리되지 않은 예외가 된다(Node의 error 이벤트 규칙).
      await new Promise<void>(resolve => setImmediate(() => { client.emit("error", new Error("read ECONNRESET")); resolve(); }));
      return "saved";
    });
    await expect(generators.whileCurrent(owner, "byteplus", 2, run)).rejects.toThrow("Analysis credential store unavailable");
    expect(run).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(client.listenerCount("error")).toBe(0);
  });
});
