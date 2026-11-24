import { styleDnaHttp } from "@/lib/reference-analysis/style-dna-http";

export const runtime = "nodejs";
// 최초 분석만 원본 Style DNA v1.01(api/analyze/route.ts)과 같은 함수 최대 시간. 분석 기한(280초)과 업로드·저장 여유를 담는다.
export const maxDuration = 300;
export const GET = styleDnaHttp.list;
export const POST = styleDnaHttp.analyze;
