import "server-only";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { analyzeRegisteredReferenceSnapshot } from "./registered-snapshot";
import { referenceFileByteLimit, referenceFileFormat } from "./input";
import { proposalsForLocalReference } from "./project-preview";

// Additional origins are supplied only by the local operator CLI; the web action always uses the fixed origins.
const publicOrigins = new Set(["https://interactive-examples.mdn.mozilla.net", "https://tonejs.github.io", "https://mdn.github.io"]);

type MediaUrlErrorCode = "invalid_url" | "unsupported_origin" | "unsupported_format" | "too_large";

export class MediaUrlError extends Error {
  constructor(readonly code: MediaUrlErrorCode, message: string) { super(message); }
}

export async function analyzeLocalMediaUrl(input: string, operatorOrigin?: string, requestSignal?: AbortSignal) {
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
  const format = referenceFileFormat(name);
  if (!format) throw new MediaUrlError("unsupported_format", "지원하는 이미지·음악·영상 파일 확장자가 필요합니다.");

  const deadline = AbortSignal.timeout(30_000);
  const signal = requestSignal ? AbortSignal.any([deadline, requestSignal]) : deadline;
  const response = await fetch(url, { redirect: "error", credentials: "omit", cache: "no-store", signal });
  if (Number(response.headers.get("content-length")) > referenceFileByteLimit) {
    await response.body?.cancel();
    throw new MediaUrlError("too_large", "파일 크기 한도를 초과했습니다.");
  }
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new Error("전체 파일을 가져올 수 없습니다.");
  }

  const root = await realpath(await mkdtemp(join(tmpdir(), "dream-rea-url-")));
  const path = join(root, name);
  try {
    const hash = createHash("sha256");
    let sizeBytes = 0;
    async function* chunks() {
      for await (const chunk of response.body!) {
        sizeBytes += chunk.length;
        if (sizeBytes > referenceFileByteLimit) throw new MediaUrlError("too_large", "파일 크기 한도를 초과했습니다.");
        hash.update(chunk);
        yield chunk;
      }
    }
    await writeFile(path, chunks(), { flag: "wx", signal });
    const sha256 = hash.digest("hex");
    const analyzed = await analyzeRegisteredReferenceSnapshot(path, { kind: "file", name, sizeBytes, permission: "authorized" },
      { sha256, sourceGeneration: sha256 }, { managedRoot: root, signal });
    if (analyzed.status !== "bound") throw new Error("미디어 분석을 완료하지 못했습니다 (" + analyzed.reason + ").");
    const proposals = proposalsForLocalReference(analyzed.analysis);
    if (!proposals.length) throw new Error("측정 근거가 있는 프롬프트를 만들 수 없습니다.");
    return { schemaVersion: 1 as const, status: "ready" as const, sourceUrl: url.href, sha256, sizeBytes,
      media: analyzed.analysis.media, proposals };
  } finally {
    await rm(path, { force: true });
    await rmdir(root);
  }
}
