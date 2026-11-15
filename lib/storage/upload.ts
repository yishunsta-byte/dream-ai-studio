import "server-only";
import { createHash } from "node:crypto";
import { mkdir, open, realpath, link, unlink, statfs } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { v7 } from "uuid";
import { z } from "zod";
import { inspectMedia, MediaError } from "@/lib/media/inspect";

export function uploadLimit() {const configured=Number(process.env.MAX_UPLOAD_BYTES);return Number.isSafeInteger(configured)&&configured>0?configured:2*1024**3;}
export async function storageDirectory(name:string) {
 const base=await realpath(join(process.cwd(),"storage"));let actual=base;
 for(const part of name.split("/")){
  if(!part||part==="."||part===".."||part.includes("\\")||part.includes(":"))throw new MediaError("STORAGE_FAILED","자료 폴더의 경로를 확인해 주세요.",503);
  const target=join(actual,part);await mkdir(target,{recursive:true});actual=await realpath(target);const inside=relative(base,actual);
  if(inside===".."||inside.startsWith(`..${sep}`)||isAbsolute(inside))throw new MediaError("STORAGE_FAILED","자료 폴더의 경로를 확인해 주세요.",503);
 }
 return actual;
}
export async function receiveUpload(body:ReadableStream<Uint8Array>,filename:string,save:(data:{id:string;title:string;filePath:string;sizeBytes:number;sha256:string}&Awaited<ReturnType<typeof inspectMedia>>)=>void,signal?:AbortSignal,projectId?:string) {
 const id=v7();const title=basename(filename.replaceAll("\\","/")).normalize("NFC").trim();
 if(!title||title.length>255)throw new MediaError("INVALID_INPUT","파일 이름은 255자 이하로 적어 주세요.");
 const destination=projectId?`projects/${z.uuidv7().parse(projectId)}/assets`:"library";
 const limit=uploadLimit();let tmpDir:string,library:string;
 try{tmpDir=await storageDirectory("tmp");library=await storageDirectory(destination);}catch(error){if(error instanceof MediaError)throw error;throw new MediaError("STORAGE_FAILED","자료 폴더에 쓸 수 없어요. 저장 경로와 권한을 확인해 주세요.",503);}
 const space=await statfs(tmpDir);if(space.bavail*space.bsize<1024*1024)throw new MediaError("DISK_FULL","디스크 공간이 부족해요. 저장 공간을 확보해 주세요.",507);
 const temp=join(tmpDir,`${id}.part`);let created=false,final:string|undefined,committed=false;
 try {
  const handle=await open(temp,"wx",0o600);created=true;const hash=createHash("sha256");let sizeBytes=0;
  const limitLabel=limit>=1024**3?`${limit/1024**3}GB`:limit>=1024**2?`${limit/1024**2}MB`:`${limit}바이트`;
  const count=new Transform({transform(chunk:Buffer,_encoding,callback){sizeBytes+=chunk.length;if(sizeBytes>limit){callback(new MediaError("FILE_TOO_LARGE",`파일이 너무 커요. ${limitLabel}까지 올릴 수 있어요.`,413));return;}hash.update(chunk);callback(null,chunk);}});
  await pipeline(Readable.fromWeb(body as NodeReadableStream<Uint8Array>),count,handle.createWriteStream(),{signal});
  if(sizeBytes===0)throw new MediaError("INVALID_FILE","빈 파일은 올릴 수 없어요.");
  const metadata=await inspectMedia(temp,title);const sha256=hash.digest("hex");
  if(signal?.aborted)throw new MediaError("UPLOAD_CANCELED","파일 올리기를 취소했어요.",499);
  // 업로드 경로는 검증된 로컬 런타임 자료이며 빌드 소스가 아니다.
  const target=join(/*turbopackIgnore: true*/ library,`${id}.${metadata.extension}`);
  await link(temp,target);final=target;
  if(signal?.aborted)throw new MediaError("UPLOAD_CANCELED","파일 올리기를 취소했어요.",499);
  save({id,title,filePath:`${destination}/${id}.${metadata.extension}`,sizeBytes,sha256,...metadata});committed=true;
  return id;
 } catch(error) {
  if(error instanceof MediaError)throw error;
  if((error as NodeJS.ErrnoException).code==="ABORT_ERR")throw new MediaError("UPLOAD_CANCELED","파일 올리기를 취소했어요.",499);
  if((error as NodeJS.ErrnoException).code==="ENOSPC")throw new MediaError("DISK_FULL","디스크 공간이 부족해요. 저장 공간을 확보한 뒤 다시 시도해 주세요.",507);
  throw new MediaError("STORAGE_FAILED","파일을 저장하지 못했어요. 저장 위치와 연결 상태를 확인해 주세요.",503);
 } finally {
  if(created)await unlink(temp).catch(()=>{});
  if(final&&!committed)await unlink(final).catch(()=>{});
 }
}
