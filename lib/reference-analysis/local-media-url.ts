import "server-only";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { analyzeRegisteredReferenceSnapshot } from "./registered-snapshot";
import {
  classifyReferenceInput, referenceFileByteLimit, referenceFileFormat, referenceUploadByteLimit, type ReferenceMedia,
} from "./input";
import { AnalysisStageError, MediaUrlError, errorKind } from "./media-url-error";
import { proposalsForLocalReference } from "./project-preview";

// Additional origins are supplied only by the local operator CLI; the web action always uses the fixed origins.
const publicOrigins = new Set(["https://interactive-examples.mdn.mozilla.net", "https://tonejs.github.io", "https://mdn.github.io"]);

function checkFormat(name: string, selectedMedia?: ReferenceMedia) {
  const format = referenceFileFormat(name);
  if (!format) throw new MediaUrlError("unsupported_format", "지원하는 이미지·음악·영상 파일 확장자가 필요합니다.");
  if (selectedMedia && format.media !== selectedMedia) {
    throw new MediaUrlError("file_type_mismatch", "선택한 미디어와 파일 형식이 다릅니다.");
  }
}

function analysisDeadline(requestSignal?: AbortSignal) {
  const deadline = AbortSignal.timeout(30_000);
  const signal = requestSignal ? AbortSignal.any([deadline, requestSignal]) : deadline;
  return {
    signal,
    interruption(active = signal) {
      if (!active.aborted) return;
      // The first signal wins even when an external caller supplies a TimeoutError.
      return deadline.aborted && active.reason === deadline.reason ? "timed_out" : "cancelled";
    },
  };
}

export async function analyzeLocalMediaUrl(
  input: string, operatorOrigin?: string, requestSignal?: AbortSignal, selectedMedia?: ReferenceMedia,
) {
  let url: URL;
  try { url = new URL(input); }
  catch { throw new MediaUrlError("invalid_url", "유효한 HTTPS 직접 파일 주소를 사용하세요."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    (url.port && url.port !== "443")) {
    throw new MediaUrlError("invalid_url", "유효한 HTTPS 직접 파일 주소를 사용하세요.");
  }
  if (!publicOrigins.has(url.origin) && operatorOrigin !== url.origin) {
    throw new MediaUrlError("unsupported_origin", "허용된 HTTPS 원본의 직접 파일 URL을 사용하세요. 다른 공개 원본은 --origin으로 명시하세요.");
  }
  const name = "source" + extname(url.pathname).toLowerCase();
  checkFormat(name, selectedMedia);

  const deadline = analysisDeadline(requestSignal);
  let response: Response;
  try { response = await fetch(url, { redirect: "error", credentials: "omit", cache: "no-store", signal: deadline.signal }); }
  catch (error) { throw new AnalysisStageError("fetch", deadline.interruption() ?? errorKind(error)); }
  if (Number(response.headers.get("content-length")) > referenceFileByteLimit) {
    await response.body?.cancel();
    throw new MediaUrlError("too_large", "파일 크기 한도를 초과했습니다.");
  }
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new AnalysisStageError("fetch", `status_${response.status}`);
  }

  const result = await analyzeBody(response.body, name, referenceFileByteLimit, deadline, selectedMedia);
  return { ...result, sourceUrl: url.href };
}

