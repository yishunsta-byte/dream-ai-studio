import "server-only";
import { createHash } from "node:crypto";
import { v7 } from "uuid";
import { readLimitedText, rejectForeignWrite } from "../public-showcase/admin-publication-http";
import { analyzeAdminAudio } from "./admin-audio-analysis-server";
import { ADMIN_AUDIO_REPORT_PROFILE_HEADER, EXPANDED_AUDIO_REPORT_PROFILE } from "./admin-audio-details-contract";
import { detailedAudioDeadlineMs } from "./admin-audio-details-server";
import { audioProviderDeadlineMs } from "./admin-audio-gemini";
import { audioJson, createAdminAudioAccess, readBounded, type AdminAudioAccessOptions } from "./admin-audio-http";
import { adminAudioChunkBytes, adminAudioUploadLimit, audioUploadCommand, audioUploadId, audioUploadStart, type AudioUploadAnalysis } from "./admin-audio-upload-contract";
import { AudioUploadError, withVerifiedAudio } from "./admin-audio-media";
import { createAdminAudioUploadProvider } from "./admin-audio-upload-provider";
import { audioUploadDto, openAdminAudioUploadStore, type AdminAudioUploadStore, type AudioUploadRow } from "./admin-audio-upload-store";
import { openRuntimeGeminiCredentialStore, type GeminiCredentialStore } from "./analysis-credential-store";
import { MUSIC_MODEL_VERSION_HEADER } from "./music-semantic-contract";

type Route = { params: Promise<{ id: string }> };
type Options = AdminAudioAccessOptions & { store?: () => AdminAudioUploadStore | null;
  credentials?: () => GeminiCredentialStore | null; send?: typeof fetch };
const problem = (code: string, status: number) => audioJson({ code }, status);
type Result = Awaited<ReturnType<AdminAudioUploadStore["claim"]>>;
function uploadResponses(expanded: boolean, includeModelVersion: boolean) {
  const problem = (code: string, status: number, row?: AudioUploadRow) =>
    audioJson({ code, ...(row && { upload: audioUploadDto(row, expanded, includeModelVersion) }) }, status);
  const state = (row: AudioUploadRow, status = 200) => audioJson({ upload: audioUploadDto(row, expanded, includeModelVersion) }, status);
  const reply = ({ status, row, code }: Result) =>
    code ? problem(code, status, row) : row ? state(row, status) : problem("not_found", 404);
  return { expanded, problem, state, reply };
}
type UploadResponses = ReturnType<typeof uploadResponses>;
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const terminal = (row: AudioUploadRow) => row.status === "completed" || row.status === "failed" || row.status === "cancelled" || row.status === "expired";

async function inputJson(request: Request) {
  const raw = await readLimitedText(request, 16 * 1024);
  if (raw === "too-large") return problem("too_large", 413);
  try { return JSON.parse(raw) as unknown; } catch { return problem("invalid_input", 400); }
}

