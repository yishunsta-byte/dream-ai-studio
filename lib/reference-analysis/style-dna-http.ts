import "server-only";
import { createHash } from "node:crypto";
import { v7 } from "uuid";
import { readBoundedUpload } from "../cloud/read-bounded-upload";
import { readLimitedText, rejectForeignWrite } from "../public-showcase/admin-publication-http";
import { openRuntimeGeminiCredentialStore, openRuntimeStyleDnaEngineCredentialStore } from "./analysis-credential-store";
import type { GeminiSettings } from "./analysis-gemini-settings";
import { referenceFileFormat, referenceUploadByteLimit } from "./input";
import { AnalysisStageError, MediaUrlError } from "./media-url-error";
import { styleDnaAnalyze, styleDnaAnalyzeSource, styleDnaCompare, styleDnaId, styleDnaImageModels, styleDnaPath, styleDnaRatio, styleDnaRefine,
  styleDnaTest, styleDnaTestWithReference, type StyleDnaMedia, type StyleDnaRecord, type StyleDnaRevision, type StyleDnaTestBasis,
  type StyleDnaTestOptions, type StyleDnaTestResult } from "./style-dna-contract";
import { createStyleDnaProvider, measureStyleDnaImage, styleDnaTestPrompt, StyleDnaProviderError,
  type MeasuredStyleDnaImage, type StyleDnaAnalysisSettings, type StyleDnaProvider, type StyleDnaSource } from "./style-dna-provider";
import type { StyleDnaEngineBasis, StyleDnaEngineSelection } from "./style-dna-engine-credential-contract";
import { openStyleDnaStore, styleDnaLibraryLimit, type StyleDnaStore } from "./style-dna-store";
import { createStyleDnaAdminAccess, styleDnaAdminDefaults, styleDnaJson } from "./style-dna-admin-http";

const defaults = { authenticate: styleDnaAdminDefaults.authenticate, env: styleDnaAdminDefaults.env,
  store: openStyleDnaStore, credentials: openRuntimeGeminiCredentialStore, engineCredentials: openRuntimeStyleDnaEngineCredentialStore,
  provider: createStyleDnaProvider() };
const problem = (code: string, status: number) => styleDnaJson({ code }, status);
const bodySize = 10_240;
type UploadSource = StyleDnaSource | { kind: "record"; id: string };
type RecordRoute = { params: Promise<{ id: string }> };
type MediaRoute = { params: Promise<{ id: string; media: string }> };
type Change = Parameters<StyleDnaStore["finish"]>[2];
type Work = (settings: StyleDnaAnalysisSettings, engine?: StyleDnaEngineBasis) => Promise<Change>;
const failure = (code: string, status: number): Extract<Change, { kind: "failure" }> =>
  ({ kind: "failure", outcome: { status, body: { code } } });
const providerStatus = { subject_required: 400, stale_credential: 409, storage_unavailable: 503, timed_out: 504,
  model_error: 502, invalid_model_response: 502 } as const;

async function runWork(work: Work, settings: StyleDnaAnalysisSettings, engine?: StyleDnaEngineBasis): Promise<Change> {
  try { return await work(settings, engine); }
  catch (error) {
    if (error instanceof MediaUrlError) return failure(error.code, error.status ?? 400);
    if (error instanceof AnalysisStageError && error.detail === "timed_out") {
      console.warn("style_dna_timed_out", { stage: error.stage });
      return failure("timed_out", 504);
    }
    if (error instanceof StyleDnaProviderError) {
      if (error.code === "timed_out") console.warn("style_dna_timed_out", { stage: "provider" });
      return failure(error.code, providerStatus[error.code]);
    }
    return failure("model_error", 502);
  }
}
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const stamp = () => new Date().toISOString();
const inputJson = async (request: Request) => {
  const raw = await readLimitedText(request, bodySize);
  if (raw === "too-large") return problem("too_large", 413);
  try { return JSON.parse(raw) as unknown; }
  catch { return problem("invalid_input", 400); }
};

