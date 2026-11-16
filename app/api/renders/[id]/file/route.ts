import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { z } from "zod";
import { parseByteRange } from "@/lib/media/range";
import { renderErrorBody, renderFile } from "@/lib/services/renders";
export const runtime="nodejs";
// P2-4b download (T-101 2.9): a verified success only, size checked against the row, Range, nosniff, private
// no-store, the display name in RFC 5987 form (the list shows the same name).
const contentDisposition=(name:string,download:boolean)=>`${download?"attachment":"inline"}; filename="render.mp4"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g,value=>`%${value.charCodeAt(0).toString(16).toUpperCase()}`)}`;
async function serve(request:Request,params:Promise<{id:string}>,head:boolean){
  try{
    const {id}=await params;if(!z.uuidv7().safeParse(id).success)return Response.json({error:"받을 수 있는 영상이 없어요.",code:"NOT_FOUND"},{status:404});
    const file=await renderFile(id),size=file.sizeBytes,range=parseByteRange(request.headers.get("range"),size);
    if(!range.ok)return new Response(null,{status:416,headers:{"content-range":`bytes */${size}`}});
    const headers:Record<string,string>={"content-type":"video/mp4","content-length":String(range.end-range.start+1),"accept-ranges":"bytes","x-content-type-options":"nosniff","cache-control":"private, no-store",
      "content-disposition":contentDisposition(file.fileName,new URL(request.url).searchParams.has("download"))};
    if(range.partial)headers["content-range"]=`bytes ${range.start}-${range.end}/${size}`;
    return new Response(head?null:Readable.toWeb(createReadStream(/*turbopackIgnore: true*/file.absolute,{start:range.start,end:range.end})) as ReadableStream<Uint8Array>,{status:range.partial?206:200,headers});
  }catch(error){const {status,body}=renderErrorBody(error);return Response.json(body,{status});}
}
export function GET(request:Request,{params}:{params:Promise<{id:string}>}){return serve(request,params,false);}
export function HEAD(request:Request,{params}:{params:Promise<{id:string}>}){return serve(request,params,true);}
