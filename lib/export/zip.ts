import "server-only";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import ZipStream from "zip-stream";
import { openPromise } from "yauzl";
import { manifestSchema, type BundleManifest } from "./schema";
export function safeArchivePath(name:string){return name.length>0&&name.length<=255&&!name.startsWith("/")&&!name.includes("\\")&&!name.includes(":")&&!name.includes("\0")&&name.split("/").every(part=>part!==""&&part!=="."&&part!=="..");}
export async function fileDigest(filename:string,signal?:AbortSignal){const hash=createHash("sha256");let sizeBytes=0;await pipeline(createReadStream(filename),new Writable({write(chunk:Buffer,_encoding,done){hash.update(chunk);sizeBytes+=chunk.length;done();}}),{signal});return {sha256:hash.digest("hex"),sizeBytes};}
export type BundleSource={path:string;bytes?:Buffer;filename?:string};
export async function writeArchive(filename:string,sources:BundleSource[],signal?:AbortSignal){
 const zip=new ZipStream({forceZip64:true,store:true});const output=createWriteStream(filename,{flags:"wx",mode:0o600});let created=false;output.once("open",()=>{created=true;});const completion=pipeline(zip,output,{signal});void completion.catch(()=>{});
 try {for(const source of sources){
   if(!safeArchivePath(source.path)||(!source.bytes&&!source.filename))throw new Error("Unsafe bundle entry");
   const stream=source.bytes?Readable.from([source.bytes]):createReadStream(source.filename!);stream.on("error",error=>zip.destroy(error));
   await new Promise<void>((resolve,reject)=>{const onError=(error:Error)=>reject(error);zip.once("error",onError);zip.entry(stream,{name:source.path,store:true},error=>{zip.off("error",onError);if(error)reject(error);else resolve();});});
  }zip.finalize();await completion;
 }catch(error){zip.destroy();output.destroy();await completion.catch(()=>{});if(created)await unlink(filename).catch(()=>{});throw error;}
}
export function writeZip(filename:string,sources:BundleSource[],manifest:BundleManifest,signal?:AbortSignal){return writeArchive(filename,[...sources,{path:"manifest.json",bytes:Buffer.from(JSON.stringify(manifest,null,2))}],signal);}
export async function verifyZip(filename:string,expected:BundleManifest,signal?:AbortSignal){
 const manifest=manifestSchema.parse(expected);const expectedFiles=new Map(manifest.files.map(file=>[file.path,file]));if(expectedFiles.size!==manifest.files.length||[...expectedFiles.keys()].some(path=>!safeArchivePath(path)||path==="manifest.json"))throw new Error("Invalid manifest paths");
 const zip=await openPromise(filename,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true,autoClose:false});const seen=new Set<string>();let manifestRead=false;
 try {for await(const entry of zip.eachEntry()){
   if(!safeArchivePath(entry.fileName)||seen.has(entry.fileName)||entry.isEncrypted()||((entry.externalFileAttributes>>>16)&0xf000)===0xa000)throw new Error("Unsafe ZIP entry");seen.add(entry.fileName);if(seen.size>manifest.files.length+1)throw new Error("Unexpected ZIP entry");
   const meta=expectedFiles.get(entry.fileName);if(!meta&&entry.fileName!=="manifest.json")throw new Error("Unexpected ZIP file");const limit=meta?.sizeBytes??2*1024*1024;if(entry.uncompressedSize>limit)throw new Error("ZIP entry exceeds expected size");const hash=createHash("sha256"),chunks:Buffer[]=[];let size=0;const stream=await zip.openReadStreamPromise(entry);
   await pipeline(stream,new Transform({transform(chunk:Buffer,_encoding,done){size+=chunk.length;if(size>limit){done(new Error("ZIP entry too large"));return;}hash.update(chunk);if(!meta)chunks.push(chunk);done();}}),new Writable({write(_chunk,_encoding,done){done();}}),{signal});
   if(meta){if(size!==meta.sizeBytes||hash.digest("hex")!==meta.sha256)throw new Error("ZIP checksum mismatch");}
   else {const parsed=manifestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));if(JSON.stringify(parsed)!==JSON.stringify(manifest))throw new Error("ZIP manifest differs");manifestRead=true;}
  }if(!manifestRead||seen.size!==manifest.files.length+1||[...expectedFiles.keys()].some(path=>!seen.has(path)))throw new Error("ZIP files missing");
 }finally{zip.close();}
 return manifest;
}
