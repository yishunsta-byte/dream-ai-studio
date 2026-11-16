// P2-4b composition bundle cache (T-116 F116-1). A cache folder is never trusted by its name or a marker file in it:
// the worker keeps, in its own memory, the file list it got when the bundle was built (every path, size and sha256 —
// a closed set). A hit copies the cached files into the attempt's own folder while hashing them; any extra, missing,
// linked or changed file rejects the cache and the bundle is built again. The render always serves the attempt copy.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

export type BundleFile={path:string;size:number;sha256:string};
export type TrustedBundle={dir:string;files:BundleFile[]};

// Every file under dir as a sorted posix path; null when something is not a plain file or folder (a link, a junction).
export function listFiles(dir:string):string[]|null{
  const out:string[]=[];
  const walk=(folder:string,prefix:string):boolean=>{
    for(const entry of readdirSync(folder,{withFileTypes:true})){
      const path=join(folder,entry.name),rel=prefix?`${prefix}/${entry.name}`:entry.name,stat=lstatSync(path);
      if(stat.isSymbolicLink())return false;
      if(stat.isDirectory()){if(!walk(path,rel))return false;}else if(stat.isFile())out.push(rel);else return false;
    }
    return true;
  };
  try{if(!walk(dir,""))return null;}catch{return null;}
  return out.sort();
}
// Copies one file while hashing the bytes written; the copy is exactly what was hashed.
export async function copyHashed(source:string,target:string){
  mkdirSync(dirname(target),{recursive:true});
  const hash=createHash("sha256");let size=0;
  const tap=new Transform({transform(chunk:Buffer,_encoding,done){hash.update(chunk);size+=chunk.length;done(null,chunk);}});
  await pipeline(createReadStream(source),tap,createWriteStream(target,{flags:"wx"}));
  return {size,sha256:hash.digest("hex")};
}
export async function manifestOf(dir:string):Promise<BundleFile[]|null>{
  const files=listFiles(dir);if(!files)return null;const out:BundleFile[]=[];
  for(const path of files){const hash=createHash("sha256");let size=0;await pipeline(createReadStream(join(dir,path)),new Transform({transform(chunk:Buffer,_e,done){hash.update(chunk);size+=chunk.length;done();}}));out.push({path,size,sha256:hash.digest("hex")});}
  return out;
}
// Hit: the cached folder holds exactly the trusted files with the trusted bytes; they are copied into `target`.
// Returns why it was rejected (and leaves no partial copy) or null when the copy is complete and verified.
export async function copyTrustedBundle(trusted:TrustedBundle,target:string):Promise<string|null>{
  const files=listFiles(trusted.dir),expected=trusted.files.map(file=>file.path).sort();
  const reject=(reason:string)=>{rmSync(target,{recursive:true,force:true});return reason;};
  if(!files)return reject("unreadable or linked entry");
  if(files.length!==expected.length||files.some((path,index)=>path!==expected[index]))return reject("file set differs");
  rmSync(target,{recursive:true,force:true});
  for(const file of trusted.files){
    let copied;try{copied=await copyHashed(join(trusted.dir,file.path),join(target,file.path));}catch(error){return reject(`copy failed: ${String((error as Error)?.message??error).slice(0,80)}`);}
    if(copied.size!==file.size||copied.sha256!==file.sha256)return reject(`changed: ${file.path}`);
  }
  return null;
}
// After a fresh build in the attempt folder: a copy for later attempts in a new, uniquely named cache folder.
export async function storeBundle(source:string,files:BundleFile[],cacheDir:string){
  const part=`${cacheDir}.part`;rmSync(part,{recursive:true,force:true});
  for(const file of files){const copied=await copyHashed(join(source,file.path),join(part,file.path));if(copied.sha256!==file.sha256)throw new Error("bundle copy changed while storing");}
  renameSync(part,cacheDir);
}
