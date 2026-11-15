import type { NextConfig } from "next";
import { relative, resolve } from "node:path";
const root=process.cwd(),runtime=resolve(process.env.DREAM_DATA_ROOT?.trim()||root);
const runtimePrefix=relative(root,runtime).replaceAll("\\","/").replace(/[!*?[\]{}()+@]/g,"\\$&");
const config:NextConfig={reactStrictMode:true,poweredByHeader:false,outputFileTracingExcludes:{"/*":["./data/**/*","./storage/**/*","./backups/**/*","./tmp/**/*","./.tools/**/*","./.env*",...(["data","storage","backups","tmp",".tools"].map(name=>`${runtimePrefix?runtimePrefix+"/":"./"}${name}/**/*`)),`${runtimePrefix?runtimePrefix+"/":"./"}.env*`]}};
export default config;
