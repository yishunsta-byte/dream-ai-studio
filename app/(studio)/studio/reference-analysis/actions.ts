"use server";

import { headers } from "next/headers";
import { resolveServerAuth } from "@/lib/auth/resolve";
import { legacyDataAvailable } from "@/lib/auth/legacy-gate";
import { analyzeLocalMediaUrl } from "@/lib/reference-analysis/local-media-url";
import { studioAnalysisResultSchema } from "@/lib/reference-analysis/studio-analysis-result-dto";

let busy = false;

export async function inspectUrl(input: string, authorized: boolean) {
  if ((await resolveServerAuth()).kind !== "local" || !legacyDataAvailable(process.env)) return { error: "이 PC 작업실에서 분석할 수 있어요." };
  const incoming = await headers();
  const host = incoming.get("host");
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(host) || incoming.get("origin") !== "http://" + host ||
    (incoming.has("sec-fetch-site") && incoming.get("sec-fetch-site") !== "same-origin")) {
    return { error: "이 PC의 작업실에서 다시 실행해 주세요." };
  }
  if (authorized !== true || typeof input !== "string" || input.length > 4096) return { error: "URL과 자료 분석 권한을 확인해 주세요." };
  if (busy) return { error: "진행 중인 분석이 끝나면 다시 시도해 주세요." };
  busy = true;
  try {
    const { schemaVersion, status, media, proposals } = await analyzeLocalMediaUrl(input);
    const result = studioAnalysisResultSchema.parse({ schemaVersion, status, media, proposals });
    if (result.status === "ready") return { result };
  } catch {
    return { error: "분석하지 못했어요. 지원하는 공개 파일 주소와 파일 형식·길이를 확인해 주세요." };
  } finally {
    busy = false;
  }
  return { error: "관찰 근거를 찾지 못했어요." };
}
