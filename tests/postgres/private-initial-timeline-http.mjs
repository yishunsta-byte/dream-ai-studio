/* global fetch,console */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {fileURLToPath,URL} from "node:url";
import {v7} from "uuid";
export async function testInitialTimeline({origin,owner,other,admin,actor,project,png}){
  const read=async()=> (await admin.query("SELECT content_revision::int AS rev,current_timeline_rev_id AS id FROM dream.projects WHERE id=$1",[project])).rows[0];
  const initial=await read();
  const send=async(cookie,key=v7(),revision=initial.rev)=>{
    const response=await fetch(origin+"/api/projects/"+project+"/timeline/initial",{method:"POST",
      headers:{...(cookie&&{cookie}),"content-type":"application/json","idempotency-key":key},
      body:JSON.stringify({expectedContentRevision:revision,expectedTimelineId:null})});
    return {status:response.status,body:await response.json()};
  };
  assert.equal((await send(null)).status,401);
  assert.equal((await send(other)).status,404);
  assert.deepEqual((await send(owner)).body.reasons,["PRODUCE_APPROVAL_REQUIRED"]);
  const plan=v7(),scene=v7(),version=v7();
  // These pre-existing approval and production results are isolated test data.
  await admin.query("INSERT INTO dream.plans(owner_id,id,project_id,version,steps_json,script,status,approved_scene_snapshot_json,approved_at,created_at) VALUES($1,$2,$3,1,'[]','fixture','approved','[]',now(),now())",[actor,plan,project]);
  await admin.query("UPDATE dream.stage_states SET status='approved',approved_plan_id=$2,approved_at=now(),approved_revision=$3 WHERE stage='produce' AND project_id=$1",[project,plan,initial.rev]);
  assert.equal((await send(owner)).body.code,"SCENE_RESULTS_REQUIRED");
  await admin.query("INSERT INTO dream.scenes(owner_id,id,project_id,position,title,description,dialogue_json,character_ids_json,duration_sec) VALUES($1,$2,$3,0,'fixture','','[]','[]',2)",[actor,scene,project]);
  assert.equal((await send(owner)).body.code,"SCENE_RESULTS_REQUIRED");
  await admin.query("INSERT INTO dream.scene_versions(owner_id,id,scene_id,plan_id,version,kind,input_snapshot_json,result_asset_id,status,created_at) VALUES($1,$2,$3,$4,1,'image','{}',$5,'succeeded',now())",[actor,version,scene,plan,png]);
  await admin.query("UPDATE dream.scenes SET selected_version_id=$1,needs_recheck=1 WHERE id=$2",[version,scene]);
  assert.equal((await send(owner)).body.code,"SCENE_RESULTS_REQUIRED");
  await admin.query("UPDATE dream.scenes SET needs_recheck=0 WHERE id=$1",[scene]);
  await admin.query("UPDATE dream.assets SET archived_at=now() WHERE id=$1",[png]);
  try {assert.equal((await send(owner)).body.code,"SCENE_RESULTS_REQUIRED");}
  finally {await admin.query("UPDATE dream.assets SET archived_at=NULL WHERE id=$1",[png]);}
  const movie=fileURLToPath(new URL("../fixtures/backups/s6-inputs/render-passed.mp4",import.meta.url));
  const probe=fileURLToPath(new URL("../../.tools/ffmpeg/ffprobe.exe",import.meta.url));
  const measuredMs=Math.round(1000*Number(execFileSync(probe,["-v","error","-select_streams","v:0","-show_entries","stream=duration","-of","csv=p=0",movie],{encoding:"utf8"})));
  const bytes=await readFile(movie),digest=createHash("sha256").update(bytes).digest("hex");
  const video=v7(),videoScene=v7(),videoVersion=v7();
  await admin.query("INSERT INTO dream.assets(owner_id,id,kind,title,role,file_path,mime,size_bytes,sha256,duration_ms,origin,created_at) VALUES($1,$2,'video','movie','selected',$3,'video/mp4',$4,$5,$6,'import',now())",[actor,video,actor+"/assets/"+video+"/"+digest+".mp4",bytes.length,digest,measuredMs]);
  await admin.query("INSERT INTO dream.scenes(owner_id,id,project_id,position,title,description,dialogue_json,character_ids_json,duration_sec) VALUES($1,$2,$3,1,'movie','','[]','[]',4)",[actor,videoScene,project]);
  await admin.query("INSERT INTO dream.scene_versions(owner_id,id,scene_id,plan_id,version,kind,input_snapshot_json,result_asset_id,status,created_at) VALUES($1,$2,$3,$4,1,'video','{}',$5,'succeeded',now())",[actor,videoVersion,videoScene,plan,video]);
  await admin.query("UPDATE dream.scenes SET selected_version_id=$1 WHERE id=$2",[videoVersion,videoScene]);
  assert.deepEqual(await read(),initial);
  assert.equal((await send(owner,v7(),initial.rev+1)).body.code,"CURRENT_TIMELINE_CONFLICT");
  const keys=[v7(),v7()];
  const results=await Promise.all(keys.map(key=>send(owner,key)));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winner=results.findIndex(r=>r.status===200);
  const result=results[winner];
  assert.deepEqual(await send(owner,keys[winner]),result);
  assert.deepEqual(await read(),{rev:initial.rev+1,id:result.body.timelineId});
  const {rows:[saved]}=await admin.query("SELECT timeline_json::jsonb AS timeline,revision::int FROM dream.timeline_revisions WHERE project_id=$1",[project]);
  assert.equal(saved.revision,1);
  assert.equal(saved.timeline.video.length,2);
  assert.equal(saved.timeline.video[1].assetId,video);
  assert.equal(saved.timeline.video[1].durationFrames,120);
  assert.equal(saved.timeline.video[1].trimOutFrames,Math.round(measuredMs*30/1000)-120);
  assert.deepEqual(saved.timeline.video[0],{id:saved.timeline.video[0].id,sceneId:scene,sceneVersionId:version,assetId:png,trimInFrames:0,trimOutFrames:0,durationFrames:60,transition:{type:"cut",durationFrames:0}});
  const log=await admin.query("SELECT id FROM dream.activity_log WHERE project_id=$1 AND action='timeline.initialize'",[project]);
  assert.equal(log.rowCount,1);
  console.log("Initial timeline from selected PNG and measured MP4: approval, scene, owner, stale revision, null-pointer CAS and replay passed");
}