function imageDto(image: MeasuredStyleDnaImage, id: string, media: string): StyleDnaMedia {
  const { mime, width, height, sha256, palette } = image;
  return { mime, width, height, sha256, palette, href: `${styleDnaPath}/${id}/media/${media}` };
}

function closestRatio({ width, height }: StyleDnaMedia) {
  const distance = (name: string) => {
    const [x, y] = name.split(":").map(Number);
    return Math.abs(Math.log((x * height) / (y * width)));
  };
  return styleDnaRatio.options.reduce((best, ratio) => distance(ratio) < distance(best) ? ratio : best);
}

function isImageForm(request: Request) {
  return request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "multipart/form-data";
}

async function readImageForm(request: Request, fileField: string) {
  const requestLimit = referenceUploadByteLimit + 32_768;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d{1,9}$/.test(length) || Number(length) > requestLimit)) return problem("too_large", 413);
  const content = await readBoundedUpload(request, requestLimit).catch(() => undefined);
  if (content === null) return problem("too_large", 413);
  if (!content?.length) return problem("invalid_input", 400);
  try {
    const form = await new Response(new Uint8Array(content), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
    const file = form.get(fileField);
    const options = form.get("options");
    if ([...form.keys()].length !== 2 || !(file instanceof File) || !file.size || typeof options !== "string") return problem("invalid_input", 400);
    if (file.size > referenceUploadByteLimit || Buffer.byteLength(options) > bodySize) return problem("too_large", 413);
    return { file, options: JSON.parse(options) as unknown };
  } catch { return problem("invalid_input", 400); }
}

async function readAnalysisInput(request: Request) {
  if (!isImageForm(request)) {
    const json = await inputJson(request);
    if (json instanceof Response) return json;
    const parsed = styleDnaAnalyzeSource.safeParse(json);
    if (!parsed.success) return problem("invalid_input", 400);
    const { source, ...options } = parsed.data;
    return { source: source as UploadSource, options };
  }

  const form = await readImageForm(request, "file");
  if (form instanceof Response) return form;
  const checked = styleDnaAnalyze.safeParse(form.options);
  if (!checked.success) return problem("invalid_input", 400);
  const source: UploadSource = { kind: "file", bytes: Buffer.from(await form.file.arrayBuffer()), name: form.file.name };
  return { source, options: checked.data };
}

type TestInput = { options: StyleDnaTestOptions; upload?: { bytes: Buffer; mime: string; sha256: string } };

async function readTestInput(request: Request): Promise<TestInput | Response> {
  if (!isImageForm(request)) {
    const json = await inputJson(request);
    if (json instanceof Response) return json;
    const parsed = styleDnaTest.safeParse(json);
    return parsed.success ? { options: parsed.data } : problem("invalid_input", 400);
  }

  const form = await readImageForm(request, "customReference");
  if (form instanceof Response) return form;
  const parsed = styleDnaTestWithReference.safeParse(form.options);
  if (!parsed.success) return problem("invalid_input", 400);
  const format = referenceFileFormat(form.file.name);
  if (format?.media !== "image") return problem("unsupported_format", 400);
  const mime = format.mimes[0];
  const declaredType = form.file.type;
  if (declaredType && declaredType !== "application/octet-stream" && declaredType !== mime) return problem("invalid_reference", 400);
  const bytes = Buffer.from(await form.file.arrayBuffer());
  const { customReferenceSha256, ...options } = parsed.data;
  if (hash(bytes) !== customReferenceSha256) return problem("reference_mismatch", 400);
  return { options, upload: { bytes, mime, sha256: customReferenceSha256 } };
}

