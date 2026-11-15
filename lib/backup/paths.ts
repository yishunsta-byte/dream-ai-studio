import "server-only";
import { lstat, mkdir, open, readdir, realpath, rm, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { v7 } from "uuid";
import { runtimeRoot } from "@/lib/config/runtime";
import { MediaError } from "@/lib/media/inspect";
export function within(parent:string,child:string){const value=relative(resolve(parent),resolve(child));return value===""||(!value.startsWith(`..${sep}`)&&value!==".."&&!isAbsolute(value));}
function absoluteInput(input:string){if(!input.trim()||!isAbsolute(input)||[...input].some(char=>char.charCodeAt(0)<32)||input.split(/[\\/]/).includes(".."))throw new MediaError("INVALID_INPUT","절대 경로로 폴더를 적어 주세요. 상위 폴더로 돌아가는 경로는 쓸 수 없어요.");return resolve(input.trim());}
export async function canonicalTarget(input:string){const target=absoluteInput(input);let parent:string;try{parent=await realpath(/*turbopackIgnore: true*/dirname(target));}catch{throw new MediaError("INVALID_INPUT","상위 폴더를 먼저 만들고 다시 검사해 주세요.");}const candidate=join(parent,basename(target));try{const stat=await lstat(candidate);if(stat.isSymbolicLink()||!stat.isDirectory())throw new MediaError("INVALID_INPUT","일반 폴더만 사용할 수 있어요. 파일이나 연결 폴더는 쓸 수 없어요.");return await realpath(/*turbopackIgnore: true*/candidate);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return candidate;throw error;}}
// Resolve existing ancestors too: Windows 8.3 aliases and junction parents must
// describe the same physical boundary even when the leaf does not exist yet.
export async function physicalPath(path:string):Promise<string>{
 try{return await realpath(/*turbopackIgnore: true*/path);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;const parent=dirname(path);if(parent===path)throw error;return join(/*turbopackIgnore: true*/await physicalPath(parent),basename(path));}
}
function overlaps(a:string,b:string){return within(a,b)||within(b,a);}
async function runtimeBoundaries(){const root=await realpath(/*turbopackIgnore: true*/runtimeRoot());return {root,code:await realpath(/*turbopackIgnore: true*/process.cwd()),data:await physicalPath(join(root,"data")),storage:await physicalPath(join(root,"storage")),backups:await physicalPath(join(root,"backups"))};}
export async function validateBackupDirectory(input:string,prepare=true){
 const target=await canonicalTarget(input),{code,data,storage,backups}=await runtimeBoundaries();
 // The dedicated backups tree is deliberately allowed; ancestors of it are not.
 if(overlaps(data,target)||overlaps(storage,target)||(overlaps(backups,target)&&!within(backups,target))||(overlaps(code,target)&&!within(backups,target)))throw new MediaError("INVALID_INPUT","자료·데이터·소스 폴더와 겹치지 않는 백업 폴더를 골라 주세요.");
 if(prepare){try{await mkdir(target,{recursive:true});if(!within(target,await realpath(/*turbopackIgnore: true*/target))||!within(await realpath(/*turbopackIgnore: true*/target),target))throw new Error("Backup target changed");const probe=join(target,`.backup-write-${v7()}`);let created=false;try{const file=await open(probe,"wx",0o600);created=true;await file.close();}finally{if(created)await unlink(probe).catch(()=>{});}}catch{throw new MediaError("STORAGE_FAILED","백업 폴더에 쓸 수 없어요. 위치와 쓰기 권한을 확인해 주세요.",503);}}return target;
}
export async function validateRestoreBoundary(input:string){
 const target=await canonicalTarget(input),bounds=await runtimeBoundaries();if(Object.values(bounds).some(bound=>overlaps(bound,target)))throw new MediaError("INVALID_INPUT","지금 데이터·앱·백업 폴더와 겹치지 않는 새 복원 폴더를 골라 주세요.");return target;
}
export async function validateRestoreTarget(input:string){
 const target=await validateRestoreBoundary(input);
 try{if((await readdir(/*turbopackIgnore: true*/target)).length)throw new MediaError("INVALID_INPUT","복원할 폴더가 비어 있지 않아요. 새 빈 폴더를 골라 주세요.");}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}return target;
}
export async function removeOwnedStaging(staging:string,parent:string,ownerId:string){
 const actualParent=await realpath(/*turbopackIgnore: true*/parent),candidate=join(await realpath(/*turbopackIgnore: true*/dirname(resolve(staging))),basename(staging));if(!within(actualParent,candidate)||!within(dirname(candidate),actualParent)||!basename(candidate).startsWith(".dream-")||!ownerId||!basename(candidate).includes(ownerId))throw new Error("Staging boundary rejected");
 const stat=await lstat(candidate);if(stat.isSymbolicLink()||!stat.isDirectory()||!within(candidate,await realpath(/*turbopackIgnore: true*/candidate))||!within(await realpath(/*turbopackIgnore: true*/candidate),candidate))throw new Error("Staging link rejected");
 // Only the caller's exclusively created dedicated staging directory is removed.
 await rm(candidate,{recursive:true,force:true});
}

