import "server-only";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";

// P2-4b render tools (T-101 1.3·2.4, T-108). Read by the request service and the worker; never imports the renderer.
// - The pinned Headless Shell (scripts/remotion/browser-pin.json): the worker never lets Remotion meet a missing or
//   different browser (T-108: a failed launch inside selectComposition leaves its file server open).
// - The composition source hash: render/entry.tsx and every app file it imports, so a bundle is reused only for the
//   same source, and a render whose source changed after the request is refused.
export const REMOTION_VERSION="4.0.543";
export const COMPOSITION_ID="DreamTimeline";
export const RENDER_ENTRY="render/entry.tsx";
const pinSchema=z.object({version:z.string().regex(/^\d+(\.\d+){3}$/),installDir:z.string(),executable:z.object({path:z.string(),sha256:z.string().regex(/^[0-9a-f]{64}$/)})});
const appRoot=()=>resolve(/*turbopackIgnore: true*/process.cwd());
export function browserPin(root=appRoot()){return pinSchema.parse(JSON.parse(readFileSync(/*turbopackIgnore: true*/join(/*turbopackIgnore: true*/root,"scripts/remotion/browser-pin.json"),"utf8")));}

// sha256 of a file, cached by path + size + mtime (a changed file is measured again). `fresh` skips the cache: the
// worker measures every input again right before it renders (T-101 2.2).
const digests=new Map<string,{size:number;mtimeMs:number;sha256:string}>();
export async function fileSha256(path:string,options:{fresh?:boolean;signal?:AbortSignal}={}){
  const stat=statSync(/*turbopackIgnore: true*/path),known=digests.get(path);
  if(!options.fresh&&known&&known.size===stat.size&&known.mtimeMs===stat.mtimeMs)return {sha256:known.sha256,sizeBytes:stat.size};
  const hash=createHash("sha256");
  await new Promise<void>((done,fail)=>{const stream=createReadStream(/*turbopackIgnore: true*/path,{signal:options.signal});stream.on("data",chunk=>hash.update(chunk));stream.on("error",fail);stream.on("end",()=>done());});
  const sha256=hash.digest("hex"),after=statSync(/*turbopackIgnore: true*/path);
  if(after.size===stat.size&&after.mtimeMs===stat.mtimeMs)digests.set(path,{size:stat.size,mtimeMs:stat.mtimeMs,sha256});
  return {sha256,sizeBytes:stat.size};
}

export type BrowserCheck={ok:true;version:string;path:string;sha256:string}|{ok:false;reason:"missing"|"mismatch";version:string};
export async function checkBrowser(options:{fresh?:boolean;root?:string}={}):Promise<BrowserCheck>{
  const root=options.root??appRoot(),pin=browserPin(root),path=join(/*turbopackIgnore: true*/root,pin.installDir,pin.executable.path);
  if(!existsSync(/*turbopackIgnore: true*/path))return {ok:false,reason:"missing",version:pin.version};
  const {sha256}=await fileSha256(path,{fresh:options.fresh});
  return sha256===pin.executable.sha256?{ok:true,version:pin.version,path,sha256}:{ok:false,reason:"mismatch",version:pin.version};
}

// Every app source file the render entry reaches through relative or "@/" imports (packages are pinned by version).
const IMPORT=/(?:^|[\s;])(?:import|export)\s[^"'`]*?from\s*["']([^"']+)["']|(?:^|[\s;])import\s*["']([^"']+)["']/g;
function resolveSource(from:string,spec:string,root:string){
  const base=spec.startsWith("@/")?join(root,spec.slice(2)):spec.startsWith(".")?resolve(dirname(from),spec):null;if(!base)return null;
  for(const candidate of [base,`${base}.ts`,`${base}.tsx`,join(base,"index.ts"),join(base,"index.tsx")])if(existsSync(/*turbopackIgnore: true*/candidate)&&statSync(/*turbopackIgnore: true*/candidate).isFile())return candidate;
  throw new Error(`render source import not found: ${spec}`);
}
export function compositionSources(root=appRoot()){
  const seen=new Set<string>(),queue=[join(/*turbopackIgnore: true*/root,RENDER_ENTRY)];
  while(queue.length){const file=queue.pop()!;if(seen.has(file))continue;seen.add(file);if(file.endsWith(".json"))continue;
    // Type-only imports are erased from the bundle and do not count.
    const text=readFileSync(/*turbopackIgnore: true*/file,"utf8");for(const match of text.matchAll(IMPORT)){if(/^\s*;?\s*(import|export)\s+type\s/.test(match[0]))continue;const next=resolveSource(file,match[1]??match[2],root);if(next&&!seen.has(next))queue.push(next);}}
  return [...seen].map(file=>relative(root,file).replaceAll("\\","/")).sort();
}
// Line endings are normalized so a checkout's CRLF does not change the hash.
export function compositionSourceSha256(root=appRoot()){
  const hash=createHash("sha256");hash.update(`remotion@${REMOTION_VERSION}\n`);
  for(const file of compositionSources(root)){const text=readFileSync(/*turbopackIgnore: true*/join(/*turbopackIgnore: true*/root,file),"utf8").replace(/\r\n/g,"\n");hash.update(`${file}\n${createHash("sha256").update(text).digest("hex")}\n`);}
  return hash.digest("hex");
}
