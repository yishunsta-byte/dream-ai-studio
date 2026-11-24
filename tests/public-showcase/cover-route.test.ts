import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverAddress } from "@/lib/public-showcase/cover-path";
import { COVER_MAX_BYTES, COVER_SOURCE, serveCover, type CoverRow, type CoverSource, type CoverStore } from "@/lib/public-showcase/cover-source";
import { SAMPLE_WORKS, type ShowcaseWork } from "@/lib/public-showcase/works";

// T-254 공개 커버 이미지 제공. 합성 공급원·합성 WebP만 쓰며 실제 DB·Storage·운영 자료는 읽지 않는다.
// 기대값 근거: 설계 c9d5674 §1~§4, Master 결정 msg_6a6d2cd8c99a(비활성 404·활성 실패 503·확인된 부재/철회 404·인증 전 405).
const { auth } = vi.hoisted(() => ({ auth: { user: null as null | { email: string }, getUser: 0 } }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => { auth.getUser++; return { data: { user: auth.user } }; } } }),
}));

const root = resolve(__dirname, "../..");
const ORIGIN = "https://studio.test";
const URL_A1 = "/media/public/neon-demo/1/cover.webp";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const rowFor = (address: CoverAddress, bytes: Uint8Array): CoverRow => ({ objectKey: `${address.slug}/${address.generation}/${sha(bytes)}.webp`, mime: "image/webp", sizeBytes: bytes.length, sha: sha(bytes) });

function u24(n: number) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255]; }
function chunk(tag: string, payload: Uint8Array) {
  const head = Buffer.alloc(8); head.write(tag, 0, "ascii"); head.writeUInt32LE(payload.length, 4);
  return Buffer.concat([head, Buffer.from(payload), Buffer.alloc(payload.length % 2)]);
}
function riff(body: Buffer) { const head = Buffer.alloc(8); head.write("RIFF", 0, "ascii"); head.writeUInt32LE(body.length, 4); return new Uint8Array(Buffer.concat([head, body])); }

let webp: Uint8Array;
let webp2: Uint8Array;
let animated: Uint8Array;
let png: Uint8Array;
let wide4096: Uint8Array;
let wide4097: Uint8Array;
beforeAll(async () => {
  webp = new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#ff00aa" } }).webp().toBuffer());
  webp2 = new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: "#00ccff" } }).webp().toBuffer());
  png = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ffffff" } }).png().toBuffer());
  wide4096 = new Uint8Array(await sharp({ create: { width: 4096, height: 1, channels: 3, background: "#000000" } }).webp().toBuffer());
  wide4097 = new Uint8Array(await sharp({ create: { width: 4097, height: 1, channels: 3, background: "#000000" } }).webp().toBuffer());
  // 정지 WebP 프레임 2개로 만든 애니메이션 WebP(VP8X 애니메이션 표시 + ANIM + ANMF 2개).
  const frame = Buffer.from(await sharp({ create: { width: 8, height: 6, channels: 3, background: "#00aaff" } }).webp().toBuffer()).subarray(12);
  const anmf = () => chunk("ANMF", Buffer.concat([Buffer.from([...u24(0), ...u24(0), ...u24(7), ...u24(5), ...u24(100), 0]), frame]));
  animated = riff(Buffer.concat([Buffer.from("WEBP"), chunk("VP8X", Buffer.from([0x02, 0, 0, 0, ...u24(7), ...u24(5)])), chunk("ANIM", Buffer.alloc(6)), anmf(), anmf()]));
});

// 합성 공급원: slug마다 활성 세대 하나(T-253 find_cover처럼 정확히 일치할 때만 행을 준다).
type Slot = { generation: string; bytes: Uint8Array; row?: Partial<CoverRow> | unknown; stored?: Uint8Array | null };
function synthetic() {
  const slots = new Map<string, Slot>();
  const calls = { find: 0, read: 0, keys: [] as string[] };
  const store: CoverStore = {
    async findCover(address) {
      calls.find++;
      const slot = slots.get(address.slug);
      if (!slot || slot.generation !== address.generation) return null;
      return (slot.row === undefined ? rowFor(address, slot.bytes) : { ...rowFor(address, slot.bytes), ...(slot.row as object) }) as CoverRow;
    },
    async readObject(objectKey, { maxBytes }) {
      calls.read++; calls.keys.push(objectKey);
      for (const [slug, slot] of slots) {
        if (objectKey.startsWith(`${slug}/${slot.generation}/`)) {
          const bytes = slot.stored === undefined ? slot.bytes : slot.stored;
          if (bytes === null) throw new Error("object missing");
          if (bytes.length > maxBytes) throw new Error("too large");
          return bytes;
        }
      }
      throw new Error("object missing");
    },
  };
  const source: CoverSource = { mode: "active", store };
  return { slots, calls, store, source };
}
const get = (path: string, init: RequestInit = {}) => new Request(new URL(path, ORIGIN), init);

