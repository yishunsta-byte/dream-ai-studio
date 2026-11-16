import "server-only";
import { randomBytes } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseByteRange } from "@/lib/media/range";

// P2-4b job file server (T-101 2.9). One per render, 127.0.0.1 only, a fresh 32-byte token in every path, GET/HEAD
// only. It serves exactly the files it was given, by index (`/{token}/m/{n}` media, `/{token}/f/{n}` fonts); no path
// from the request is ever joined to a folder, so nothing outside the list can be reached. Range is supported for
// video reads. Closed as soon as the render ends.
export type ServedFile={absolute:string;mime:string;sizeBytes:number};
export type FileServer={base:string;mediaUrl:(index:number)=>string;fontUrl:(index:number)=>string;requests:()=>{path:string;status:number}[];close:()=>Promise<void>};
export async function startFileServer(media:readonly ServedFile[],fonts:readonly ServedFile[]):Promise<FileServer>{
  const token=randomBytes(32).toString("hex"),log:{path:string;status:number}[]=[];
  const server:Server=createServer((request,response)=>{
    const send=(status:number,headers:Record<string,string>={})=>{log.push({path:redact(request.url??""),status});response.writeHead(status,{"cache-control":"no-store","x-content-type-options":"nosniff",...headers});response.end();};
    if(request.method!=="GET"&&request.method!=="HEAD")return send(405,{allow:"GET, HEAD"});
    const match=/^\/([0-9a-f]{64})\/(m|f)\/(\d{1,4})$/.exec((request.url??"").split("?")[0]);
    if(!match||match[1]!==token)return send(404);
    const list=match[2]==="m"?media:fonts,file=list[Number(match[3])];if(!file)return send(404);
    let size:number;try{size=statSync(/*turbopackIgnore: true*/file.absolute).size;}catch{return send(404);}
    if(size!==file.sizeBytes)return send(409);
    const range=parseByteRange(request.headers.range??null,size);if(!range.ok)return send(416,{"content-range":`bytes */${size}`});
    const headers:Record<string,string>={"content-type":file.mime,"content-length":String(size===0?0:range.end-range.start+1),"accept-ranges":"bytes","cache-control":"no-store","x-content-type-options":"nosniff","access-control-allow-origin":"*"};
    if(range.partial)headers["content-range"]=`bytes ${range.start}-${range.end}/${size}`;
    log.push({path:redact(request.url??""),status:range.partial?206:200});response.writeHead(range.partial?206:200,headers);
    if(request.method==="HEAD"||size===0){response.end();return;}
    const stream=createReadStream(/*turbopackIgnore: true*/file.absolute,{start:range.start,end:range.end});stream.on("error",()=>response.destroy());stream.pipe(response);
  });
  server.on("connection",socket=>socket.setNoDelay(true));
  await new Promise<void>((done,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",()=>done());});
  const port=(server.address() as AddressInfo).port,base=`http://127.0.0.1:${port}/${token}`;
  return {base,mediaUrl:index=>`${base}/m/${index}`,fontUrl:index=>`${base}/f/${index}`,requests:()=>[...log],
    close:()=>new Promise<void>(done=>{server.closeAllConnections();server.close(()=>done());})};
}
// The token never leaves the server's own log.
const redact=(url:string)=>url.replace(/[0-9a-f]{64}/,"<token>");
