import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import PublicHomePage from "../../app/(public)/page";
import { GET, HEAD } from "../../app/media/public/[slug]/[generation]/[file]/route";
import { serveCover, type CoverRow, type CoverStore } from "../../lib/public-showcase/cover-source";
import type { CoverAddress } from "../../lib/public-showcase/cover-path";
import { createPublicationShowcaseConnection } from "../../lib/public-showcase/publication-showcase-connection";
import { getPublicationPublicReaders } from "../../lib/public-showcase/publication-runtime";
import { loadShowcaseFeed } from "../../lib/public-showcase/showcase-feed";
import type { ShowcaseListStore } from "../../lib/public-showcase/showcase-source";

vi.mock("server-only", () => ({}));

const now = 1_763_452_800_000;
const approved = { slug: "approved-fixture", generation: "7", approvedMs: String(now - 100), display: {
  kind: "영상", title: "통합 승인 작품", subtitle: "공개 승인 작품", creator: "DREAM CREW", genre: "신스웨이브", format: "뮤직 필름",
  description: "격리 통합 작품이에요.", width: 8, height: 8,
} };
const path = `/media/public/${approved.slug}/${approved.generation}/cover.webp`;
const request = (method: string, url = path, headers?: HeadersInit) => new Request(`https://test.invalid${url}`, { method, headers });
const activePair = (list: ShowcaseListStore | null, cover: CoverStore | null) => ({
  showcaseSource: { mode: "active", store: list }, coverSource: { mode: "active", store: cover },
} as const);

afterEach(() => vi.restoreAllMocks());

describe("shared publication showcase connection", () => {
  it("keeps the real home in sample mode and GET and HEAD inactive without an explicit authority pair", async () => {
    expect(await getPublicationPublicReaders()).toEqual({ showcaseSource: { mode: "sample" }, coverSource: { mode: "inactive" } });
    const html = renderToStaticMarkup(await PublicHomePage({}));
    expect(html).toContain("NEON AFTER HOURS");
    expect(html).toContain('href="/login?next=%2Fstudio"');
    expect(html).not.toContain(approved.display.title);
    for (const [handler, method] of [[GET, "GET"], [HEAD, "HEAD"]] as const) {
      for (const url of [path, `${path}?mode=active`]) {
        const result = await handler(request(method, url, { "x-showcase-mode": "active" }));
        expect(result.status).toBe(404);
        expect(result.headers.get("cache-control")).toBe("no-store");
      }
    }
  });

  it("closes both sides if either role, byte reader, final check or verification is absent", async () => {
    const listApproved = vi.fn<ShowcaseListStore["listApproved"]>();
    const findCover = vi.fn<CoverStore["findCover"]>();
    const readObject = vi.fn<CoverStore["readObject"]>();
    const confirmCover = vi.fn<NonNullable<CoverStore["confirmCover"]>>();
    const list = { listApproved };
    const cover = { findCover, readObject, confirmCover };
    const faulty = [activePair(list, null), activePair(null, cover), activePair(list, { findCover, readObject }),
      { ...activePair(list, cover), coverSource: { mode: "inactive" } as const },
      { ...activePair(list, cover), showcaseSource: { mode: "sample" } as const }];
    for (const sources of faulty) {
      const connection = await createPublicationShowcaseConnection(async () => sources);
      expect(connection).toEqual(await getPublicationPublicReaders());
    }
    expect(await createPublicationShowcaseConnection(async () => { throw new Error("private verification detail"); }))
      .toEqual(await getPublicationPublicReaders());
    expect(listApproved).not.toHaveBeenCalled();
    expect(findCover).not.toHaveBeenCalled();
    expect(readObject).not.toHaveBeenCalled();
    expect(confirmCover).not.toHaveBeenCalled();
  });

  it("pairs a fresh approved list and verified generation cover and closes on withdrawal or expiry", async () => {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#d02681" } }).webp().toBuffer();
    const sha = createHash("sha256").update(bytes).digest("hex");
    const row: CoverRow = { objectKey: `${approved.slug}/${approved.generation}/${sha}.webp`, mime: "image/webp", sizeBytes: bytes.length, sha };
    let clock = now;
    let withdrawn = false;
    const live = () => !withdrawn && clock < now + 1_000;
    const current = ({ slug, generation }: CoverAddress) => live() && slug === approved.slug && generation === approved.generation;
    const listApproved = vi.fn(async () => ({ nowMs: String(clock), rows: live() ? [approved] : [] }));
    const readObject = vi.fn<CoverStore["readObject"]>().mockResolvedValue(bytes);
    const confirmCover = vi.fn(async (address: CoverAddress, expected: CoverRow) => current(address) && expected.objectKey === row.objectKey);
    const open = vi.fn(async () => activePair({ listApproved }, { findCover: async (address) => current(address) ? row : null, readObject, confirmCover }));
    const connection = await createPublicationShowcaseConnection(open);
    const feed = await loadShowcaseFeed(connection.showcaseSource);
    expect(feed.state).toBe("published");
    expect(feed.works.map(({ title, image }) => ({ title, src: image?.src })))
      .toEqual([{ title: approved.display.title, src: path }]);
    const get = await serveCover(request("GET"), connection.coverSource);
    const head = await serveCover(request("HEAD"), connection.coverSource);
    expect(Buffer.from(await get.arrayBuffer())).toEqual(bytes);
    expect(await head.text()).toBe("");
    for (const response of [get, head]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-length")).toBe(String(bytes.length));
    }
    expect(confirmCover).toHaveBeenCalledTimes(2);
    expect((await serveCover(request("GET", path.replace("/7/", "/6/")), connection.coverSource)).status).toBe(404);

    withdrawn = true;
    expect((await loadShowcaseFeed(connection.showcaseSource)).state).toBe("empty");
    expect((await serveCover(request("GET"), connection.coverSource)).status).toBe(404);
    withdrawn = false;
    clock += 1_000;
    expect((await loadShowcaseFeed(connection.showcaseSource)).state).toBe("empty");
    expect((await serveCover(request("HEAD"), connection.coverSource)).status).toBe(404);
    expect(readObject).toHaveBeenCalledTimes(2);
    expect(listApproved).toHaveBeenCalledTimes(3);
    expect(open).toHaveBeenCalledOnce();
  });

  it("returns no approved content on list or final cover check errors", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#d02681" } }).webp().toBuffer();
    const sha = createHash("sha256").update(bytes).digest("hex");
    const fail = async () => { throw new Error("private role detail"); };
    const pair = activePair({ listApproved: fail }, {
      findCover: async () => ({ objectKey: `${approved.slug}/${approved.generation}/${sha}.webp`, mime: "image/webp", sizeBytes: bytes.length, sha }),
      readObject: async () => bytes, confirmCover: fail,
    });
    const connection = await createPublicationShowcaseConnection(async () => pair);
    expect(await loadShowcaseFeed(connection.showcaseSource)).toEqual({ state: "unavailable", works: [], failure: "query" });
    expect(logger).toHaveBeenCalledWith("[showcase] unavailable code=query rows=0");
    const response = await serveCover(request("HEAD"), connection.coverSource);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-length")).toBeNull();
    expect(await response.text()).toBe("");
  });
});
