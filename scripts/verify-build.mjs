import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
function inside(parent,child){const value=relative(parent,child);return value===""||value!==".."&&!value.startsWith(`..${sep}`)&&!isAbsolute(value);}
function canonical(path){try{return realpathSync(path);}catch{return resolve(path);}}
export function privateTrace(project,file,runtime=project){const target=resolve(file),actual=canonical(target);for(const base of new Set([resolve(project),canonical(project),resolve(runtime),canonical(runtime)])){for(const name of ["data","storage","backups","tmp",".tools"]){const folder=join(base,name);if(inside(folder,target)||inside(canonical(folder),actual))return true;}const local=relative(base,target).replaceAll("\\","/");if(/^\.env(?:[./]|$)/i.test(local)||/^\.env(?:[./]|$)/i.test(relative(base,actual).replaceAll("\\","/")))return true;}return false;}
// P2-4b (T-101 2.9): the render toolchain runs only in the worker's child process; no Next trace may hold it.
const RENDER_TOOLCHAIN=[/(^|\/)node_modules\/@remotion\/(renderer|bundler|compositor-[^/]+)(\/|$)/,/(^|\/)node_modules\/\.pnpm\/@remotion\+(renderer|bundler|compositor)/,/(^|\/)\.remotion(\/|$)/,/(^|\/)chrome-headless-shell[^/]*(\/|$)/i];
export function renderTrace(project,file){const local=relative(resolve(project),resolve(file)).replaceAll("\\","/");if(local==="render"||local.startsWith("render/"))return true;return RENDER_TOOLCHAIN.some(pattern=>pattern.test(local)||pattern.test(resolve(file).replaceAll("\\","/")));}
// T-169: this machine's native tools (the .tools folder of the app or data root, or an ffmpeg/ffprobe binary anywhere,
// through a link too) are named on their own. They run only as child processes of the local worker.
const NATIVE_TOOL=/(^|\/)(ffmpeg|ffprobe)(\.exe)?$/i;
export function toolTrace(project,file,runtime=project){const target=resolve(file),actual=canonical(target);if(NATIVE_TOOL.test(target.replaceAll("\\","/"))||NATIVE_TOOL.test(actual.replaceAll("\\","/")))return true;for(const base of new Set([resolve(project),canonical(project),resolve(runtime),canonical(runtime)])){const folder=join(base,".tools");if(inside(folder,target)||inside(canonical(folder),actual))return true;}return false;}
// Reads every trace and fails on the first kind found; the list of every offending entry (app-relative, or under the
// data root) goes to stderr so a failure can be read without re-running.
export function verifyBuild(project=process.cwd(),runtime=process.env.DREAM_DATA_ROOT?.trim()||project){const root=resolve(project),data=resolve(runtime),server=join(root,".next/server");let traces=0;const found=[];
  const shown=(target)=>{for(const [base,label] of [[root,"<app>"],[data,"<data>"]]){const local=relative(base,target);if(local!==".."&&!local.startsWith(`..${sep}`)&&!isAbsolute(local))return `${label}/${local.replaceAll("\\","/")}`;}return "<outside>/"+target.split(sep).slice(-2).join("/");};
  for(const filename of readdirSync(server,{recursive:true})){if(!filename.endsWith(".nft.json"))continue;traces++;const manifest=join(server,filename);for(const file of JSON.parse(readFileSync(manifest,"utf8")).files??[]){const target=resolve(dirname(manifest),file);
    const kind=toolTrace(root,target,data)?"tool":privateTrace(root,target,data)?"private":renderTrace(root,target)?"render":null;if(kind)found.push({kind,trace:filename.replaceAll("\\","/"),file:shown(target)});}}
  if(!traces)throw new Error("빌드의 파일 목록을 확인할 수 없어요.");
  if(found.length){console.error(`추적 위반 ${found.length}건 (파일 목록 ${new Set(found.map(item=>item.trace)).size}개)`);for(const item of found)console.error(`${item.kind}\t${item.trace}\t${item.file}`);
    const kinds=new Set(found.map(item=>item.kind));
    if(kinds.has("private"))throw new Error("빌드 파일 목록에 로컬 데이터나 비밀 설정이 포함되어 중단했어요.");
    if(kinds.has("tool"))throw new Error("빌드 파일 목록에 이 PC의 실행 도구(.tools·ffmpeg·ffprobe)가 포함되어 중단했어요.");
    throw new Error("빌드 파일 목록에 영상 만들기 도구(렌더러·번들러·브라우저)가 포함되어 중단했어요.");}
  return traces;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){verifyBuild();console.log("운영 빌드 확인: 로컬 데이터·비밀 설정·영상 만들기 도구 추적 없음");}
