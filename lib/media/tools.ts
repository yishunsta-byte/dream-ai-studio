import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

// T-169: the FFmpeg binaries are this machine's tools, run as child processes (render worker, mock speech, checks);
// no server bundle carries them. Their folder is found at run time from the app root, not written as a build-time
// path, so the build's file tracer does not copy them into .nft.json traces. Webpack on Windows does not apply
// next.config outputFileTracingExcludes (its exclude globs are joined with "\\" and never match), so the config alone
// cannot keep them out there; scripts/verify-build.mjs still fails any trace that reaches .tools.
const appRoot=()=>resolve(/*turbopackIgnore: true*/process.cwd());
export function mediaToolsFolder(root=appRoot()){return join(root,".tools","ffmpeg");}
export function mediaBinary(name:"ffmpeg"|"ffprobe") {
 const configured=process.env[name==="ffmpeg"?"FFMPEG_PATH":"FFPROBE_PATH"];
 if(configured)return configured;
 const local=join(mediaToolsFolder(),`${name}${process.platform==="win32"?".exe":""}`);
 if(existsSync(local))return local;
 const bundled=join(appRoot(),"node_modules",".dream-reference-media","bin",name);
 return process.env.VERCEL && existsSync(bundled)?bundled:name;
}
export const runMedia=promisify(execFile);