export function createAdminAudioUploadHttp({ authenticate, env = process.env, store: openStore = openAdminAudioUploadStore,
  credentials = openRuntimeGeminiCredentialStore, send = fetch }: Options = {}) {
  const access = createAdminAudioAccess({ authenticate, env });
  const provider = createAdminAudioUploadProvider(send);
  const active = new Map<string, AbortController>();
  const operationKey = (owner: string, id: string) => `${owner}/${id}`;
  const withStore = (action: (owner: string, store: AdminAudioUploadStore, responses: UploadResponses) => Promise<Response>, request?: Request,
    types?: readonly string[]) => access.withAdmin(async owner => {
    if (request && request.method !== "GET" && request.method !== "HEAD") {
      const rejected = rejectForeignWrite(request, env, types);
      if (rejected) return rejected;
    }
    const profile = request?.headers.get(ADMIN_AUDIO_REPORT_PROFILE_HEADER) ?? null;
    if (profile !== null && profile !== EXPANDED_AUDIO_REPORT_PROFILE) return problem("invalid_report_profile", 400);
    const store = openStore();
    const includeModelVersion = request?.headers.get(MUSIC_MODEL_VERSION_HEADER) === "1";
    return store ? action(owner, store, uploadResponses(profile !== null, includeModelVersion)) : problem("storage_unavailable", 503);
  });

  async function currentSettings(owner: string) {
    const saved = await credentials()?.open(owner, "music");
    const model = saved?.models.music;
    return saved && model ? { key: saved.apiKey, model, version: saved.version } : undefined;
  }

  async function cleanup(owner: string, store: AdminAudioUploadStore, row: AudioUploadRow,
    originalSettings?: { key: string; version: number }) {
    if (!terminal(row) || row.cleanup !== "pending" || !row.provider_file) return row;
    const settings = originalSettings ?? await currentSettings(owner).catch(() => undefined);
    if (settings?.version !== row.credential_version || !await provider.cleanup(settings.key, row.provider_file)) return row;
    return await store.cleaned(owner, row.id, row.provider_file) ?? row;
  }

  async function analyze(owner: string, store: AdminAudioUploadStore, id: string, input: AudioUploadAnalysis,
    { expanded, problem, reply, state }: UploadResponses) {
    const { requestId, credentialVersion, mode, context, specialRequest, reportVersion } = input;
    if (expanded && reportVersion !== 2) return problem("invalid_report_profile", 400);
    const guidance = { context, specialRequest };
    const key = fingerprint(expanded ? [EXPANDED_AUDIO_REPORT_PROFILE, input] : input);
    const original = await store.get(owner, id);
    if (!original) return problem("not_found", 404);
    if (original.status === "expired") return problem("expired", 410, original);
    if (original.analysis_id) return reply(await store.claim(owner, id, requestId, key, credentialVersion));
    const settings = await currentSettings(owner);
    if (!settings) return problem("not_configured", 503);
    if (settings.version !== credentialVersion || original.credential_version !== credentialVersion) return problem("stale_credential", 409, original);
    if (JSON.stringify(guidance).includes(settings.key)) return problem("invalid_input", 400, original);
    const claimed = await store.claim(owner, id, requestId, key, credentialVersion);
    if (!claimed.claimed || !claimed.row) return reply(claimed);

    const operation = operationKey(owner, id);
    const controller = new AbortController();
    active.set(operation, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(145_000)]);
    async function beforeSend() {
      signal.throwIfAborted();
      const current = await store.get(owner, id);
      if (current?.status !== "analyzing" || current.analysis_id !== requestId) throw new AudioUploadError("processing_stopped");
      const live = (await credentials()?.metadata(owner))?.some(item => item.group === "music" && item.version === credentialVersion);
      if (!live) throw new AudioUploadError("stale_credential");
      signal.throwIfAborted();
    }

    let outcome: Parameters<AdminAudioUploadStore["finish"]>[3];
    let failureStatus = 200;
    try {
      const report = await withVerifiedAudio({ filename: claimed.row.filename, sizeBytes: claimed.row.size_bytes, signal,
        read: offset => store.chunk(owner, id, requestId, offset) }, async audio => {
        const uploaded = await provider.upload(settings.key, audio, signal, beforeSend,
          name => store.recordFile(owner, id, requestId, name));
        const modelSignal = AbortSignal.any([signal, AbortSignal.timeout(reportVersion === 2 ? detailedAudioDeadlineMs : audioProviderDeadlineMs)]);
        const verifiedSend: typeof fetch = async (url, init) => {
          await beforeSend();
          modelSignal.throwIfAborted();
          return send(url, init);
        };
        const result = await analyzeAdminAudio(mode, uploaded, settings, modelSignal, verifiedSend, guidance,
          reportVersion === 2 ? audio.measurement : undefined, expanded);
        await beforeSend();
        return result;
      });
      if (JSON.stringify(report).includes(settings.key)) {
        outcome = { code: "invalid_response" };
        failureStatus = 502;
      } else if (report.status === "unavailable" && report.reason !== "undetermined") {
        outcome = { code: report.reason };
        failureStatus = report.reason === "timed_out" ? 504 : 502;
      } else outcome = { report };
    } catch (error) {
      const code = error instanceof AudioUploadError ? error.code : signal.aborted ? "timed_out" : "provider_error";
      outcome = { code, ...(error instanceof AudioUploadError && error.uncertain && { uncertain: true }) };
      failureStatus = code === "invalid_file" ? 422 : code === "timed_out" ? 504 : code === "media_unavailable" ? 503 :
        code === "processing_stopped" || code === "stale_credential" ? 409 : 502;
    } finally {
      active.delete(operation);
    }
    const finished = await store.finish(owner, id, requestId, outcome);
    if (!finished) return problem("not_found", 404);
    const final = await cleanup(owner, store, finished, settings);
    if (final.status === "cancelled") return problem("cancelled", 409, final);
    if (final.status === "expired") return problem("expired", 410, final);
    return "code" in outcome ? problem(outcome.code, failureStatus, final) : state(final);
  }

  return {
    start: (request: Request) => withStore(async (owner, store, { reply }) => {
      const raw = await inputJson(request);
      if (raw instanceof Response) return raw;
      if (raw && typeof raw === "object" && "sizeBytes" in raw && typeof raw.sizeBytes === "number" && raw.sizeBytes > adminAudioUploadLimit) {
        return problem("too_large", 413);
      }
      const parsed = audioUploadStart.safeParse(raw);
      if (!parsed.success) return problem("invalid_input", 400);
      const settings = await currentSettings(owner);
      if (!settings) return problem("not_configured", 503);
      if (parsed.data.credentialVersion !== settings.version) return problem("stale_credential", 409);
      if (parsed.data.filename.includes(settings.key)) return problem("invalid_input", 400);
      return reply(await store.start(owner, v7(), parsed.data, fingerprint(parsed.data)));
    }, request),
    get: (route: Route, request?: Request) => withStore(async (owner, store, { state }) => {
      const { id } = await route.params;
      const current = audioUploadId.safeParse(id).success && await store.get(owner, id);
      return current ? state(current) : problem("not_found", 404);
    }, request),
    append: (request: Request, route: Route) => withStore(async (owner, store, { problem, reply }) => {
      const { id } = await route.params;
      const current = audioUploadId.safeParse(id).success && await store.get(owner, id);
      if (!current) return problem("not_found", 404);
      if (current.status === "expired") return problem("expired", 410, current);
      if (current.status !== "uploading" && current.status !== "uploaded") return problem("upload_closed", 409, current);
      const settings = await currentSettings(owner);
      if (!settings || settings.version !== current.credential_version) return problem("stale_credential", 409, current);
      const rawOffset = request.headers.get("x-dream-upload-offset");
      if (!rawOffset || !/^\d{1,9}$/.test(rawOffset) || Number(rawOffset) >= adminAudioUploadLimit) return problem("invalid_offset", 400, current);
      const declared = request.headers.get("content-length");
      if (declared !== null && (!/^\d{1,9}$/.test(declared) || Number(declared) > adminAudioChunkBytes)) return problem("too_large", 413, current);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(18_000)]);
      const bytes = await readBounded(request.body, adminAudioChunkBytes, signal).catch(() => undefined);
      if (!bytes) return signal.aborted ? problem("timed_out", 408, current) : problem("too_large", 413, current);
      return reply(await store.append(owner, id, Number(rawOffset), bytes, settings.version));
    }, request, ["application/octet-stream"]),
    command: (request: Request, route: Route) => withStore(async (owner, store, responses) => {
      const { id } = await route.params;
      if (!audioUploadId.safeParse(id).success) return problem("not_found", 404);
      const raw = await inputJson(request);
      if (raw instanceof Response) return raw;
      const parsed = audioUploadCommand.safeParse(raw);
      if (!parsed.success) return problem("invalid_input", 400);
      if (parsed.data.action === "analyze") return analyze(owner, store, id, parsed.data, responses);
      const row = parsed.data.action === "cancel" ? await store.cancel(owner, id) : await store.get(owner, id);
      if (!row) return problem("not_found", 404);
      if (parsed.data.action === "cancel" && row.status === "cancelled") active.get(operationKey(owner, id))?.abort();
      return responses.state(await cleanup(owner, store, row));
    }, request),
  };
}

export const adminAudioUploads = createAdminAudioUploadHttp();
