// T-158 test helper: a finished export row that meets the manifest 1/2 contract (0010 triggers and the row check), with
// its real stored ZIP under storage/projects/{project}/exports/{id}.zip. Virtual content only.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { v7 } from "uuid";
import { manifestSchema, type BundleManifest } from "@/lib/export/schema";
import { fileDigest, writeZip } from "@/lib/export/zip";

export type ExportFixture={id:string;relPath:string;manifest:BundleManifest;manifestJson:string;sha256:string;sizeBytes:number};
const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
export async function writeExportFixture(storage:string,input:{id?:string;projectId:string;contentRevision:number;planId?:string;version?:1|2;audioAssetId?:string;exportedAt?:string}):Promise<ExportFixture>{
  const id=input.id??v7(),readme=Buffer.from("가상 편집용 묶음 (시험)\n"),song=Buffer.from(`virtual sound ${id}`);
  const files:{path:string;bytes:Buffer;meta:Record<string,unknown>}[]=[{path:"README.txt",bytes:readme,meta:{mime:"text/plain"}}];
  if(input.version===2)files.push({path:`audio/01_${input.audioAssetId??v7()}.wav`,bytes:song,meta:{mime:"audio/wav",audio:{assetId:input.audioAssetId??v7(),roles:["music"],isMock:true}}});
  const base={project:{id:input.projectId,title:"가상 프로젝트",aspect:"9:16",lengthSec:30},menu:{id:"shopping-shorts",label:"쇼핑숏츠"},templateVersion:"fixture",contentRevision:input.contentRevision,planId:input.planId??v7(),exportedAt:input.exportedAt??"2026-11-17T00:00:00.000Z",isMock:true,kind:"editing-bundle",
    files:files.map(file=>({path:file.path,sha256:sha(file.bytes),sizeBytes:file.bytes.length,...file.meta}))};
  const manifest=manifestSchema.parse(input.version===2?{manifestVersion:2,...base,timeline:{revisionId:v7(),schemaVersion:2,audioMixProfile:"p2-5-local-v1"}}:{manifestVersion:1,...base});
  const relPath=`projects/${input.projectId}/exports/${id}.zip`,file=join(storage,...relPath.split("/"));await mkdir(join(file,".."),{recursive:true});
  await writeZip(file,files.map(item=>({path:item.path,bytes:item.bytes})),manifest);const digest=await fileDigest(file);
  return {id,relPath,manifest,manifestJson:JSON.stringify(manifest),sha256:digest.sha256,sizeBytes:digest.sizeBytes};
}
