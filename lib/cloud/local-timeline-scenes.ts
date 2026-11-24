import "server-only";
import type { Client } from "pg";
import { FPS, sameClip, sceneFrameRange, type Timeline } from "../edit/timeline";

export async function readScenes(client:Client,owner:string,project:string,lock=true) {
  const {rows}=await client.query(`SELECT s.id,s.duration_sec,s.needs_recheck,v.id AS version,v.kind AS version_kind,a.id AS asset,a.kind,a.duration_ms,a.archived_at,a.is_mock,a.size_bytes,a.mime
    FROM dream.scenes s LEFT JOIN dream.scene_versions v ON v.id=s.selected_version_id AND v.owner_id=s.owner_id
      AND v.scene_id=s.id AND v.status='succeeded' AND v.kind IN ('image','video')
    LEFT JOIN dream.assets a ON a.id=v.result_asset_id AND a.owner_id=s.owner_id AND a.kind IN ('image','video')
    WHERE s.owner_id=$1 AND s.project_id=$2 AND s.archived_at IS NULL ORDER BY s.position,s.id${lock ? " FOR SHARE OF s" : ""}`,[owner,project]);
  return rows.map(scene=>{
    const ms=Number(scene.duration_ms);
    const frames=sceneFrameRange(Number(scene.duration_sec),scene.kind==="video"?ms:null);
    return {
      plannedFrames:Number(scene.duration_sec)*FPS,
      recheck:Number(scene.needs_recheck)!==0,
      ready:!!scene.asset && scene.kind===scene.version_kind && !scene.archived_at && Number(scene.is_mock)===0
        && Number(scene.size_bytes)>0 && scene.mime?.startsWith(scene.kind+"/")
        && (scene.kind!=="video" || (Number.isSafeInteger(ms) && ms>0)),
      clip:{sceneId:scene.id as string,sceneVersionId:(scene.asset?scene.version:null) as string|null,
        assetId:scene.asset as string|null,...frames,
        transition:{type:"cut" as const,durationFrames:0 as const}}
    };
  });
}

export function scenesMatchTimeline(scenes: Awaited<ReturnType<typeof readScenes>>, timeline: Timeline) {
  const saved = new Map(timeline.video.map(clip => [clip.sceneId, clip]));
  return saved.size === scenes.length && scenes.every(({ clip, recheck }) => {
    const existing = saved.get(clip.sceneId);
    return !recheck && existing && sameClip(existing, { ...clip, id: existing.id });
  });
}

export async function lockSceneResults(client:Client,owner:string,scenes: Awaited<ReturnType<typeof readScenes>>) {
  await client.query("SELECT id FROM dream.assets WHERE owner_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE",
    [owner,scenes.map(scene=>scene.clip.assetId)]);
  await client.query("SELECT id FROM dream.scene_versions WHERE owner_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE",
    [owner,scenes.map(scene=>scene.clip.sceneVersionId)]);
}
