import type { NextConfig } from "next";
import { isAbsolute, relative, resolve } from "node:path";
const root=process.cwd(),runtime=resolve(process.env.DREAM_DATA_ROOT?.trim()||root),local=relative(root,runtime);
// T-169: exclude globs are relative to the project root. A data root inside the project gets its own entries; one
// outside the project gets none (Turbopack rejects a glob that leaves the root, and neither tracer copies files from
// outside the tracing root). scripts/verify-build.mjs checks the data root in both cases.
const inside=local!==""&&local!==".."&&!local.startsWith(`..${"/"}`)&&!local.startsWith("..\\")&&!isAbsolute(local);
const runtimePrefix=inside?local.replaceAll("\\","/").replace(/[!*?[\]{}()+@]/g,"\\$&"):"";
const config:NextConfig={reactStrictMode:true,poweredByHeader:false,
// T-254: 이미지 최적화(/_next/image)는 proxy를 거치지 않으므로 예시 이미지 경로만 허용한다(공개 커버 /media/public/ 은 제외).
async rewrites() {
  return { beforeFiles: [{ source: "/media/public/:slug/:generation/play.:ext(mp4|webm|mp3|m4a)", destination: "/api/publication-playback" }], afterFiles: [], fallback: [] };
},
images:{localPatterns:[{pathname:"/showcase/t240/**",search:""}]},outputFileTracingIncludes:{"/api/admin/reference-analysis":["./node_modules/.dream-reference-media/**/*"]},outputFileTracingExcludes:{"/*":["./data/**/*","./storage/**/*","./backups/**/*","./tmp/**/*","./.tools/**/*","./.env*",...(runtimePrefix?[...["data","storage","backups","tmp",".tools"].map(name=>`${runtimePrefix}/${name}/**/*`),`${runtimePrefix}/.env*`]:[])]}};
export default config;
