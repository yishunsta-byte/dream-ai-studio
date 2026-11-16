import "server-only";
import { randomBytes } from "node:crypto";
import { closeSync, createReadStream, fstatSync, openSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseByteRange } from "@/lib/media/range";

// P2-4b job file server (T-101 2.9, T-116 F116-2). One per render, 127.0.0.1 only, a fresh 32-byte token in every
// path, GET/HEAD only. It serves exactly the files it was given, by index (`/{token}/m/{n}` media, `/{token}/f/{n}`
// fonts); no path from the request is ever joined to a folder. Each file is opened once when the server starts and
// every response reads that open handle: renaming, deleting or replacing the path afterwards does not change what is
// served (the worker gives it the attempt's verified copies and checks them again before publishing). Range is
// supported for video reads. Closed as soon as the render ends.
export type ServedFile={absolute:string;mime:string;sizeBytes:number};
export type FileServer={base:string;mediaUrl:(index:number)=>string;fontUrl:(index:number)=>string;requests:()=>{path:string;status:number}[];close:()=>Promise<void>};
type Open={fd:number|null;size:number;mime:string;expected:number};
function openAll(list:readonly ServedFile[]):Open[]{
  return list.map(file=>{let fd:number|null=null,size=-1;try{fd=openSync(/*turbopackIgnore: true*/file.absolute,"r");size=fstatSync(fd).size;}catch{if(fd!==null){try{closeSync(fd);}catch{/* closed */}}fd=null;}return {fd,size,mime:file.mime,expected:file.sizeBytes};});
}
export async function startFileServer(media:readonly ServedFile[],fonts:readonly ServedFile[]):Promise<FileServer>{
  const token=randomBytes(32).toString("hex"),log:{path:string;status:number}[]=[];
  const opened={m:openAll(media),f:openAll(fonts)};
  const server:Server=createServer((request,response)=>{
    const send=(status:number,headers:Record<string,string>={})=>{log.push({path:redact(request.url??""),status});response.writeHead(status,{"cache-control":"no-store","x-content-type-options":"nosniff",...headers});response.end();};
    if(request.method!=="GET"&&request.method!=="HEAD")return send(405,{allow:"GET, HEAD"});
    const match=/^\/([0-9a-f]{64})\/(m|f)\/(\d{1,4})$/.exec((request.url??"").split("?")[0]);
    if(!match||match[1]!==token)return send(404);
    const file=opened[match[2] as "m"|"f"][Number(match[3])];if(!file||file.fd===null)return send(404);
    const size=file.size;if(size!==file.expected)return send(409);
    const range=parseByteRange(request.headers.range??null,size);if(!range.ok)return send(416,{"content-range":`bytes */${size}`});
    const headers:Record<string,string>={"content-type":file.mime,"content-length":String(size===0?0:range.end-range.start+1),"accept-ranges":"bytes","cache-control":"no-store","x-content-type-options":"nosniff","access-control-allow-origin":"*"};
    if(range.partial)headers["content-range"]=`bytes ${range.start}-${range.end}/${size}`;
    log.push({path:redact(request.url??""),status:range.partial?206:200});response.writeHead(range.partial?206:200,headers);
    if(request.method==="HEAD"||size===0){response.end();return;}
    const stream=createReadStream("",{fd:file.fd,start:range.start,end:range.end,autoClose:false});stream.on("error",()=>response.destroy());stream.pipe(response);
  });
  server.on("connection",socket=>socket.setNoDelay(true));
  await new Promise<void>((done,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",()=>done());});
  const port=(server.address() as AddressInfo).port,base=`http://127.0.0.1:${port}/${token}`;
  const closeFiles=()=>{for(const file of [...opened.m,...opened.f])if(file.fd!==null){try{closeSync(file.fd);}catch{/* closed */}file.fd=null;}};
  return {base,mediaUrl:index=>`${base}/m/${index}`,fontUrl:index=>`${base}/f/${index}`,requests:()=>[...log],
    close:()=>new Promise<void>(done=>{server.closeAllConnections();server.close(()=>{closeFiles();done();});})};
}
// The token never leaves the server's own log.
const redact=(url:string)=>url.replace(/[0-9a-f]{64}/,"<token>");
