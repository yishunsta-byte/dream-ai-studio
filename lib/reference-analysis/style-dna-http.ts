import "server-only";
import { createHash } from "node:crypto";
import { v7 } from "uuid";
import { readBoundedUpload } from "../cloud/read-bounded-upload";
import { readLimitedText, rejectForeignWrite } from "../public-showcase/admin-publication-http";
import { openRuntimeGeminiCredentialStore, openRuntimeStyleDnaEngineCredentialStore } from "./analysis-credential-store";
import type { GeminiSettings } from "./analysis-gemini-settings";
import { referenceFileFormat, referenceUploadByteLimit } from "./input";
import { AnalysisStageError, MediaUrlError } from "./media-url-error";
import { styleDnaAnalyze, styleDnaAnalyzeSource, styleDnaCompare, styleDnaId, styleDnaImageModels, styleDnaPath, styleDnaPromptTargets, styleDnaRatio, styleDnaRefine, styleDnaRequestId,
  styleDnaGeneratedModels, styleDnaGeneratedTest, styleDnaGeneratedTestWithReference, styleDnaFluxTest, styleDnaFluxTestWithReference, styleDnaGenerationRequestModel, styleDnaGptImageTest, styleDnaGptImageTestWithReference, styleDnaUsageGeneratedModels, type StyleDnaGptImageTestOptions, type StyleDnaUsageGenerationModelSetting,
  styleDnaTest, styleDnaTestWithReference, type StyleDnaFluxTestOptions, type StyleDnaGeneratedTestOptions, type StyleDnaGenerationEstimate,
  type StyleDnaGeneratedModel, type StyleDnaGenerationModelSetting, type StyleDnaGenerationRequestModel, type StyleDnaMedia, type StyleDnaRecord, type StyleDnaRecordedEngine, type StyleDnaRevision, type StyleDnaTestBasis,
  type StyleDnaTestOptions, type StyleDnaTestResult } from "./style-dna-contract";
import { createStyleDnaProvider, measureStyleDnaImage, styleDnaTestPrompt, StyleDnaProviderError,
  type MeasuredStyleDnaImage, type StyleDnaAnalysisSettings, type StyleDnaProvider, type StyleDnaSource } from "./style-dna-provider";
import type { StyleDnaEngineBasis, StyleDnaEngineSelection } from "./style-dna-engine-credential-contract";
import { openStyleDnaStore, styleDnaLibraryLimit, type StyleDnaStore } from "./style-dna-store";
import { createStyleDnaAdminAccess, styleDnaAdminDefaults, styleDnaJson } from "./style-dna-admin-http";
import { SeedreamGenerationError, seedreamEstimate, seedreamFailureStatus, seedreamModelId, seedreamOutput, seedreamTestModel,
  type SeedreamCredential, type SeedreamCredentials, type SeedreamEstimate, type SeedreamGenerator } from "./style-dna-seedream-provider";
import { FluxGenerationError, fluxEstimate, fluxOutput, fluxReferenceDimensions, fluxTestModel, type FluxGenerator } from "./style-dna-flux-provider";
import { gptImageEstimate, gptImageModelId, gptImageOutput, gptImageTestModel, type GptImageGenerator } from "./style-dna-gpt-image-provider";
import { runtimeImageGenerators } from "./style-dna-generation-runtime";

const defaults = { authenticate: styleDnaAdminDefaults.authenticate, env: styleDnaAdminDefaults.env,
  store: openStyleDnaStore, credentials: openRuntimeGeminiCredentialStore, engineCredentials: openRuntimeStyleDnaEngineCredentialStore,
  provider: createStyleDnaProvider() };
const problem = (code: string, status: number) => styleDnaJson({ code }, status);
const bodySize = 10_240;
type UploadSource = StyleDnaSource | { kind: "record"; id: string };
type RecordRoute = { params: Promise<{ id: string }> };
type MediaRoute = { params: Promise<{ id: string; media: string }> };
type Change = Parameters<StyleDnaStore["finish"]>[2];
type Work = (settings: StyleDnaAnalysisSettings, engine: StyleDnaRecordedEngine) => Promise<Change>;
const failure = (code: string, status: number): Extract<Change, { kind: "failure" }> =>
  ({ kind: "failure", outcome: { status, body: { code } } });
