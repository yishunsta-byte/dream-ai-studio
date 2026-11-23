import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerAuthResult } from "@/lib/auth/resolve";
import { createShortsVaultHttp, type ShortsVaultDiagnostic } from "@/lib/reference-analysis/shorts-vault-http";
import {
  classifyShortsVaultFailure, createShortsVaultStore, inspectShortsVaultConfig, openShortsVaultStore, type ShortsVaultStore,
} from "@/lib/reference-analysis/shorts-vault-store";
import { projectDocument, promptSetDocument } from "./admin-shorts-vault-fixture";

vi.mock("server-only", () => ({}));

// P1-08-SHORTS-VAULT-STORAGE-DIAGNOSTICS: 합성 설정·합성 오류만. 실제 운영 값·DB·네트워크 없음.
const ref = "abcdefghijklmnopqrst";
const secret = "Zq9Synthetic0Password0Value0Never0Logged";
const owner = "20000000-0000-4000-8000-00000000000a";
const pooledHost = "aws-0-ap-northeast-2.pooler.supabase.com";
const goodUrl = `postgresql://dream_shorts_vault_app.${ref}:${secret}@${pooledHost}:6543/postgres`;
const publicEnv = { NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-fixture" };
// 공개 루트 인증서(Supabase Root 2021 CA). 비밀이 아니며 X509 해석 확인에만 쓴다.
const publicCa = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;
const env = (url: string | undefined, extra: Record<string, string | undefined> = {}) =>
  ({ ...publicEnv, DREAM_SHORTS_VAULT_DB_URL: url, ...extra });
const forbidden = [secret, pooledHost, "pooler", ref, owner, "dream_shorts_vault_app", "BEGIN CERTIFICATE", "postgresql://"];
const expectClean = (value: unknown) => {
  const text = JSON.stringify(value);
  for (const word of forbidden) expect(text).not.toContain(word);
};

describe("Shorts vault configuration diagnostics", () => {
  const rejected: [string, Record<string, string | undefined>][] = [
    ["url_missing", env(undefined)],
    ["public_config_missing", { DREAM_SHORTS_VAULT_DB_URL: goodUrl }],
    ["url_unparseable", env(secret)],
    ["url_unparseable", env(`postgresql://dream_shorts_vault_app.${ref}:%E0%A4%A@${pooledHost}:6543/postgres`)],
    ["url_protocol", env(goodUrl.replace("postgresql:", "mysql:"))],
    ["url_host", env(goodUrl.replace(pooledHost, "evil.example.invalid"))],
    ["url_host", env(goodUrl.replace(":6543", ":7000"))],
    ["url_host", env(`postgresql://dream_shorts_vault_app:${secret}@db.${ref}.supabase.co:6543/postgres`)],
    ["url_user", env(goodUrl.replace(`dream_shorts_vault_app.${ref}`, `postgres.${ref}`))],
    ["url_user", env(goodUrl.replace(`dream_shorts_vault_app.${ref}`, "dream_shorts_vault_app"))],
    ["url_user", env(`postgresql://dream_shorts_vault_app.${ref}:${secret}@db.${ref}.supabase.co:5432/postgres`)],
    ["url_path", env(goodUrl.replace("/postgres", "/other"))],
    ["url_password_missing", env(`postgresql://dream_shorts_vault_app.${ref}@${pooledHost}:6543/postgres`)],
    ["url_extra", env(`${goodUrl}?sslmode=disable`)],
    ["url_extra", env(`${goodUrl}#x`)],
  ];

  it("names each rejected setting with a fixed reason and keeps the store closed", () => {
    for (const [issue, value] of rejected) {
      const inspected = inspectShortsVaultConfig(value);
      expect(inspected.issue, issue).toBe(issue);
      expectClean(inspected);
      expect(openShortsVaultStore(value)).toBeNull();
    }
  });

  it("accepts the same direct and pooled shapes as before and reports the CA state only", () => {
    expect(inspectShortsVaultConfig(env(goodUrl))).toEqual({ issue: null, ca: "absent" });
    expect(inspectShortsVaultConfig(env(goodUrl.replace(":6543", ":5432")))).toEqual({ issue: null, ca: "absent" });
    expect(inspectShortsVaultConfig(env(`postgres://dream_shorts_vault_app:${secret}@db.${ref}.supabase.co:5432/postgres`)).issue).toBeNull();
    expect(inspectShortsVaultConfig(env(goodUrl, { DREAM_SHORTS_VAULT_DB_CA: `\n${publicCa}\n` }))).toEqual({ issue: null, ca: "parsed" });
    const broken = inspectShortsVaultConfig(env(goodUrl, { DREAM_SHORTS_VAULT_DB_CA: publicCa.replace(/\n/g, " ") }));
    expect(broken).toEqual({ issue: null, ca: "unparseable" });
    expectClean(broken);
  });
});

describe("Shorts vault failure classification", () => {
  const coded = (code: string, message = `${secret} ${pooledHost} ${owner}`) => Object.assign(new Error(message), { code });

  it("maps only allowlisted codes and never echoes the error", () => {
    const cases: [unknown, ReturnType<typeof classifyShortsVaultFailure>][] = [
      [coded("SELF_SIGNED_CERT_IN_CHAIN"), { stage: "tls", reason: "self_signed_cert_in_chain" }],
      [coded("UNABLE_TO_GET_ISSUER_CERT_LOCALLY"), { stage: "tls", reason: "unable_to_get_issuer_cert_locally" }],
      [coded("ERR_TLS_CERT_ALTNAME_INVALID"), { stage: "tls", reason: "err_tls_cert_altname_invalid" }],
      [coded("ERR_OSSL_PEM_NO_START_LINE"), { stage: "tls", reason: "tls_library_error" }],
      [coded("ENOTFOUND"), { stage: "network", reason: "dns" }],
      [coded("ECONNREFUSED"), { stage: "network", reason: "refused" }],
      [coded("ETIMEDOUT"), { stage: "network", reason: "timeout" }],
      [coded("28P01"), { stage: "auth", reason: "password_rejected" }],
      [coded("42501"), { stage: "database", reason: "permission_denied" }],
      [coded("XX000"), { stage: "database", reason: "internal_error" }],
      [coded("08006"), { stage: "network", reason: "connection_exception" }],
      [coded("22P02"), { stage: "database", reason: "other_sqlstate" }],
      [coded(secret), { stage: "other", reason: "unclassified" }],
      [coded("weird code"), { stage: "other", reason: "unclassified" }],
      ...["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"].map(name =>
        [coded(name), { stage: "other", reason: "unclassified" }] as [unknown, ReturnType<typeof classifyShortsVaultFailure>]),
      [new Error(`${secret} timeout exceeded when trying to connect`), { stage: "other", reason: "unclassified" }],
      [{ code: 28 }, { stage: "other", reason: "unclassified" }],
      [null, { stage: "other", reason: "unclassified" }],
      ["28P01", { stage: "other", reason: "unclassified" }],
    ];
    for (const [error, expected] of cases) {
      const result = classifyShortsVaultFailure(error);
      expect(result).toEqual(expected);
      expectClean(result);
    }
  });

  it("names the dedicated role check failure without its message", async () => {
    const client = { query: vi.fn(async (sql: string) => (/current_user=session_user/.test(sql) ? { rows: [{ ok: false }] } : { rows: [] })),
      release: vi.fn() };
    const store = createShortsVaultStore({ connect: vi.fn(async () => client) } as never);
    const error = await store.listProjects(owner).catch((caught: unknown) => caught);
    expect(classifyShortsVaultFailure(error)).toEqual({ stage: "role_check", reason: "role_mismatch" });
  });
});

describe("Shorts vault HTTP diagnostics", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const admin: ServerAuthResult = { kind: "verified", userId: owner, email: "a@example.invalid" };
  type Inspect = () => ReturnType<typeof inspectShortsVaultConfig>;
  function fixture({ auth = admin, store = null as ShortsVaultStore | null,
    report = vi.fn((entry: ShortsVaultDiagnostic) => { void entry; }),
    inspect = vi.fn<Inspect>(() => ({ issue: "url_host", ca: "parsed" })) } = {}) {
    const open = vi.fn(() => store);
    const http = createShortsVaultHttp({ env: { DREAM_SITE_URL: "https://studio.example.invalid" }, authenticate: vi.fn(async () => auth),
      store: open, inspect, report });
    return { http, open, report, inspect };
  }
  const failing = (error: unknown) => ({ listProjects: vi.fn(async () => { throw error; }),
    listPromptSets: vi.fn(async () => []) }) as unknown as ShortsVaultStore;

  it("never opens or diagnoses the store before the administrator check", async () => {
    for (const auth of [{ kind: "denied", status: 401, code: "AUTH_REQUIRED" }, { kind: "denied", status: 403, code: "AUTH_FORBIDDEN" },
      { kind: "local" }] as ServerAuthResult[]) {
      const { http, open, report, inspect } = fixture({ auth });
      expect([401, 403]).toContain((await http.listProjects()).status);
      expect(open).not.toHaveBeenCalled();
      expect(inspect).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
    }
  });

  it("keeps the public 503 contract and records only the configuration reason", async () => {
    const { http, report } = fixture();
    const reply = await http.listProjects();
    expect(reply.status).toBe(503);
    expect(await reply.json()).toEqual({ code: "storage_unavailable" });
    expect(reply.headers.get("cache-control")).toBe("private, no-store");
    expect(report).toHaveBeenCalledExactlyOnceWith({ stage: "config", reason: "url_host", ca: "parsed" });
  });

  it("records TLS failures with the CA state and other failures without it", async () => {
    const tls = fixture({ store: failing(Object.assign(new Error(secret), { code: "SELF_SIGNED_CERT_IN_CHAIN" })),
      inspect: vi.fn<Inspect>(() => ({ issue: null, ca: "unparseable" })) });
    expect((await tls.http.listProjects()).status).toBe(503);
    expect(tls.report).toHaveBeenCalledExactlyOnceWith({ stage: "tls", reason: "self_signed_cert_in_chain", ca: "unparseable" });

    const auth = fixture({ store: failing(Object.assign(new Error(secret), { code: "28P01" })) });
    const reply = await auth.http.listProjects();
    expect(reply.status).toBe(503);
    expect(await reply.json()).toEqual({ code: "storage_unavailable" });
    expect(auth.report).toHaveBeenCalledExactlyOnceWith({ stage: "auth", reason: "password_rejected" });
    expect(auth.inspect).not.toHaveBeenCalled();
  });

  it("diagnoses only the two list reads; search, open, write and delete stay silent", async () => {
    const site = "https://studio.example.invalid";
    const id = "30000000-0000-4000-8000-000000000001";
    const requestId = "40000000-0000-4000-8000-000000000001";
    const route = { params: Promise.resolve({ id }) };
    const req = (method: string, body?: unknown) => new Request(`${site}/api/admin/shorts-vault/x`, { method,
      headers: { origin: site, host: "studio.example.invalid", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const boom = () => Promise.reject(Object.assign(new Error(secret), { code: "28P01" }));
    const broken = { listProjects: vi.fn(boom), listPromptSets: vi.fn(boom), searchPromptSets: vi.fn(boom), getPromptSet: vi.fn(boom),
      createPromptSet: vi.fn(boom), deletePromptSet: vi.fn(boom), getProject: vi.fn(boom), createProject: vi.fn(boom),
      replaceProject: vi.fn(boom), deleteProject: vi.fn(boom) } as unknown as ShortsVaultStore;
    for (const store of [broken, null]) {
      const { http, report, inspect } = fixture({ store });
      const silent = [
        () => http.searchPromptSets(req("POST", { query: "비밀검색어" })),
        () => http.getPromptSet(route), () => http.getProject(route),
        () => http.createPromptSet(req("POST", { requestId, document: promptSetDocument() })),
        () => http.createProject(req("POST", { requestId, document: projectDocument() })),
        () => http.replaceProject(req("PUT", { expectedRevision: 1, document: projectDocument() }), route),
        () => http.deletePromptSet(req("DELETE"), route), () => http.deleteProject(req("DELETE"), route),
      ];
      for (const call of silent) expect((await call()).status).toBe(503);
      expect(report).not.toHaveBeenCalled();
      expect(inspect).not.toHaveBeenCalled();
      for (const list of [() => http.listProjects(), () => http.listPromptSets()]) expect((await list()).status).toBe(503);
      expect(report).toHaveBeenCalledTimes(2);
      for (const [entry] of report.mock.calls) {
        expect(entry).toEqual(store ? { stage: "auth", reason: "password_rejected" } : { stage: "config", reason: "url_host", ca: "parsed" });
      }
    }
  });

  it("does not diagnose successful reads and survives a failing recorder", async () => {
    const ok = fixture({ store: failing(null) });
    expect((await ok.http.listPromptSets()).status).toBe(200);
    expect(ok.report).not.toHaveBeenCalled();

    const loud = fixture({ report: vi.fn(() => { throw new Error("recorder down"); }) });
    const reply = await loud.http.listProjects();
    expect(reply.status).toBe(503);
    expect(await reply.json()).toEqual({ code: "storage_unavailable" });
  });

  it("writes only fixed names through the default server log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const http = createShortsVaultHttp({ env: { DREAM_SITE_URL: "https://studio.example.invalid" }, authenticate: vi.fn(async () => admin),
      store: () => failing(Object.assign(new Error(`${secret} ${goodUrl} ${owner}`), { code: "ECONNREFUSED", stack: secret })),
      inspect: () => ({ issue: null, ca: "parsed" }) });
    expect((await http.listProjects()).status).toBe(503);
    expect(warn).toHaveBeenCalledExactlyOnceWith("shorts_vault_storage_unavailable", { stage: "network", reason: "refused" });
    expectClean([warn.mock.calls, error.mock.calls, log.mock.calls]);
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});

// 마지막: 올바른 설정은 저장소를 연다(전역 캐시를 만들므로 맨 끝에 둔다). 연결은 하지 않는다.
describe("Shorts vault store opening parity", () => {
  it("opens only when the diagnostic finds no issue", () => {
    expect(inspectShortsVaultConfig(env(goodUrl)).issue).toBeNull();
    expect(openShortsVaultStore(env(goodUrl))).not.toBeNull();
  });
});
