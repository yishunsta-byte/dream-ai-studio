import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { readAsset } from "@/lib/services/library";
import { mediaErrorResponse } from "@/lib/services/http-error";
import { resolveStoredFile } from "@/lib/storage/paths";
import { parseByteRange } from "@/lib/media/range";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 try {
  const {id}=await params;const asset=readAsset(id);const file=resolveStoredFile(asset.filePath);
  if(asset.kind==="link"||!file)return Response.json({error:"파일을 찾을 수 없어요."},{status:404});
  const size=statSync(file).size;if(size!==asset.sizeBytes)return Response.json({error:"파일 크기가 달라요. 자료 상태를 확인해 주세요."},{status:409});
  const range=parseByteRange(request.headers.get("range"),size);
  if(!range.ok)return new Response(null,{status:416,headers:{"content-range":`bytes */${size}`}});
  const download=new URL(request.url).searchParams.has("download")||!["image","video","audio"].includes(asset.kind);
  const filename=encodeURIComponent(asset.title).replace(/['()*]/g,(value)=>`%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  const headers:Record<string,string>={"content-type":asset.mime??"application/octet-stream","content-length":String(size===0?0:range.end-range.start+1),"accept-ranges":"bytes","x-content-type-options":"nosniff","cache-control":"private, no-store","content-disposition":`${download?"attachment":"inline"}; filename="asset"; filename*=UTF-8''${filename}`};
  if(range.partial)headers["content-range"]=`bytes ${range.start}-${range.end}/${size}`;
  const body=size===0?null:Readable.toWeb(createReadStream(file,{start:range.start,end:range.end})) as ReadableStream<Uint8Array>;
  return new Response(body,{status:range.partial?206:200,headers});
 }catch(error){return mediaErrorResponse(error);}
}
