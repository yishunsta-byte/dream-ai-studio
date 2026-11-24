import "server-only";
import { readLocalWavForOwner } from "./local-private-wav";
import { v7 } from "uuid";
import { openLocalWavAccess, localWavTransaction } from "./local-wav-access";

const uuid7=/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
const verifiedSource = `FROM dream.assets a JOIN local_wav.files f ON f.owner_id=a.owner_id AND f.asset_id=a.id
 WHERE a.owner_id=$1 AND a.archived_at IS NULL AND a.kind='audio' AND a.mime='audio/wav'
 AND a.sha256=f.digest AND a.size_bytes=f.size_bytes AND a.duration_ms=f.duration_ms
 AND a.file_path=a.owner_id::text||'/assets/'||a.id::text||'/'||f.digest||'.wav'`;

export async function localProjectAudio(request:Request,params:Promise<{id:string;assetId?:string}>) {
  if (process.env.DREAM_PROJECT_CREATE_BACKEND!=="owned-pg17") return reply({error:"프로젝트 음원 연결을 사용할 수 없어요."},503);
  const access=await openLocalWavAccess(request);
  if (access instanceof Response) return access;
  const {id:projectId,assetId}=await params;
  const missing=()=>reply({error:"프로젝트 또는 음원을 찾을 수 없어요."},404);
  if (!uuid7.test(projectId) || (assetId!==undefined && !uuid7.test(assetId))) return missing();
  const write=request.method==="PUT" && assetId!==undefined;
  return localWavTransaction(access,"local_project_audio",write,async client=>{
    const project=await client.query("SELECT id FROM dream.projects WHERE owner_id=$1 AND id=$2 AND menu_id='shopping-shorts' AND archived_at IS NULL"
      +(write?" FOR SHARE":""),[access.owner,projectId]);
    if (!project.rowCount) return missing();
    if (!write && assetId !== undefined) {
      const attached = await client.query(`SELECT a.id ${verifiedSource} AND a.id=$3 AND EXISTS(
        SELECT FROM dream.project_assets l WHERE l.owner_id=a.owner_id AND l.project_id=$2
        AND l.asset_id=a.id AND l.purpose='productionAudio')`, [access.owner, projectId, assetId]);
      if (!attached.rowCount) return missing();
      return readLocalWavForOwner(access, request, assetId);
    }
    if (!write) {
      const {rows}=await client.query(`SELECT a.id,a.title,a.duration_ms::integer AS "durationMs",a.rights_note AS "rightsNote"
        ${verifiedSource} AND EXISTS(SELECT FROM dream.project_assets l WHERE l.owner_id=a.owner_id AND l.project_id=$2
        AND l.asset_id=a.id AND l.purpose='productionAudio') ORDER BY a.title,a.id`,[access.owner,projectId]);
      return reply({assets:rows});
    }
    const source=await client.query(`SELECT a.id ${verifiedSource} AND a.id=$2 FOR SHARE OF a`,[access.owner,assetId]);
    if (!source.rowCount) return missing();
    const link=await client.query(`INSERT INTO dream.project_assets(owner_id,project_id,asset_id,purpose)
      VALUES($1,$2,$3,'productionAudio') ON CONFLICT DO NOTHING`,[access.owner,projectId,assetId]);
    if (link.rowCount) await client.query(`INSERT INTO dream.activity_log(owner_id,id,project_id,actor,action,detail_json,created_at)
      VALUES($1,$2,$3,'local-user','project.audio.attach',$4,clock_timestamp())`,[access.owner,v7(),projectId,JSON.stringify({assetId})]);
    return reply({assetId});
  });
}
