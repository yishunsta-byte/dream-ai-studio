import "server-only";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { Client } from "pg";
import { v7 } from "uuid";
import { openLocalWavAccess, localWavTransaction } from "./local-wav-access";
import { parseByteRange } from "../media/range";
import { inspectPcmWav } from "../services/postgres/pcm-wav";
import { readBoundedUpload } from "./read-bounded-upload";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const headers = { "cache-control": "private, no-store" };
const error = (status: number, message: string) => Response.json({error:message},{status,headers});

async function parseUpload(request: Request) {
  const key = request.headers.get("idempotency-key") ?? "";
  const url = new URL(request.url), note = (url.searchParams.get("rightsNote") ?? "").trim();
  const title = posix.basename((url.searchParams.get("filename") ?? "").replaceAll("\\","/")).trim().normalize("NFC");
  if (!idPattern.test(key) || !title || title.length>255 || title==="." || title===".." ||
      Array.from(title).some(char=>char.charCodeAt(0)<32 || char.charCodeAt(0)===127) || note.length>500 || note.includes("\0"))
    return error(400,"요청 번호, 파일 이름과 권리 메모를 확인해 주세요.");
  const cap = 1024*1024;
  if (Number(request.headers.get("content-length"))>cap) return error(413,"1 MiB 이하 WAV를 선택해 주세요.");
  const bytes = await readBoundedUpload(request,cap);
  if (!bytes) return error(413,"1 MiB 이하 WAV를 선택해 주세요.");
  const media = inspectPcmWav(bytes);
  if (!media) return error(400,"16비트 PCM WAV 파일을 선택해 주세요.");
  return {key,note,title,bytes,media};
}

type Upload = Exclude<Awaited<ReturnType<typeof parseUpload>>,Response>;
async function register(client: Client, input: Upload, owner: string) {
  const {key,note,title,bytes,media} = input;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[owner+":"+key]);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { rows:[previous] } = await client.query(
    "SELECT asset_id,digest,title,rights_note FROM local_wav.files WHERE owner_id=$1 AND request_id=$2",[owner,key]);
  if (previous) {
    if (previous.digest!==hash || previous.title!==title || previous.rights_note!==(note||null))
      return error(409,"같은 요청 번호에 다른 파일이나 메모가 있어요.");
    return Response.json({id:previous.asset_id},{status:201,headers});
  }
  const id = v7();
  await client.query(`INSERT INTO local_wav.files(owner_id,request_id,asset_id,title,rights_note,content,sample_rate,channels,frames)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[owner,key,id,title,note||null,bytes,media.sampleRate,media.channels,media.frames]);
  await client.query(`INSERT INTO dream.assets(owner_id,id,title,kind,rights_note,role,file_path,mime,size_bytes,sha256,duration_ms,origin,created_at)
    SELECT owner_id,asset_id,title,'audio',rights_note,'original',owner_id::text||'/assets/'||asset_id::text||'/'||digest||'.wav',
      'audio/wav',octet_length(content),digest,duration_ms,'upload',clock_timestamp() FROM local_wav.files WHERE owner_id=$1 AND asset_id=$2`,[owner,id]);
  return Response.json({id},{status:201,headers});
}

async function read(client: Client, request: Request, owner: string, id: string) {
  if (!idPattern.test(id)) return error(404,"음원을 찾을 수 없어요.");
  const {rows:[file]} = await client.query<{content:Buffer}>(`SELECT f.content FROM local_wav.files f JOIN dream.assets a
    ON (a.id,a.owner_id)=(f.asset_id,f.owner_id) WHERE f.owner_id=$1 AND f.asset_id=$2 AND a.archived_at IS NULL`,[owner,id]);
  if (!file) return error(404,"음원을 찾을 수 없어요.");
  const size=file.content.length, range=parseByteRange(request.headers.get("range"),size);
  if (!range.ok) return new Response(null,{status:416,headers:{...headers,"content-range":"bytes */"+size}});
  return new Response(Uint8Array.from(file.content.subarray(range.start,range.end+1)),{status:range.partial?206:200,headers:{
    ...headers,"content-type":"audio/wav","x-content-type-options":"nosniff","accept-ranges":"bytes",
    "content-length":String(range.end-range.start+1),...(range.partial && {"content-range":`bytes ${range.start}-${range.end}/${size}`}),
  }});
}

export function readLocalWavForOwner(access: Parameters<typeof localWavTransaction>[0], request: Request, id: string) {
  return localWavTransaction(access, "local_wav", false, client => read(client, request, access.owner, id));
}

export async function localPrivateWav(request: Request, id?: string) {
  const access = await openLocalWavAccess(request);
  if (access instanceof Response) return access;
  if (id !== undefined) return readLocalWavForOwner(access, request, id);
  const input = await parseUpload(request).catch(()=>error(400,"업로드한 음원을 읽을 수 없어요."));
  if (input instanceof Response) return input;
  return localWavTransaction(access,"local_wav",true,client=>register(client,input,access.owner));
}
