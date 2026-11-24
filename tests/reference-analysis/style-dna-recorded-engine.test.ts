import { expect, it, vi } from "vitest";
import type { GeminiCredentialStore } from "@/lib/reference-analysis/analysis-credential-store";
import { styleDnaPath, type StyleDnaRecord } from "@/lib/reference-analysis/style-dna-contract";
import { createStyleDnaHttp } from "@/lib/reference-analysis/style-dna-http";
import type { StyleDnaProvider } from "@/lib/reference-analysis/style-dna-provider";
import type { StyleDnaStore } from "@/lib/reference-analysis/style-dna-store";

vi.mock("server-only", () => ({}));

it("stores the configured Gemini model for analysis and prompt revisions", async () => {
  const origin = "https://studio.example.invalid";
  const credentials = {
    group: "reference" as const, models: { image: "gemini-fixture-image" }, version: 3,
    updatedAt: "2026-01-01T00:00:00Z", lastTest: {},
  };
  const expected = { provider: "gemini", modelId: credentials.models.image, credentialVersion: credentials.version };
  const prompts = { ko: "따뜻한 조명", en: "Warm light" };
  const analyze: StyleDnaProvider["analyze"] = vi.fn(async () => ({
    original: { bytes: Buffer.from([1]), mime: "image/webp" as const, width: 1, height: 1, sha256: "a".repeat(64), palette: [] },
    semantic: { status: "partial" as const, provider: "gemini" as const, findings: [], prompts },
    result: { schemaVersion: 1 as const, status: "ready" as const, media: "image" as const, proposals: [] },
    styleDna: undefined,
  }));
  const refine: StyleDnaProvider["refine"] = vi.fn(async () => ({ ...prompts, note: "조명을 보정했어요.", styleDna: undefined }));
  let record: StyleDnaRecord | undefined;
  const finish: StyleDnaStore["finish"] = vi.fn(async (_owner, _requestId, change) => {
    if (change.kind === "analysis") {
      record = change.record;
      return { status: 201, body: { record } };
    }
    if (change.kind === "refine" && record) {
      record = { ...record, revision: change.revision.revision, revisions: [...record.revisions, change.revision] };
      return { status: 200, body: { record } };
    }
    throw new Error("Unexpected test transaction");
  });
  const http = createStyleDnaHttp({
    authenticate: async () => ({ kind: "verified", userId: "10000000-0000-4000-8000-000000000011", email: "owner@example.invalid" }),
    env: { DREAM_SITE_URL: origin },
    credentials: (): GeminiCredentialStore => ({
      open: async () => ({ ...credentials, apiKey: "fixture-only-key" }),
      metadata: async () => [credentials],
      write: vi.fn(), recordTest: vi.fn(),
    }),
    store: (): StyleDnaStore => ({
      reserve: async () => undefined,
      list: async () => [],
      get: async () => {
        if (!record) throw new Error("Missing fixture record");
        return record;
      },
      finish, remove: vi.fn(), media: vi.fn(), compare: vi.fn(),
    }),
    provider: { analyze, refine, test: vi.fn() },
  });
  const post = (path: string, body: object) => new Request(origin + path, {
    method: "POST", headers: { origin, host: new URL(origin).host, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const operation = { authorized: true, credentialVersion: credentials.version };
  const analyzed = await http.analyze(post(styleDnaPath, {
    ...operation, requestId: "0190b0b0-0000-4000-8000-000000000001", mode: "replicate",
    source: { kind: "url", url: "https://images.example.invalid/coast.png" },
  }));
  expect(analyzed.status).toBe(201);
  const initial = (await analyzed.json()).record as StyleDnaRecord;
  expect(initial.engine).toEqual(expected);
  expect(initial.revisions[0].engine).toEqual(expected);

  const refined = await http.refine(post(`${styleDnaPath}/${initial.id}/refine`, {
    ...operation, requestId: "0190b0b0-0000-4000-8000-000000000002", revision: 1, feedback: "조명을 더 따뜻하게",
  }), { params: Promise.resolve({ id: initial.id }) });
  expect(refined.status).toBe(200);
  expect((await refined.json()).record.revisions[1].engine).toEqual(expected);
});
