import type { NextConfig } from "next";
import { isAbsolute, relative, resolve } from "node:path";
const root=process.cwd(),runtime=resolve(process.env.DREAM_DATA_ROOT?.trim()||root),local=relative(root,runtime);
// T-169: exclude globs are relative to the project root. A data root inside the project gets its own entries; one
// outside the project gets none (Turbopack rejects a glob that leaves the root, and neither tracer copies files from
// outside the tracing root). scripts/verify-build.mjs checks the data root in both cases.
const inside=local!==""&&local!==".."&&!local.startsWith(`..${"/"}`)&&!local.startsWith("..\\")&&!isAbsolute(local);
const runtimePrefix=inside?local.replaceAll("\\","/").replace(/[!*?[\]{}()+@]/g,"\\$&"):"";
const config:NextConfig={reactStrictMode:true,poweredByHeader:false,outputFileTracingExcludes:{"/*":["./data/**/*","./storage/**/*","./backups/**/*","./tmp/**/*","./.tools/**/*","./.env*",...(runtimePrefix?[...["data","storage","backups","tmp",".tools"].map(name=>`${runtimePrefix}/${name}/**/*`),`${runtimePrefix}/.env*`]:[])]}};
export default config;