const providerStatus = { subject_required: 400, stale_credential: 409, storage_unavailable: 503, timed_out: 504,
  model_error: 502, invalid_model_response: 502 } as const;

async function runWork(work: Work, settings: StyleDnaAnalysisSettings, engine: StyleDnaRecordedEngine): Promise<Change> {
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

// Seedream 5.5 시험 입력(계약 styleDnaGeneratedTest). 생성기가 있을 때만 받는다(기본 앱은 생성 키 저장소에 지연 연결).
type ImageGenerators = { seedream?: SeedreamGenerator; flux?: FluxGenerator; gptImage?: GptImageGenerator };
type TestInput = { options: StyleDnaTestOptions | StyleDnaGeneratedTestOptions | StyleDnaFluxTestOptions | StyleDnaGptImageTestOptions;
  upload?: { bytes: Buffer; mime: string; sha256: string } };

async function readTestInput(request: Request, generators?: ImageGenerators): Promise<TestInput | Response> {
  const paid = (raw: unknown, reference: boolean) => {
    const seedream = generators?.seedream && (reference ? styleDnaGeneratedTestWithReference : styleDnaGeneratedTest).safeParse(raw);
    if (seedream?.success) return seedream;
    const flux = generators?.flux && (reference ? styleDnaFluxTestWithReference : styleDnaFluxTest).safeParse(raw);
    if (flux?.success) return flux;
    return generators?.gptImage && (reference ? styleDnaGptImageTestWithReference : styleDnaGptImageTest).safeParse(raw);
  };
  if (!isImageForm(request)) {
    const json = await inputJson(request);
    if (json instanceof Response) return json;
    const parsed = styleDnaTest.safeParse(json);
    if (parsed.success) return { options: parsed.data };
    const alternative = paid(json, false);
    return alternative?.success ? { options: alternative.data } : problem("invalid_input", 400);
  }

  const form = await readImageForm(request, "customReference");
  if (form instanceof Response) return form;
  const gemini = styleDnaTestWithReference.safeParse(form.options);
  const alternative = gemini.success ? undefined : paid(form.options, true);
  const parsed = gemini.success ? gemini : alternative;
  if (!parsed?.success) return problem("invalid_input", 400);
  const format = referenceFileFormat(form.file.name);
  if (format?.media !== "image") return problem("unsupported_format", 400);
  const mime = format.mimes[0];
  const declaredType = form.file.type;
  if (declaredType && declaredType !== "application/octet-stream" && declaredType !== mime) return problem("invalid_reference", 400);
  const bytes = Buffer.from(await form.file.arrayBuffer());
  if (!("customReferenceSha256" in parsed.data) || typeof parsed.data.customReferenceSha256 !== "string") return problem("invalid_input", 400);
  const { customReferenceSha256, ...options } = parsed.data;
  if (hash(bytes) !== customReferenceSha256) return problem("reference_mismatch", 400);
  return { options, upload: { bytes, mime, sha256: customReferenceSha256 } };
}

// 생성 모델 목록은 등록 버전과 기본 견적을 제공한다. 실제 참조의 크기는 요청에서 다시 측정한다.
// 저장소가 metadata를 주면 키를 복호화하지 않고 버전만 읽는다.
async function generationListing(owner: string, credentials: SeedreamCredentials, model: StyleDnaGeneratedModel,
  none: StyleDnaGenerationEstimate, one: StyleDnaGenerationEstimate): Promise<StyleDnaGenerationModelSetting[]> {
  const saved = await (credentials.metadata ? credentials.metadata(owner) : credentials.open(owner)).catch(() => undefined);
  if (!saved || !Number.isInteger(saved.version) || saved.version < 1) return [];
  const info = styleDnaGeneratedModels[model];
  return [{ id: model, label: info.label, vendor: info.vendor, provider: info.provider, modelId: info.modelId, size: info.size,
    aspectRatio: info.aspectRatio, credentialVersion: saved.version,
    estimate: { priceTable: none.priceTable, currency: none.currency, unit: none.unit, withoutReference: none.totalMicros, withReference: one.totalMicros } }];
}

// usage 기반 모델 줄(GPT Image 2.6): 금액 칸 없이 kind usage_based 견적만 싣는다.
async function usageGenerationListing(owner: string, credentials: SeedreamCredentials): Promise<StyleDnaUsageGenerationModelSetting[]> {
  const saved = await (credentials.metadata ? credentials.metadata(owner) : credentials.open(owner)).catch(() => undefined);
  if (!saved || !Number.isInteger(saved.version) || saved.version < 1) return [];
  const info = styleDnaUsageGeneratedModels[gptImageTestModel];
  return [{ id: gptImageTestModel, label: info.label, vendor: info.vendor, provider: info.provider, modelId: info.modelId, size: info.size,
    aspectRatio: info.aspectRatio, credentialVersion: saved.version, estimate: gptImageEstimate() }];
}

async function runGeneration(work: () => Promise<Change>): Promise<Change> {
  try { return await work(); }
  catch (error) {
    if (error instanceof FluxGenerationError) {
      if (error.keepPending) throw error;
      return failure(error.code, seedreamFailureStatus[error.code]);
    }
    if (error instanceof SeedreamGenerationError) {
      // 키·프롬프트 없이 분류만 남긴다. 기록(요청 결과) 코드로 보내기 전 실패와 제출 불명을 구분한다.
      console.warn("style_dna_generation_failed", { code: error.code, submission: error.submission, providerStatus: error.providerStatus });
      return failure(error.code, seedreamFailureStatus[error.code]);
    }
    return failure("model_error", 502);
  }
}

export function createStyleDnaHttp(overrides: Partial<typeof defaults> & { imageGenerators?: ImageGenerators } = {}) {
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

  // 생성 요청의 끝을 기록한다. 기록 거래가 실패하면 같은 요청 영수증을 다시 읽어, 이미 확정된 결과는 그대로 돌려주고
  // (다시 쓰지 않음) 확인하지 못하면 result_unconfirmed(503)로 답한다. 이때 영수증은 처리 중(같은 번호 재요청은 202)으로 남는다.
  async function unconfirmedGeneration(owner: string, store: StyleDnaStore, requestId: string) {
    const receipt = await store.receipt?.(owner, requestId).catch(() => undefined);
    if (receipt?.outcome) return styleDnaJson(receipt.outcome.body, receipt.outcome.status);
    console.warn("style_dna_generation_unconfirmed", { stage: "finish" });
    const model = styleDnaGenerationRequestModel.safeParse(receipt?.model).data;
    return styleDnaJson({ code: "result_unconfirmed", ...(model && { model }) }, 503);
  }

  async function settleGeneration(owner: string, store: StyleDnaStore, requestId: string, change: Change, requiredRecord: string) {
    try {
      const outcome = await store.finish(owner, requestId, change, requiredRecord);
      return styleDnaJson(outcome.body, outcome.status);
    } catch { return unconfirmedGeneration(owner, store, requestId); }
  }

  // 생성 공급자 실행. 기존 요청 예약(같은 키·입력은 재응답, 다른 입력 409, 진행 중 202)을 그대로 써서
  // 재접수·동시 실행에서 공급자 POST가 다시 나가지 않는다. 성공은 키 버전이 그대로일 때만 확정한다.
  async function executeGenerator(owner: string, store: StyleDnaStore, requestId: string, credentialVersion: number, intent: unknown,
    credentials: SeedreamCredentials, work: (credential: SeedreamCredential) => Promise<Change>, requiredRecord: string,
    model: StyleDnaGenerationRequestModel, keepUnconfirmed = false) {
    const encoded = JSON.stringify(intent);
    const previous = await store.reserve(owner, requestId, hash(encoded), requiredRecord, model);
    if (previous) return styleDnaJson(previous.body, previous.status);
    let change: Change;
    try {
      const saved = await credentials.open(owner);
      if (!saved) change = failure("not_configured", 503);
      else if (saved.version !== credentialVersion) change = failure("stale_credential", 409);
      else if (encoded.includes(saved.apiKey)) change = failure("invalid_input", 400);
      else {
        change = await runGeneration(() => work(saved));
        if (change.kind !== "failure") {
          const done = change;
          let outcome: Awaited<ReturnType<StyleDnaStore["finish"]>> | undefined;
          try {
            outcome = await credentials.whileCurrent(owner, saved.version, () => store.finish(owner, requestId, done, requiredRecord));
          } catch {
            // 결과 저장(Style DNA DB)과 키 행 거래(키 DB)는 원자적이지 않다. 결과가 커밋된 뒤 키 거래만 실패했을 수 있다.
            // 실패 기록은 아직 결과가 없는 영수증에만 들어가므로(finish가 확정 영수증을 거절) 먼저 시도하고, 거절되면
            // settleGeneration이 같은 요청 영수증을 읽어 확정된 결과를 그대로 돌려준다. 공급자 재호출·결과 재기록은 없다.
            if (keepUnconfirmed) return unconfirmedGeneration(owner, store, requestId);
            return settleGeneration(owner, store, requestId, failure("storage_unavailable", 503), requiredRecord);
          }
          if (outcome) return styleDnaJson(outcome.body, outcome.status);
          if (keepUnconfirmed) return unconfirmedGeneration(owner, store, requestId);
          change = failure("stale_credential", 409);
        }
      }
    } catch (error) {
      // Uncertain remote submissions and lost results keep the paid reservation fenced across requests.
      if (error instanceof FluxGenerationError && error.keepPending) {
        return styleDnaJson({ code: error.code, requestId, model }, seedreamFailureStatus[error.code]);
      }
      change = failure("storage_unavailable", 503);
    }
    return settleGeneration(owner, store, requestId, change, requiredRecord);
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
      change = await runWork(work, { key: saved.apiKey, model }, { provider: "gemini", modelId: model, credentialVersion });
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
      const engineStore = deps.engineCredentials();
      const [items, configured, engines] = await Promise.all([store.list(owner), creds?.metadata(owner),
        engineStore ? engineStore.metadata(owner).catch(() => null) : null]);
      const settings = configured?.find(item => item.group === "reference");
      // 분석 엔진 설정 상태(키 값 없이 등록 여부·모델·버전만). 화면은 configured인 엔진만 고를 수 있다.
      const engineState = (provider: "openai" | "anthropic") => {
        const saved = engines?.[provider];
        return saved ? { provider, configured: true, modelId: saved.modelId, version: saved.version }
          : { provider, configured: false, modelId: null, version: 0 };
      };
      // 생성 공급자: 생성기가 주입된 서버에서만 칸을 싣고, 소유자 키가 준비된 모델만 넣는다(키 원문 없이 등록 버전·견적만).
      const seedream = deps.imageGenerators?.seedream;
      const flux = deps.imageGenerators?.flux;
      const gptImage = deps.imageGenerators?.gptImage;
      const generationModels = seedream || flux || gptImage ? (await Promise.all<(StyleDnaGenerationModelSetting | StyleDnaUsageGenerationModelSetting)[] | undefined>([
        seedream && generationListing(owner, seedream.credentials, seedreamTestModel, seedreamEstimate(0), seedreamEstimate(1)),
        flux && generationListing(owner, flux.credentials, fluxTestModel, fluxEstimate(), fluxEstimate(fluxOutput)),
        gptImage && usageGenerationListing(owner, gptImage.credentials),
      ])).flatMap(items => items ?? []) : undefined;
      return styleDnaJson({ items, settings: { storage: "ready", credentialVersion: settings?.version ?? 0,
        analysisModel: settings?.models.image ?? null, testModels: Object.entries(styleDnaImageModels).map(([id, info]) => ({ id, ...info })),
        promptTargets: styleDnaPromptTargets,
        analysisEngines: [{ provider: "gemini", configured: Boolean(settings), modelId: settings?.models.image ?? null, version: settings?.version ?? 0 },
          engineState("openai"), engineState("anthropic")],
        engineStorage: !engineStore ? "not_configured" : engines ? "ready" : "unavailable",
        ...(generationModels && { generationModels }) } });
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
          revisions: [{ revision: 1, createdAt, prompts: generated.semantic.prompts, engine: basis }], tests: [], engine: basis,
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
        const next: StyleDnaRevision = { revision: revision + 1, prompts: { ko, en }, feedback, note, createdAt: stamp(), engine: basis,
          ...((sections || styleDna) && { styleDna: { ...sections, ...styleDna } }) };
        return { kind: "refine", recordId: id, baseRevision: revision, revision: next };
      }, engine, id);
    }, request),
    generationStatus: (request: Request, route: RecordRoute) => withStore(async (owner, store) => {
      const { id } = await route.params;
      const requestId = new URL(request.url).searchParams.get("requestId");
      if (!styleDnaId.safeParse(id).success || (requestId !== null && !styleDnaRequestId.safeParse(requestId).success)) {
        return problem("invalid_input", 400);
      }
      if (!store.generationStatus) return problem("storage_unavailable", 503);
      const state = await store.generationStatus(owner, id, requestId ?? undefined);
      if (state.kind === "missing") return problem("not_found", 404);
      if (state.kind === "idle") return styleDnaJson({ pending: false });
      const model = styleDnaGenerationRequestModel.safeParse(state.model).data;
      const identity = { requestId: state.requestId, ...(model && { model }) };
      if (!state.outcome) return styleDnaJson({ code: "in_progress", ...identity }, 202);
      const { status, body } = state.outcome;
      // A stored failure can have the same status and code as a temporary failure to read the receipt.
      const outcome = { ...body };
      delete outcome.model;
      return styleDnaJson({ ...outcome, ...identity, settled: true }, status === 201 ? 200 : status);
    }),
    test: (request: Request, route: RecordRoute) => withStore(async (owner, store) => {
      const { id } = await route.params;
      if (!styleDnaId.safeParse(id).success) return problem("invalid_input", 400);
      const seedream = deps.imageGenerators?.seedream;
      const flux = deps.imageGenerators?.flux;
      const input = await readTestInput(request, deps.imageGenerators);
      if (input instanceof Response) return input;
      const { requestId, credentialVersion, ...intent } = input.options;
      const { upload } = input;
      const paid = "expectedCostMicros" in input.options ? input.options : undefined;
      const usageBased = "billing" in input.options ? input.options : undefined;
      const geminiModel = "expectedCostMicros" in input.options || "billing" in input.options ? undefined : input.options.model;
      const generated = paid !== undefined || usageBased !== undefined;
      const extended = intent.customPrompt !== undefined || upload !== undefined || generated;

      async function paidPreparationFailure(change: Extract<Change, { kind: "failure" }>) {
        const { status, body } = change.outcome;
        if (status !== 404) return styleDnaJson(body, status);
        const receipt = await store.generationStatus?.(owner, id, requestId).catch(() => undefined);
        const model = receipt?.kind === "request" && styleDnaGenerationRequestModel.safeParse(receipt.model).data;
        return styleDnaJson({ ...body, ...(model && { model }) }, status);
      }

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
          promptSha256: hash(prompt), aspectRatio: generated ? "1:1" : intent.aspectRatio ?? closestRatio(record.original), credentialVersion, reference };
        return { kind: "ready" as const, record, prior, prompt, image, basis };
      }

      async function generate(prepared: Extract<Awaited<ReturnType<typeof prepare>>, { kind: "ready" }>, settings: GeminiSettings): Promise<Change> {
        const { record, prior, prompt, image, basis } = prepared;
        if (!geminiModel) return failure("invalid_input", 400);
        if (extended && record.tests.length >= styleDnaLibraryLimit) return failure("limit_reached", 409);
        const generated = await deps.provider.test({ model: geminiModel, aspectRatio: basis.aspectRatio }, prompt, image, settings);
        const testId = v7();
        const test: StyleDnaTestResult = { id: testId, revision: prior.revision, model: geminiModel, createdAt: stamp(),
          original: record.original, image: imageDto(generated, id, testId), ...(extended && { basis }) };
        return { kind: "test", recordId: id, image: generated.bytes, test };
      }

      async function generateSeedream(prepared: Extract<Awaited<ReturnType<typeof prepare>>, { kind: "ready" }>, generator: SeedreamGenerator,
        credential: SeedreamCredential, estimate: SeedreamEstimate): Promise<Change> {
        const { record, prior, prompt, image, basis } = prepared;
        if (record.tests.length >= styleDnaLibraryLimit) return failure("limit_reached", 409);
        const result = await generator.adapter.generate({ apiKey: credential.apiKey, prompt, reference: image });
        const testId = v7();
        // 원본 PNG는 SHA·크기만 남기고, 보호 미디어에는 기존 계약대로 정규화 WebP를 저장한다.
        // 예상가와 실제 청구는 별개라 billing은 미확정으로 둔다.
        const test: StyleDnaTestResult = { id: testId, revision: prior.revision, model: seedreamTestModel, createdAt: stamp(),
          original: record.original, image: imageDto(result.image, id, testId), basis,
          generation: { provider: "byteplus", modelId: seedreamModelId, size: seedreamOutput.size, png: result.png,
            usage: result.usage, estimate, billing: "unconfirmed" } };
        return { kind: "test", recordId: id, image: result.image.bytes, test };
      }

      // GPT Image 2.6(usage 기반): 누르기 전 금액이 없어 금액 재확인(409 estimate_changed) 단계가 없다.
      // 실제 금액은 생성 뒤 공급자 usage로만 계산하고(gptImageUsage), billing은 계속 미확정이다.
      if (usageBased?.model === gptImageTestModel) {
        const gptImage = deps.imageGenerators?.gptImage;
        if (!gptImage) return problem("invalid_input", 400);
        const prepared = await prepare();
        if (prepared.kind === "failure") return paidPreparationFailure(prepared);
        const estimate = { ...gptImageEstimate(), referenceCount: prepared.image ? 1 as const : 0 as const };
        return executeGenerator(owner, store, requestId, credentialVersion,
          ["test-gpt-image-v1", id, intent, prepared.prompt, prepared.basis, estimate], gptImage.credentials, async credential => {
            if (prepared.record.tests.length >= styleDnaLibraryLimit) return failure("limit_reached", 409);
            const result = await gptImage.adapter.generate({ apiKey: credential.apiKey, prompt: prepared.prompt, reference: prepared.image,
              outerSignal: request.signal });
            const testId = v7();
            const test: StyleDnaTestResult = { id: testId, revision: prepared.prior.revision, model: gptImageTestModel, createdAt: stamp(),
              original: prepared.record.original, image: imageDto(result.image, id, testId), basis: prepared.basis,
              generation: { provider: "openai", modelId: gptImageModelId, size: gptImageOutput.size, png: result.png, usage: result.usage,
                estimate, ...(result.actualCostMicros !== undefined && { actualCostMicros: result.actualCostMicros }), billing: "unconfirmed" } };
            return { kind: "test", recordId: id, image: result.image.bytes, test };
          }, id, gptImageTestModel, true);
      }
      if (paid?.model === fluxTestModel) {
        if (!flux) return problem("invalid_input", 400);
        const prepared = await prepare();
        if (prepared.kind === "failure") return paidPreparationFailure(prepared);
        const dimensions = prepared.image ? await fluxReferenceDimensions(prepared.image).catch(() => undefined) : undefined;
        if (prepared.image && !dimensions) return problem("invalid_reference", 400);
        const estimate = fluxEstimate(dimensions);
        if (estimate.totalMicros !== paid.expectedCostMicros) return styleDnaJson({ code: "estimate_changed", estimate }, 409);
        return executeGenerator(owner, store, requestId, credentialVersion,
          ["test-flux2-v1", id, intent, prepared.prompt, prepared.basis, estimate], flux.credentials, async credential => {
            if (prepared.record.tests.length >= styleDnaLibraryLimit) return failure("limit_reached", 409);
            const result = await flux.adapter.generate({ apiKey: credential.apiKey, prompt: prepared.prompt, reference: prepared.image,
              outerSignal: request.signal });
            const testId = v7();
            const test: StyleDnaTestResult = { id: testId, revision: prepared.prior.revision, model: fluxTestModel, createdAt: stamp(),
              original: prepared.record.original, image: imageDto(result.image, id, testId), basis: prepared.basis,
              generation: { provider: "bfl", modelId: fluxTestModel, size: fluxOutput.size, png: result.png, usage: result.usage,
                estimate, billing: "unconfirmed" } };
            return { kind: "test", recordId: id, image: result.image.bytes, test };
          }, id, fluxTestModel, true);
      }
      if (paid?.model === seedreamTestModel) {
        if (!seedream) return problem("invalid_input", 400);
        const prepared = await prepare();
        if (prepared.kind === "failure") return paidPreparationFailure(prepared);
        const estimate = seedreamEstimate(prepared.image ? 1 : 0);
        // 누르기 전에 본 금액과 다르면 예약 전에 멈춘다(기록·공급자 요청 없음). 상한은 두지 않는다.
        if (estimate.totalMicros !== paid.expectedCostMicros) return styleDnaJson({ code: "estimate_changed", estimate }, 409);
        return executeGenerator(owner, store, requestId, credentialVersion, ["test-seedream-v1", id, intent, prepared.prompt, prepared.basis, estimate],
          seedream.credentials, credential => generateSeedream(prepared, seedream, credential, estimate), id, seedreamTestModel);
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

export const styleDnaHttp = createStyleDnaHttp({ imageGenerators: runtimeImageGenerators() });
export type { StyleDnaProvider };