export async function analyzeLocalMediaUpload(request: Request, filename: string, selectedMedia: ReferenceMedia) {
  // Reuse the filename rules, then discard the client-supplied stem before touching disk.
  const classified = classifyReferenceInput({ kind: "file", name: filename, sizeBytes: 1, permission: "authorized" });
  if (classified.status === "invalid" && classified.reason === "unsupported_file_type") {
    throw new MediaUrlError("unsupported_format", "지원하는 이미지·음악·영상 파일 확장자가 필요합니다.");
  }
  if (classified.status !== "ready" || classified.source.kind !== "file") {
    throw new MediaUrlError("invalid_file", "올바른 파일명이 필요합니다.", 400);
  }
  const name = "source" + extname(filename).toLowerCase();
  checkFormat(name, selectedMedia);
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d{1,9}$/.test(declared) || Number(declared) > referenceUploadByteLimit)) {
    throw new MediaUrlError("too_large", "파일 크기 한도를 초과했습니다.", 413);
  }
  if (!request.body) throw new MediaUrlError("invalid_file", "분석할 파일이 필요합니다.", 400);

  // Use the transport signal while receiving the body. After EOF, Next may
  // end it early, so local decoding uses the original analysis deadline.
  return analyzeBody(request.body, name, referenceUploadByteLimit, analysisDeadline(), selectedMedia, request.signal);
}

async function analyzeBody(
  body: ReadableStream<Uint8Array>, name: string, maxBytes: number, deadline: ReturnType<typeof analysisDeadline>,
  selectedMedia?: ReferenceMedia, requestSignal?: AbortSignal,
) {
  const { signal, interruption } = deadline;
  const receiveSignal = requestSignal ? AbortSignal.any([signal, requestSignal]) : signal;
  // A dynamic prefix makes Next's file tracer include the system temp directory.
  const temp = requestSignal
    ? await mkdtemp(join(tmpdir(), "dream-rea-upload-"))
    : await mkdtemp(join(tmpdir(), "dream-rea-url-"));
  try {
    const root = await realpath(temp);
    const path = join(root, name);
    const hash = createHash("sha256");
    let sizeBytes = 0;
    async function* chunks() {
      const reader = body.getReader();
      let complete = false;
      const cancel = () => { void reader.cancel().catch(() => undefined); };
      if (receiveSignal.aborted) cancel();
      else receiveSignal.addEventListener("abort", cancel, { once: true });
      try {
        for (;;) {
          receiveSignal.throwIfAborted();
          const { done, value } = await reader.read();
          receiveSignal.throwIfAborted();
          if (done) {
            complete = true;
            return;
          }
          sizeBytes += value.byteLength;
          if (sizeBytes > maxBytes) throw new MediaUrlError("too_large", "파일 크기 한도를 초과했습니다.", requestSignal ? 413 : undefined);
          hash.update(value);
          yield value;
        }
      } finally {
        receiveSignal.removeEventListener("abort", cancel);
        if (!complete && !receiveSignal.aborted) cancel();
        reader.releaseLock();
      }
    }
    try { await writeFile(path, chunks(), { flag: "wx", signal }); }
    catch (error) {
      if (error instanceof MediaUrlError) throw error;
      throw new AnalysisStageError("download", interruption(receiveSignal) ?? errorKind(error));
    }
    if (requestSignal && !sizeBytes) {
      throw new MediaUrlError("invalid_file", "분석할 파일이 필요합니다.", 400);
    }
    const sha256 = hash.digest("hex");
    const analyzed = await analyzeRegisteredReferenceSnapshot(path, { kind: "file", name, sizeBytes, permission: "authorized" },
      { sha256, sourceGeneration: sha256 }, { managedRoot: root, signal });
    if (analyzed.status !== "bound") {
      if (selectedMedia && "fileIssue" in analyzed) {
        throw new MediaUrlError(analyzed.fileIssue, "파일의 실제 형식을 확인할 수 없습니다.");
      }
      // The inspector treats the overall deadline as a caller cancellation.
      const detail = analyzed.reason === "cancelled" ? interruption() ?? analyzed.reason : analyzed.reason;
      throw new AnalysisStageError("inspect", detail);
    }
    const proposals = proposalsForLocalReference(analyzed.analysis);
    if (!proposals.length) throw new AnalysisStageError("proposals", "empty");
    return { schemaVersion: 1 as const, status: "ready" as const, sha256, sizeBytes,
      media: analyzed.analysis.media, proposals };
  } finally {
    await rm(join(temp, name), { force: true });
    await rmdir(temp);
  }
}
