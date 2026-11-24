import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { stageOrder } from "../../lib/domain/stages";
import { parseMenuConfig } from "../../lib/menus/parse";
import { snapshotForMenu } from "../../lib/menus/snapshot";
import { createProjectHttpsReadRequest } from "../../lib/services/project-https-read";

vi.mock("server-only", () => ({}));

const ref = "abcdefghijklmnopqrst";
const origin = `https://${ref}.supabase.co`;
const profile = "project_read";
const publicKey = "sb_publishable_synthetic_test_client_key";
const userId = "10000000-0000-4000-8000-000000000001";
const otherId = "20000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";
const email = "owner@example.invalid";
const auth = { kind: "verified", userId, email } as const;
const when = "2026-01-02T00:00:00.100Z";
const config = parseMenuConfig(readFileSync(new URL("../../docs/spec/menus.json", import.meta.url), "utf8"));
if (!config.ok) throw new Error("Menu fixture invalid");
const snapshot = snapshotForMenu(config.config, config.config.menus[0]);
const stages = stageOrder.map((stage, index) => ({
  projectId, stage, status: index === 0 ? "approved" : "locked",
  approvedPlanId: null, approvedRevision: null, approvedAt: null, note: null,
}));
const listed = { id: projectId, title: "Owner’s project", menuId: snapshot.menu.id, menuLabel: snapshot.menu.label,
  aspect: "9:16", lengthSec: 5, updatedAt: when, states: stages, jobs: ["running"] };
const project = { id: projectId, menuId: snapshot.menu.id, templateVersion: snapshot.templateVersion,
  templateSnapshotJson: JSON.stringify(snapshot), inputsJson: '{"fixture":true}', title: listed.title, goal: "",
  target: "", aspect: listed.aspect, lengthSec: listed.lengthSec, approvedPlanId: null, contentRevision: 1,
  currentTimelineRevId: null, archivedAt: null, createdAt: when, updatedAt: when };
const detail = { id: projectId, project, snapshot, inputs: { fixture: true }, states: stages };

