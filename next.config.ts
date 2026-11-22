import type { NextConfig } from "next";
import { isAbsolute, relative, resolve } from "node:path";
const root=process.cwd(),runtime=resolve(process.env.DREAM_DATA_ROOT?.trim()||root),local=relative(root,runtime);
// T-169: exclude globs are relative to the project root. A data root inside the project gets its own entries; one
// outside the project gets none (Turbopack rejects a glob that leaves the root, and neither tracer copies files from
// outside the tracing root). scripts/verify-build.mjs checks the data root in both cases.
const inside=local!==""&&local!==".."&&!local.startsWith(`..${"/"}`)&&!local.startsWith("..\\")&&!isAbsolute(local);
const runtimePrefix=inside?local.replaceAll("\\","/").replace(/[!*?[\]{}()+@]/g,"\\$&"):"";
// P1-07 운영 이식: 오디오 바로 분석(audio-analysis POST)과 큰 파일 완료(audio-uploads/[id] POST)도 같은 고정 FFmpeg 묶음으로 미디어를 검사한다.
const analysisMedia=["./node_modules/.dream-reference-media/**/*"];
// Turbopack matches the app entry including /route. Webpack matches the normalized route.
const audioCompletionRoute = process.env.TURBOPACK
  ? "/api/admin/audio-uploads/\\[id\\]/route"
  : "/api/admin/audio-uploads/\\[id\\]!(/**)";
const analysisRoutes = {
  "/api/admin/reference-analysis": analysisMedia,
  "/api/admin/audio-analysis": analysisMedia,
  [audioCompletionRoute]: analysisMedia,
};
const config:NextConfig={reactStrictMode:true,poweredByHeader:false,outputFileTracingIncludes:analysisRoutes,outputFileTracingExcludes:{
  "/*":["./data/**/*","./storage/**/*","./backups/**/*","./tmp/**/*","./.tools/**/*","./.env*",...(runtimePrefix?[...["data","storage","backups","tmp",".tools"].map(name=>`${runtimePrefix}/${name}/**/*`),`${runtimePrefix}/.env*`]:[])],
}};
export default config;