export function createStyleDnaHttp(overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  const access = createStyleDnaAdminAccess(deps);
  const withStore = (handle: (owner: string, store: StyleDnaStore) => Promise<Response>, request?: Request,
    allowedTypes?: readonly string[]) => access.withAdmin(async owner => {
    if (request) {
      const blocked = rejectForeignWrite(request, deps.env, allowedTypes);
      if (blocked) return blocked;
    }
    const store = deps.store();
    return store ? handle(owner, store) : problem("storage_unavailable", 503);
  });

  async function executeEngine(owner: string, store: StyleDnaStore, requestId: string, encoded: string, engine: StyleDnaEngineBasis,
    work: Work, requiredRecord?: string) {
    let change: Change;
    try {
      const credentials = deps.engineCredentials();
      const saved = await credentials?.open(owner, engine.provider);
      if (!credentials) change = failure("storage_unavailable", 503);
      else if (!saved) change = failure("not_configured", 503);
      else if (saved.version !== engine.credentialVersion || saved.modelId !== engine.modelId) change = failure("stale_credential", 409);
      else if (encoded.includes(saved.apiKey)) change = failure("invalid_input", 400);
      else {
        change = await runWork(work, { key: saved.apiKey, model: saved.modelId, provider: engine.provider,
          isCurrent: () => credentials.isCurrent(owner, engine) }, engine);
        if (change.kind !== "failure") {
          const outcome = await credentials.whileCurrent(owner, engine, () => store.finish(owner, requestId, change, requiredRecord));
          if (outcome) return styleDnaJson(outcome.body, outcome.status);
          change = failure("stale_credential", 409);
        }
      }
    } catch { change = failure("storage_unavailable", 503); }
    const outcome = await store.finish(owner, requestId, change, requiredRecord);
    return styleDnaJson(outcome.body, outcome.status);
  }

  async function execute(owner: string, store: StyleDnaStore, requestId: string, credentialVersion: number, intent: unknown, work: Work,
    selection?: StyleDnaEngineSelection, requiredRecord?: string) {
    const encoded = JSON.stringify(intent);
    const previous = await store.reserve(owner, requestId, hash(encoded), requiredRecord);
    if (previous) return styleDnaJson(previous.body, previous.status);
    if (selection) return executeEngine(owner, store, requestId, encoded, { ...selection, credentialVersion }, work, requiredRecord);
    const creds = deps.credentials();
    const saved = await creds?.open(owner, "reference");
    const model = saved?.models.image;
    let change: Change;
    if (!saved || !model) change = failure("not_configured", 503);
    else if (saved.version !== credentialVersion) change = failure("stale_credential", 409);
    else if (encoded.includes(saved.apiKey)) change = failure("invalid_input", 400);
    else {
      change = await runWork(work, { key: saved.apiKey, model });
      if (change.kind !== "failure") {
        if (!(await creds?.metadata(owner))?.some(item => item.group === "reference" && item.version === credentialVersion)) {
          change = failure("stale_credential", 409);
        }
      }
    }
    const response = await store.finish(owner, requestId, change, requiredRecord);
    return styleDnaJson(response.body, response.status);
  }

  return {
    list: () => withStore(async (owner, store) => {
      const creds = deps.credentials();
      const [items, configured] = await Promise.all([store.list(owner), creds?.metadata(owner)]);
      const settings = configured?.find(item => item.group === "reference");
      return styleDnaJson({ items, settings: { storage: "ready", credentialVersion: settings?.version ?? 0,
        analysisModel: settings?.models.image ?? null, testModels: Object.entries(styleDnaImageModels).map(([id, info]) => ({ id, ...info })) } });
    }),
    analyze: (request: Request) => withStore(async (owner, store) => {
      const input = await readAnalysisInput(request);
      if (input instanceof Response) return input;
      const { requestId, authorized, credentialVersion, engine, ...options } = input.options;
      const { source } = input;
      const key = source.kind === "file" ? { kind: source.kind, name: source.name, digest: hash(source.bytes) } : source;
      const intent = engine ? ["analyze-engine-v1", credentialVersion, engine, authorized, options, key]
        : ["analyze", credentialVersion, authorized, options, key];
      return execute(owner, store, requestId, credentialVersion, intent, async (settings, basis) => {
        if ((await store.list(owner)).length >= styleDnaLibraryLimit) return failure("limit_reached", 409);
        let analysisSource = source;
        if (source.kind === "record") {
          const image = await store.media(owner, source.id, source.id);
          if (!image) return failure("not_found", 404);
          analysisSource = { kind: "file", bytes: image, name: "source.webp" };
        }
        if (analysisSource.kind === "record") return failure("not_found", 404);
        const generated = await deps.provider.analyze(analysisSource, options, settings);
        const id = v7(), createdAt = stamp();
        const title = generated.semantic.findings.find(finding => finding.category === "context" && finding.certainty === "estimated");
        const record: StyleDnaRecord = { id, title: title?.certainty === "estimated" ? title.description.slice(0, 60) : "이미지 분석",
          mode: options.mode, options, revision: 1, result: generated.result, semantic: generated.semantic,
          original: imageDto(generated.original, id, "original"), createdAt, updatedAt: createdAt,
          revisions: [{ revision: 1, createdAt, prompts: generated.semantic.prompts, ...(basis && { engine: basis }) }], tests: [],
          ...(basis && { engine: basis }),
          ...(generated.styleDna && { styleDna: generated.styleDna }) };
        return { kind: "analysis", record, original: generated.original.bytes };
      }, engine, source.kind === "record" ? source.id : undefined);
    }, request, ["application/json", "multipart/form-data"]),
    get: (route: RecordRoute) => withStore(async (owner, store) => {
      const { id } = await route.params;
      const record = styleDnaId.safeParse(id).success && await store.get(owner, id, true);
      return record ? styleDnaJson({ record }) : problem("not_found", 404);
    }),
    remove: (request: Request, route: RecordRoute) => withStore(async (owner, store) => {
      const { id } = await route.params;
      if (!styleDnaId.safeParse(id).success || await readLimitedText(request, 0) !== "") return problem("invalid_input", 400);
      if (!await store.remove(owner, id)) return problem("not_found", 404);
      return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
    }, request, [""]),
    compare: (request: Request, route: RecordRoute) => withStore(async (owner, store) => {
      const { id } = await route.params;
      if (!styleDnaId.safeParse(id).success) return problem("not_found", 404);
      const value = await inputJson(request);
      if (value instanceof Response) return value;
      const parsed = styleDnaCompare.safeParse(value);
      if (!parsed.success) return problem("invalid_input", 400);
      const outcome = await store.compare(owner, id, parsed.data);
      return styleDnaJson(outcome.body, outcome.status);
    }, request),
    media: (route: MediaRoute) => withStore(async (owner, store) => {
      const { id, media } = await route.params;
      if (!styleDnaId.safeParse(id).success || (media !== "original" && !styleDnaId.safeParse(media).success)) return problem("not_found", 404);
      const image = await store.media(owner, id, media === "original" ? id : media);
      if (!image) return problem("not_found", 404);
      // Large generated images can exceed Vercel's non-streaming response limit.
      let offset = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          const end = Math.min(offset + 64 * 1024, image.byteLength);
          if (end > offset) controller.enqueue(image.subarray(offset, end));
          offset = end;
          if (offset === image.byteLength) controller.close();
        },
      });
      return new Response(body, { headers: { "content-type": "image/webp", "cache-control": "private, no-store",
        "x-content-type-options": "nosniff" } });
    }),
    refine: (request: Request, route: RecordRoute) => withStore(async (owner, store) => {
      const { id } = await route.params;
      const value = await inputJson(request);
      if (value instanceof Response) return value;
      const parsed = styleDnaRefine.safeParse(value);
      if (!styleDnaId.safeParse(id).success || !parsed.success) return problem("invalid_input", 400);
      const { requestId, credentialVersion, feedback, revision, engine } = parsed.data;
      const intent = engine ? ["refine-engine-v1", id, credentialVersion, engine, revision, feedback]
        : ["refine", id, credentialVersion, revision, feedback];
      return execute(owner, store, requestId, credentialVersion, intent, async (settings, basis) => {
        const record = await store.get(owner, id);
        if (!record) return failure("not_found", 404);
        const prior = record.revisions.at(-1);
        if (!prior || prior.revision !== revision) return failure("stale_revision", 409);
        if (record.revisions.length >= styleDnaLibraryLimit) return failure("limit_reached", 409);
        const { blueprint, style } = prior.styleDna ?? record.styleDna ?? {};
        const sections = blueprint || style ? { ...(blueprint && { blueprint }), ...(style && { style }) } : undefined;
        const { ko, en, note, styleDna } = await deps.provider.refine(record.options, prior, feedback, settings, sections);
        const next: StyleDnaRevision = { revision: revision + 1, prompts: { ko, en }, feedback, note, createdAt: stamp(),
          ...(basis && { engine: basis }),
          ...((sections || styleDna) && { styleDna: { ...sections, ...styleDna } }) };
        return { kind: "refine", recordId: id, baseRevision: revision, revision: next };
      }, engine, id);
    }, request),
    test: (request: Request, route: RecordRoute) => withStore(async (owner, store) => {
      const { id } = await route.params;
      if (!styleDnaId.safeParse(id).success) return problem("invalid_input", 400);
      const input = await readTestInput(request);
      if (input instanceof Response) return input;
      const { requestId, credentialVersion, ...intent } = input.options;
      const { upload } = input;
      const extended = intent.customPrompt !== undefined || upload !== undefined;

      async function prepare() {
        const record = await store.get(owner, id);
        if (!record) return failure("not_found", 404);
        const prior = record.revisions.find(item => item.revision === intent.revision);
        if (!prior) return failure("stale_revision", 409);
        if (!extended && record.tests.length >= styleDnaLibraryLimit) return failure("limit_reached", 409);

        let image: Buffer | undefined;
        let reference: StyleDnaTestBasis["reference"] = { kind: "none" };
        if (upload) {
          const measured = await measureStyleDnaImage(upload.bytes, upload.mime, 1600).catch(() => undefined);
          if (!measured) return failure("invalid_reference", 400);
          image = measured.bytes;
          reference = { kind: "upload", sha256: measured.sha256, sourceSha256: upload.sha256 };
        } else if (intent.attachImage) {
          image = await store.media(owner, id, id);
          if (!image) return failure("not_found", 404);
          if (hash(image) !== record.original.sha256) return failure("storage_unavailable", 503);
          reference = { kind: "original", sha256: record.original.sha256 };
        }

        const prompt = styleDnaTestPrompt(intent, prior, Boolean(image));
        if (!prompt) return failure("subject_required", 400);
        const basis: StyleDnaTestBasis = { promptMode: intent.customPrompt === undefined ? "revision" : "edited",
          promptSha256: hash(prompt), aspectRatio: intent.aspectRatio ?? closestRatio(record.original), credentialVersion, reference };
        return { kind: "ready" as const, record, prior, prompt, image, basis };
      }

      async function generate(prepared: Extract<Awaited<ReturnType<typeof prepare>>, { kind: "ready" }>, settings: GeminiSettings): Promise<Change> {
        const { record, prior, prompt, image, basis } = prepared;
        if (extended && record.tests.length >= styleDnaLibraryLimit) return failure("limit_reached", 409);
        const generated = await deps.provider.test({ model: intent.model, aspectRatio: basis.aspectRatio }, prompt, image, settings);
        const testId = v7();
        const test: StyleDnaTestResult = { id: testId, revision: prior.revision, model: intent.model, createdAt: stamp(),
          original: record.original, image: imageDto(generated, id, testId), ...(extended && { basis }) };
        return { kind: "test", recordId: id, image: generated.bytes, test };
      }

      if (extended) {
        const prepared = await prepare();
        if (prepared.kind === "failure") return styleDnaJson(prepared.outcome.body, prepared.outcome.status);
        return execute(owner, store, requestId, credentialVersion, ["test-options-v1", id, intent, prepared.prompt, prepared.basis],
          settings => generate(prepared, settings), undefined, id);
      }
      return execute(owner, store, requestId, credentialVersion, ["test", id, credentialVersion, intent], async settings => {
        const prepared = await prepare();
        return prepared.kind === "ready" ? generate(prepared, settings) : prepared;
      }, undefined, id);
    }, request, ["application/json", "multipart/form-data"]),
  };
}

export const styleDnaHttp = createStyleDnaHttp();
export type { StyleDnaProvider };
