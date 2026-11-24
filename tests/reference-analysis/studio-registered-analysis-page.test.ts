import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import CloudReferenceAnalysisPage from "../../app/(cloud)/cloud/reference-analysis/page";
import { StudioRegisteredAnalysisPage } from "../../components/reference-analysis/studio-registered-analysis-page";
import { getRenderAuth } from "../../lib/auth/render";
import { isPublicPath } from "../../lib/auth/config";
import { isVerifiedActor, type VerifiedActor } from "../../lib/db/postgres/types";
import { loadStudioRegisteredAnalysisPage } from "../../lib/reference-analysis/studio-registered-analysis-page";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/auth/render", () => ({ getRenderAuth: vi.fn() }));
// T317: 연결이 켜져 있어도 페이지가 목록을 조회하지 않는지 확인하려고 합성 표식 연결을 주입한다.
const t317 = vi.hoisted(() => ({ marker: "T317-SYNTHETIC-PRIVATE-MARKER", list: { calls: 0 } }));
vi.mock("../../lib/reference-analysis/studio-analysis-connection", () => ({
  studioAnalysisConnection: {
    page: { analysisApiConnected: true, listAnalyzableMaterials: async () => { t317.list.calls += 1; return [{ label: t317.marker }]; } },
    post: {},
  },
}));

const userA = "10000000-0000-4000-8000-000000000010";
const userB = "20000000-0000-4000-8000-000000000010";
const login = (userId: string) => ({ kind: "verified", userId, email: "owner@example.invalid" } as const);
const rowA = { ownerId: userA, projectId: "10000000-0000-4000-8000-000000000011", assetId: "10000000-0000-7000-8000-000000000012",
  label: "A의 등록 자료", registration: "current", analysisAllowed: true, path: "/fixture/private-a" };
const rowB = { ...rowA, ownerId: userB, projectId: "20000000-0000-4000-8000-000000000011", assetId: "20000000-0000-7000-8000-000000000012",
  label: "B의 등록 자료", path: "/fixture/private-b" };
const dto = ({ label, projectId, assetId }: typeof rowA) => ({ label, projectId, assetId });
const connectionFor = (listAnalyzableMaterials: (actor: VerifiedActor) => Promise<unknown>, analysisApiConnected = true) =>
  ({ analysisApiConnected, listAnalyzableMaterials });

afterEach(() => vi.resetAllMocks());

describe("cloud registered analysis page", () => {
  it("keeps the page protected and redirects unauthenticated, forbidden and unavailable sessions", async () => {
    expect(isPublicPath("/cloud/reference-analysis")).toBe(false);
    for (const [status, code, location] of [
      [401, "AUTH_REQUIRED", "/login?next=%2Fcloud%2Freference-analysis"],
      [403, "AUTH_FORBIDDEN", "/login?error=forbidden"],
      [503, "AUTH_UNAVAILABLE", "/login?error=unavailable"],
    ] as const) {
      vi.mocked(getRenderAuth).mockResolvedValueOnce({ kind: "denied", status, code });
      await expect(CloudReferenceAnalysisPage()).rejects.toMatchObject({ digest: expect.stringContaining(location) });
    }
  });

  it("renders the local and production-unconnected states without creating analysis controls that can run", async () => {
    vi.mocked(getRenderAuth).mockResolvedValueOnce({ kind: "local" }).mockResolvedValueOnce(login(userA));
    const local = renderToStaticMarkup(await CloudReferenceAnalysisPage());
    expect(local).toContain("이 PC에서는 기존 작업실을 써요");
    expect(local).not.toContain("분석 실행");
    const closed = renderToStaticMarkup(await CloudReferenceAnalysisPage());
    expect(closed).toContain("등록 자료 분석 공급자가 아직 연결되지 않았어요.");
    expect(closed).toMatch(/<button[^>]+disabled=""[^>]*>분석 실행/);
  });

  it("does not call a list supplier before current auth or without the matching API", async () => {
    const read = vi.fn(async () => [rowA]);
    const connection = connectionFor(read);
    for (const auth of [{ kind: "denied", status: 401, code: "AUTH_REQUIRED" }, { kind: "local" }] as const) {
      expect(await loadStudioRegisteredAnalysisPage({ resolveAuth: async () => auth, connection })).toEqual(auth);
    }
    expect(await loadStudioRegisteredAnalysisPage({ resolveAuth: async () => { throw new Error("private auth error"); }, connection }))
      .toEqual({ kind: "denied", status: 503, code: "AUTH_UNAVAILABLE" });
    expect(await loadStudioRegisteredAnalysisPage({ resolveAuth: async () => login(userA), connection: connectionFor(read, false) }))
      .toEqual({ kind: "disconnected" });
    expect(read).not.toHaveBeenCalled();
  });

  it("projects only the authenticated owner's display label and two IDs on every request", async () => {
    const read = vi.fn(async (actor: VerifiedActor) => [actor.id === userA ? rowA : rowB]);
    const connection = connectionFor(read);
    for (const row of [rowA, rowB, rowA]) {
      const result = await loadStudioRegisteredAnalysisPage({ resolveAuth: async () => login(row.ownerId), connection });
      expect(result).toEqual({ kind: "connected", materials: [dto(row)] });
      expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ id: row.ownerId }));
      expect(isVerifiedActor(read.mock.lastCall?.[0])).toBe(true);
    }
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("fails closed on foreign, stale, malformed or duplicate rows and on list failure", async () => {
    const resolveAuth = async () => login(userA);
    for (const materials of [[rowA, rowB], [{ ...rowA, registration: "stale" }], [{ ...rowA, analysisAllowed: false }],
      [{ ...rowA, label: " " }], [rowA, rowA], {}, null]) {
      expect(await loadStudioRegisteredAnalysisPage({ resolveAuth, connection: connectionFor(async () => materials) })).toEqual({ kind: "unavailable" });
    }
    expect(await loadStudioRegisteredAnalysisPage({ resolveAuth, connection: connectionFor(async () => { throw new Error(rowA.path); }) }))
      .toEqual({ kind: "unavailable" });
  });

  it("renders the verified page as a data-free shell without reading the list even when a connection is wired (T317)", async () => {
    t317.list.calls = 0;
    vi.mocked(getRenderAuth).mockResolvedValueOnce(login(userA)).mockRejectedValueOnce(new Error(rowA.path));
    const shell = renderToStaticMarkup(await CloudReferenceAnalysisPage());
    expect(t317.list.calls).toBe(0);
    for (const secret of [t317.marker, rowA.label, rowA.projectId, rowA.assetId, rowA.path, userA]) expect(shell).not.toContain(secret);
    expect(shell).toContain("등록 자료 분석 공급자가 아직 연결되지 않았어요.");
    expect(shell).toMatch(/<button[^>]+disabled=""[^>]*>분석 실행/);
    await expect(CloudReferenceAnalysisPage()).rejects.toMatchObject({ digest: expect.stringContaining("/login?error=unavailable") });
    expect(t317.list.calls).toBe(0);
    const element = createElement(StudioRegisteredAnalysisPage);
    expect(element.props).toEqual({});
  });

  it("keeps the loader contract for empty lists (loader unchanged, not used by the page)", async () => {
    const state = await loadStudioRegisteredAnalysisPage({ resolveAuth: async () => login(userA), connection: connectionFor(async () => []) });
    expect(state).toEqual({ kind: "connected", materials: [] });
  });
});