function jwt(claims: object) {
  return `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}
const token = (overrides: object = {}) => jwt({
  sub: userId, aud: "authenticated", role: "authenticated", iss: `${origin}/auth/v1`, exp: 9999999999, ...overrides,
});
const body = (value: unknown, status = 200) => Response.json(value, { status });
const data = (value: unknown, range = "0-0/1", contentProfile = profile) => Response.json(value, {
  headers: { "content-range": range, "content-profile": contentProfile },
});
const noStore = { "cache-control": "no-store" };
type Options = Parameters<typeof createProjectHttpsReadRequest>[0];
function setup(responses: Response[] = [], overrides: Partial<Options> = {}) {
  const fetcher = vi.fn<typeof fetch>();
  let first = true;
  fetcher.mockImplementation(async () => {
    if (first) { first = false; return body({ id: userId, email }); }
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  });
  const load = vi.fn(async () => ({ auth, accessToken: token() }));
  const request = createProjectHttpsReadRequest({ project: { ref, origin, profile, publicKey }, resolveAccess: load, fetcher, ...overrides });
  return { fetcher, request, load };
}

describe("T352 explicit server HTTPS candidate", () => {
  it("binds the same token and target for Auth and each read, and keeps the public DTO/cache contract", async () => {
    const { fetcher, request, load } = setup([data([listed]), data([detail])]);
    const [list, own] = await Promise.all([request.list(), request.get(async () => projectId)]);
    const card = { id: projectId, title: listed.title, menuId: listed.menuId, menuLabel: listed.menuLabel, aspect: listed.aspect,
      lengthSec: listed.lengthSec, updatedAt: listed.updatedAt, states: stages };
    expect(list).toEqual({ status: 200, headers: noStore, body: [{ ...card, status: "running", nextStage: "brief" }] });
    expect(own).toEqual({ status: 200, headers: noStore, body: { project, snapshot, inputs: detail.inputs, states: stages } });
    expect(load).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(3);
    const [authCall, listCall, detailCall] = fetcher.mock.calls;
    for (const [input, init] of [authCall, listCall, detailCall]) {
      expect((input as URL).origin).toBe(origin);
      expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", credentials: "omit" });
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${token()}`);
      expect(headers.get("apikey")).toBe(publicKey);
      expect(headers.get("cache-control")).toBe("no-store");
      expect(headers.has("cookie")).toBe(false);
    }
    expect((authCall[0] as URL).pathname).toBe("/auth/v1/user");
    expect(new Headers(authCall[1]?.headers).has("accept-profile")).toBe(false);
    expect((listCall[0] as URL).pathname).toBe("/rest/v1/project_list");
    expect((listCall[0] as URL).searchParams.get("order")).toBe("updatedAt.desc,id.asc");
    expect((detailCall[0] as URL).searchParams.get("id")).toBe(`eq.${projectId}`);
    for (const [, init] of [listCall, detailCall]) {
      expect(new Headers(init?.headers).get("accept-profile")).toBe(profile);
      expect(new Headers(init?.headers).get("prefer")).toBe("count=exact");
    }
  });

  it.each([401, 403] as const)("keeps an app denial %s before lazy params and network", async status => {
    const code = status === 401 ? "AUTH_REQUIRED" : "AUTH_FORBIDDEN";
    const { fetcher, request } = setup([], { resolveAccess: async () => ({ auth: { kind: "denied", status, code }, accessToken: token() }) });
    const lazyId = vi.fn();
    expect(await request.get(lazyId)).toMatchObject({ status, body: { code }, headers: noStore });
    expect(fetcher).not.toHaveBeenCalled();
    expect(lazyId).not.toHaveBeenCalled();
  });

  it.each([undefined, token({ sub: otherId }), token({ iss: "https://foreign.invalid/auth/v1" }), token({ aud: undefined }),
    token({ role: "service_role" }), token({ exp: 1 }), "invalid\r\n"] as const)(
    "rejects missing or locally mismatched JWT at case %#", async accessToken => {
      const { fetcher, request } = setup([], { resolveAccess: async () => ({ auth, accessToken }) });
      expect(await request.list()).toMatchObject({ status: 401, body: { code: "AUTH_REQUIRED" }, headers: noStore });
      expect(fetcher).not.toHaveBeenCalled();
    });

  it.each([{ id: otherId, email }, { id: userId, email: "different@example.invalid" }] as const)(
    "stops on a differing project Auth identity", async claimed => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(body(claimed));
      const { request } = setup([], { fetcher });
      expect(await request.list()).toMatchObject({ status: 401, body: { code: "AUTH_REQUIRED" }, headers: noStore });
      expect(fetcher).toHaveBeenCalledOnce();
    });

  it.each([{ origin: "https://foreign.invalid" }, { origin: `${origin}/` }, { profile: "dream" },
    { publicKey: jwt({ ref, role: "service_role" }) }, { publicKey: jwt({ ref: "wrong", role: "anon" }) },
    { publicKey: "sb_secret_synthetic_server_key" }] as const)("rejects an unbound project setting at case %#", async variant => {
    const { fetcher, request } = setup([], { project: { ref, origin, profile, publicKey, ...variant } });
    expect(await request.list()).toMatchObject({ status: 503, body: { code: "PROJECT_READ_UNAVAILABLE" }, headers: noStore });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("supports a legacy anon key bound to the project and represents a genuinely empty list", async () => {
    const { request } = setup([data([], "*/0")], { project: { ref, origin, profile, publicKey: jwt({ ref, role: "anon" }) } });
    expect(await request.list()).toEqual({ status: 200, body: [], headers: noStore });
  });

  it("maps an absent detail to 404 and a malformed identifier to 400", async () => {
    const { fetcher, request } = setup([data([], "*/0")]);
    expect(await request.get(projectId)).toMatchObject({ status: 404, body: { code: "NOT_FOUND" }, headers: noStore });
    expect(await request.get("wrong/../detail")).toMatchObject({ status: 400, body: { code: "INVALID_INPUT" }, headers: noStore });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    { rows: [], range: null },
    { rows: [], range: "*/1" },
    { rows: [], range: "0-0/0" },
    { rows: [detail], range: null },
    { rows: [detail], range: "0-0/2" },
    { rows: [detail], range: "0-0/*" },
    { rows: [detail], range: "*/0" },
    { rows: [detail], range: "00-0/1" },
    { rows: [detail], range: "1-1/1" },
    { rows: [detail, detail], range: "0-1/2" },
  ])("rejects an incomplete or noncanonical detail response at case %#", async ({ rows, range }) => {
    const response = Response.json(rows, { headers: {
      "content-profile": profile, ...(range !== null && { "content-range": range }),
    } });
    const { request } = setup([response]);
    expect(await request.get(projectId)).toMatchObject({
      status: 503, body: { code: "PROJECT_READ_UNAVAILABLE" }, headers: noStore,
    });
  });

  it.each([() => data([listed], "0-0/2"), () => data([listed, listed], "0-1/2"),
    () => data([listed], "0-0/1", "public"), () => data([{ ...listed, states: [] }]),
    () => data([{ ...listed, states: stages.map(row => ({ ...row, projectId: otherId })) }]),
    () => data([{ ...listed, ownerId: userId }]), () => body({ code: "42501", details: token() }, 403),
    () => body({ code: "42501", details: token() }, 401), () => Response.redirect("https://foreign.invalid"),
    () => new Response("invalid json", { headers: { "content-type": "application/json", "content-profile": profile } })])(
    "closes on partial, mismatched or invalid wire responses at case %#", async raw => {
      const { request } = setup([raw()]);
      const result = await request.list();
      expect(result).toMatchObject({ status: 503, body: { code: "PROJECT_READ_UNAVAILABLE" }, headers: noStore });
      expect(JSON.stringify(result)).not.toContain(token());
      expect(JSON.stringify(result)).not.toContain("42501");
    });

  it.each([{ ...detail, id: otherId }, { ...detail, project: { ...project, id: otherId } },
    { ...detail, inputs: { substituted: true } }])("rejects a substituted detail", async row => {
    const { request } = setup([data([row])]);
    expect(await request.get(projectId)).toMatchObject({ status: 503, body: { code: "PROJECT_READ_UNAVAILABLE" } });
  });

  it("sanitizes Auth errors, expired-read faults and transport failures", async () => {
    const failAuth = setup([], { fetcher: vi.fn<typeof fetch>().mockResolvedValueOnce(body({ internal: token() }, 503)) });
    expect(await failAuth.request.list()).toMatchObject({ status: 503, body: { code: "AUTH_UNAVAILABLE" }, headers: noStore });
    const expired = setup([body({ code: "PGRST303", detail: token() }, 401)]);
    expect(await expired.request.list()).toMatchObject({ status: 401, body: { code: "AUTH_REQUIRED" }, headers: noStore });
    const disconnected = setup();
    disconnected.fetcher.mockRejectedValueOnce(new Error(`private ${token()}`));
    const result = await disconnected.request.list();
    expect(result).toMatchObject({ status: 503, body: { code: "AUTH_UNAVAILABLE" }, headers: noStore });
    expect(JSON.stringify(result)).not.toContain(token());
  });

  it("blocks before checkout on cancellation and refuses oversized project responses", async () => {
    const controller = new AbortController();
    const canceled = setup([], { signal: controller.signal });
    controller.abort();
    expect(await canceled.request.list()).toMatchObject({ status: 503, body: { code: "AUTH_UNAVAILABLE" } });
    expect(canceled.fetcher).not.toHaveBeenCalled();

    const oversized = setup([data([{ ...listed, title: "x".repeat(4 * 1024 * 1024) }])]);
    expect(await oversized.request.list()).toMatchObject({ status: 503, body: { code: "PROJECT_READ_UNAVAILABLE" }, headers: noStore });
  });
});
