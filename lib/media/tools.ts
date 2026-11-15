import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

export function mediaBinary(name:"ffmpeg"|"ffprobe") {
 const configured=process.env[name==="ffmpeg"?"FFMPEG_PATH":"FFPROBE_PATH"];
 if(configured)return configured;
 const local=join(process.cwd(),".tools/ffmpeg",`${name}${process.platform==="win32"?".exe":""}`);
 return existsSync(local)?local:name;
}
export const runMedia=promisify(execFile);