describe("final authority for guarded public covers", () => {
  const address = { slug: "neon-demo", generation: "1" };

  it("checks authority only after valid bytes and keeps the verified response copy", async () => {
    const payload = Uint8Array.from(webp);
    const expected = rowFor(address, payload);
    const confirmCover = vi.fn<NonNullable<CoverStore["confirmCover"]>>().mockImplementation(async () => {
      payload.fill(0);
      return true;
    });
    const readObject = vi.fn<CoverStore["readObject"]>().mockResolvedValueOnce(png).mockResolvedValueOnce(payload);
    const source: CoverSource = { mode: "active", store: { findCover: async () => expected, readObject, confirmCover } };
    expect((await serveCover(get(URL_A1), source)).status).toBe(503);
    expect(confirmCover).not.toHaveBeenCalled();
    const response = await serveCover(get(URL_A1), source);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(webp);
    expect(confirmCover).toHaveBeenCalledExactlyOnceWith(address, expected, expect.any(AbortSignal));
  });

  it.each(["GET", "HEAD"])("returns an empty 404 without image metadata for a changed %s authority", async method => {
    const source: CoverSource = { mode: "active", store: {
      findCover: async () => rowFor(address, webp), readObject: async () => webp, confirmCover: async () => false,
    } };
    const response = await serveCover(get(URL_A1, { method }), source);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it.each(["cancel", "deadline"] as const)("closes while final authority is pending on %s", async mode => {
    const controller = new AbortController();
    const waiting = Promise.withResolvers<AbortSignal>();
    const late = Promise.withResolvers<boolean>();
    const source: CoverSource = { mode: "active", store: { findCover: async () => rowFor(address, webp), readObject: async () => webp,
      confirmCover(_address, _expected, signal) { waiting.resolve(signal); return late.promise; },
    } };
    const pending = serveCover(get(URL_A1, { signal: controller.signal }), source, mode === "deadline" ? 200 : 2000);
    try {
      const signal = await Promise.race([waiting.promise, pending.then(() => { throw new Error("Final guard was not reached"); })]);
      if (mode === "cancel") controller.abort();
      const response = await pending;
      expect(signal.aborted).toBe(true);
      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).not.toBe("image/webp");
      expect(response.headers.get("content-length")).toBeNull();
      expect(await response.text()).toBe("Service Unavailable");
    } finally { late.resolve(true); }
  });
});

describe("T-254 운영 공급원(지금 비활성)", () => {
  it("기본 공급원은 비활성이고 정규 주소도 404·no-store", async () => {
    expect(COVER_SOURCE).toEqual({ mode: "inactive" });
    expect(Object.isFrozen(COVER_SOURCE)).toBe(true);
    for (const method of ["GET", "HEAD"]) {
      const response = await serveCover(get(URL_A1, { method }));
      expect(response.status, method).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("공급원은 코드의 고정 값 하나로만 정해진다(환경변수·요청 값 선택·시험용 우회 없음)", () => {
    const source = readFileSync(resolve(root, "lib/public-showcase/cover-source.ts"), "utf8").replace(/\/\/.*$/gm, "");
    expect(source).toContain('export const COVER_SOURCE: CoverSource = Object.freeze({ mode: "inactive" });');
    expect(source).not.toMatch(/process\.env|searchParams|headers\.get|cookies|service.?role|supabase|createSignedUrl|fetch\(/i);
    expect([...source.matchAll(/^import\s+(?:.*\s+from\s+)?"([^"]+)";$/gm)].map((match) => match[1])).toEqual(["server-only", "./playback-source", "node:crypto", "node:events", "sharp", "@/lib/public-showcase/cover-path"]);
  });
});

describe("T-254 활성 공급원: 같은 주소에서 승인 전 404 → 활성 200 → 철회 후 404", () => {
  it("승인 전·활성·철회·교체 뒤 과거 세대", async () => {
    const { slots, source, calls } = synthetic();
    expect((await serveCover(get(URL_A1), source)).status).toBe(404);

    slots.set("neon-demo", { generation: "1", bytes: webp });
    const ok = await serveCover(get(URL_A1), source);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(ok.headers.get("content-length")).toBe(String(webp.length));
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await ok.arrayBuffer()).equals(Buffer.from(webp))).toBe(true);
    expect(calls.keys).toEqual([`neon-demo/1/${sha(webp)}.webp`]);
    for (const [name, value] of ok.headers) expect(`${name}: ${value}`).not.toMatch(/neon-demo\/1|[a-f0-9]{64}|sign|token|key/i);

    slots.delete("neon-demo");
    expect((await serveCover(get(URL_A1), source)).status).toBe(404);

    slots.set("neon-demo", { generation: "2", bytes: webp2 });
    expect((await serveCover(get(URL_A1), source)).status).toBe(404);
    expect((await serveCover(get("/media/public/neon-demo/2/cover.webp"), source)).status).toBe(200);
    expect((await serveCover(get("/media/public/neon-demo/3/cover.webp"), source)).status).toBe(404);
    expect((await serveCover(get("/media/public/other/2/cover.webp"), source)).status).toBe(404);
  });

  it("HEAD는 GET과 같은 조회·검증을 거치고 본문만 없다", async () => {
    const { slots, source, calls } = synthetic();
    slots.set("neon-demo", { generation: "1", bytes: webp });
    const head = await serveCover(get(URL_A1, { method: "HEAD" }), source);
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(webp.length));
    expect(head.headers.get("content-type")).toBe("image/webp");
    expect(head.body).toBeNull();
    expect(calls).toMatchObject({ find: 1, read: 1 });
    slots.set("neon-demo", { generation: "1", bytes: webp, stored: webp2 });
    const broken = await serveCover(get(URL_A1, { method: "HEAD" }), source);
    expect(broken.status).toBe(503);
    expect(broken.body).toBeNull();
  });

  it("Range 요청도 전체 200으로 답한다", async () => {
    const { slots, source } = synthetic();
    slots.set("neon-demo", { generation: "1", bytes: webp });
    const response = await serveCover(get(URL_A1, { headers: { range: "bytes=0-9" } }), source);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-range")).toBeNull();
    expect((await response.arrayBuffer()).byteLength).toBe(webp.length);
  });

  it("정규형이 아닌 주소·쿼리는 활성 공급원에서도 조회 없이 404", async () => {
    const { slots, source, calls } = synthetic();
    slots.set("neon-demo", { generation: "1", bytes: webp });
    for (const path of [`${URL_A1}?x=1`, "/media/public/neon-demo/01/cover.webp", "/media/public/Neon-demo/1/cover.webp", "/media/public/neon-demo/1/cover.png", "/media/public/neon-demo/1/cover.webp/"]) {
      expect((await serveCover(get(path), source)).status, path).toBe(404);
    }
    expect(calls.find).toBe(0);
  });
});

describe("T-254 활성 공급원 실패는 503", () => {
  async function status(slot: Slot) {
    const { slots, source } = synthetic();
    slots.set("neon-demo", slot);
    const response = await serveCover(get(URL_A1), source);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return response.status;
  }

  it("설정 누락·조회 예외·이상한 조회 결과", async () => {
    expect((await serveCover(get(URL_A1), { mode: "active", store: null })).status).toBe(503);
    const throwing: CoverStore = { findCover: async () => { throw new Error("db down"); }, readObject: async () => webp };
    expect((await serveCover(get(URL_A1), { mode: "active", store: throwing })).status).toBe(503);
    const odd: CoverStore = { findCover: async () => undefined as unknown as null, readObject: async () => webp };
    expect((await serveCover(get(URL_A1), { mode: "active", store: odd })).status).toBe(503);
  });

  it("행 계약 위반(키·MIME·크기·해시 형식)", async () => {
    for (const row of [{ objectKey: "neon-demo/2/x.webp" }, { objectKey: "../neon-demo/1/x.webp" }, { mime: "image/png" }, { sizeBytes: 0 }, { sizeBytes: COVER_MAX_BYTES + 1 }, { sizeBytes: 1.5 }, { sha: "A".repeat(64) }, { sha: "abc" }]) {
      expect(await status({ generation: "1", bytes: webp, row }), JSON.stringify(row)).toBe(503);
    }
  });

  it("파일 부재·길이·해시 불일치", async () => {
    expect(await status({ generation: "1", bytes: webp, stored: null })).toBe(503);
    expect(await status({ generation: "1", bytes: webp, stored: webp2 })).toBe(503);
    const extra = new Uint8Array([...webp, 0]);
    expect(await status({ generation: "1", bytes: webp, stored: extra })).toBe(503);
  });

  it("해시가 맞아도 WebP가 아니거나 깨졌거나 규격 밖이면 503", async () => {
    const truncated = webp.subarray(0, webp.length - 7);
    const padded = (() => { const bytes = new Uint8Array([...webp, 0, 0]); return bytes; })();
    const badRiff = (() => { const bytes = new Uint8Array(webp); bytes[4] ^= 1; return bytes; })();
    const corrupt = (() => { const bytes = new Uint8Array(webp); for (let i = 30; i < bytes.length; i++) bytes[i] = 0xff; return bytes; })();
    for (const [name, bytes] of [["png", png], ["truncated", truncated], ["padded", padded], ["riff-size", badRiff], ["corrupt", corrupt], ["animated", animated], ["4097px", wide4097]] as const) {
      expect(await status({ generation: "1", bytes }), name).toBe(503);
    }
    expect(await status({ generation: "1", bytes: wide4096 }), "4096px").toBe(200);
  });

  it("5 MiB 초과 파일은 읽기 한도에서 막힌다", async () => {
    const big = new Uint8Array(COVER_MAX_BYTES + 1);
    expect(await status({ generation: "1", bytes: webp, stored: big })).toBe(503);
  });

  it("시간 한도를 넘기면 503이고 공급원에 중단 신호를 보낸다", async () => {
    let aborted = false;
    const slow: CoverStore = {
      findCover: (_address, signal) => new Promise((resolveFind) => { signal.addEventListener("abort", () => { aborted = true; resolveFind(null); }); }),
      readObject: async () => webp,
    };
    const started = Date.now();
    const response = await serveCover(get(URL_A1), { mode: "active", store: slow }, 50);
    expect(response.status).toBe(503);
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("T-254 메서드 계약", () => {
  it("serveCover와 route의 비GET/HEAD는 405·Allow·no-store", async () => {
    const { source } = synthetic();
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await serveCover(get(URL_A1, { method }), source);
      expect(response.status, method).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const route = await import("@/app/media/public/[slug]/[generation]/[file]/route");
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(Object.keys(route).sort()).toEqual(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "dynamic", "runtime"]);
    for (const name of ["OPTIONS", "POST", "PUT", "PATCH", "DELETE"] as const) {
      const response = route[name]();
      expect(response.status, name).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const inactive = await route.GET(get(URL_A1));
    expect(inactive.status).toBe(404);
    expect(inactive.headers.get("cache-control")).toBe("no-store");
  });
});

describe("T-254 proxy: 정규 커버만 인증 전 처리", () => {
  const KEYS = ["DREAM_AUTH_MODE", "VERCEL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DREAM_ALLOWED_EMAILS"] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; } auth.user = null; auth.getUser = 0; });
  afterEach(() => { for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  function ready() {
    process.env.DREAM_AUTH_MODE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
    process.env.DREAM_ALLOWED_EMAILS = "owner@example.com";
  }
  async function run(path: string, method = "GET") {
    const { proxy } = await import("@/proxy");
    return proxy(new NextRequest(new URL(path, ORIGIN), { method }));
  }
  const passed = (response: Response) => response.headers.get("x-middleware-next") === "1";
  const NEAR = [`${URL_A1}?x=1`, `${URL_A1}/`, "/media/public/neon-demo/1/cover.png", "/media/public/neon-demo/01/cover.webp", "/media/public/Neon-demo/1/cover.webp", "/media/public/neon-demo/1", "/media/public", "/media/public/", "/media/x/1/cover.webp", "/media/public/sign/1/cover.webp"];

  it("로그인 준비·미준비·끔 모두: GET·HEAD는 세션 확인 없이 이미지 route로 통과", async () => {
    for (const setup of [() => { process.env.VERCEL = "1"; }, ready, () => undefined]) {
      for (const key of KEYS) delete process.env[key];
      setup();
      for (const method of ["GET", "HEAD"]) {
        const response = await run(URL_A1, method);
        expect(passed(response), method).toBe(true);
        expect(response.headers.get("set-cookie")).toBeNull();
      }
    }
    expect(auth.getUser).toBe(0);
  });

  it("다른 메서드는 인증 전에 405·Allow·no-store", async () => {
    for (const setup of [() => { process.env.VERCEL = "1"; }, ready, () => undefined]) {
      for (const key of KEYS) delete process.env[key];
      setup();
      for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        const response = await run(URL_A1, method);
        expect(response.status, method).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, HEAD");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(passed(response)).toBe(false);
      }
    }
    expect(auth.getUser).toBe(0);
  });

  it("비슷한 경로는 기존 보호를 그대로 받는다", async () => {
    ready();
    for (const path of NEAR) {
      const response = await run(path);
      expect(response.status, path).toBe(307);
      // 후행 슬래시 주소는 기존 deny가 NextURL의 후행 슬래시 표시를 유지해 /login/ 으로 보낸다(기존 동작, T-254 변경 없음).
      expect(new URL(response.headers.get("location")!, ORIGIN).pathname, path).toMatch(/^\/login\/?$/);
    }
    for (const path of NEAR) expect((await run(path, "POST")).status, path).toBe(307);
    for (const key of KEYS) delete process.env[key];
    process.env.VERCEL = "1";
    for (const path of NEAR) expect((await run(path)).status, path).toBe(503);
  });
});

describe("T-254 이미지 최적화 허용 범위와 쇼케이스 표시", () => {
  it("next.config의 최적화 허용 경로는 예시 이미지 폴더 하나뿐이다", async () => {
    vi.resetModules();
    const config = (await import("../../next.config")).default;
    expect(config.images).toEqual({ localPatterns: [{ pathname: "/showcase/t240/**", search: "" }] });
    expect(config.images?.remotePatterns).toBeUndefined();
    expect(SAMPLE_WORKS.every((work) => work.image.src.startsWith("/showcase/t240/"))).toBe(true);
  });

  it("승인 작품 이미지는 원래 주소로 직접 그리고(최적화 경유 없음), 예시는 기존 최적화를 유지한다", async () => {
    const { NeonShowcase } = await import("@/components/public-showcase/neon-showcase");
    const approved: ShowcaseWork = { ...SAMPLE_WORKS[0], id: "neon-demo", title: "WORK NEON DEMO", sample: false, media: null, image: { src: URL_A1, width: 64, height: 48 } };
    const second: ShowcaseWork = { ...SAMPLE_WORKS[5], id: "neon-demo-two", title: "WORK NEON TWO", sample: false, media: null, image: { src: "/media/public/neon-demo-two/1/cover.webp", width: 64, height: 48 } };
    const markup = renderToStaticMarkup(createElement(NeonShowcase, { works: [approved, second], loginHref: "/login?next=%2Fstudio" }));
    expect(markup).toContain(`src="${URL_A1}"`);
    expect(markup).not.toContain("/_next/image");
    expect(markup).not.toMatch(/srcSet|srcset/);
    const sample = renderToStaticMarkup(createElement(NeonShowcase, { works: SAMPLE_WORKS, loginHref: "/login?next=%2Fstudio" }));
    expect(sample).toContain("/_next/image?url=%2Fshowcase%2Ft240%2F");
    const source = readFileSync(resolve(root, "components/public-showcase/neon-showcase.tsx"), "utf8");
    // T360: 표지 상태 처리로 ref·onLoad·onError가 붙고(화살표 함수 포함), 상세·음악 재생 표지는 DetailCover 하나로 합쳐 4곳이다.
    const images = [...source.matchAll(/<Image\s[^\n]*/g)].map((match) => match[0]);
    expect(images).toHaveLength(4);
    for (const tag of images) expect(tag).toMatch(/ unoptimized=\{!(work|featured)\.sample\} src=\{\1\.image\.src\}/);
  });
});
