/* global fetch,console */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {URL} from "node:url";
import {v7} from "uuid";
import {canonicalJson} from "../../lib/edit/timeline.ts";

export async function installTimelineSave(admin,cfg) {
  await admin.query(await readFile(new URL("../../lib/db/postgres/private-wav-upload/timeline-save.sql",import.meta.url),"utf8"));
  const {rows:[pw]}=await admin.query("SELECT quote_literal($1::text) AS literal",[cfg.password]);
  await admin.query("CREATE ROLE local_audio_edit_login LOGIN NOINHERIT PASSWORD "+pw.literal);
  await admin.query("GRANT local_audio_edit TO local_audio_edit_login WITH INHERIT FALSE, SET TRUE");
}

export async function testTimelineSave({origin,owner,other,admin,actor,project,png}) {
  const one=async(sql,args)=>(await admin.query(sql,args)).rows[0];
  const state=()=>one("SELECT content_revision::int AS rev,current_timeline_rev_id AS id,aspect FROM dream.projects WHERE id=$1",[project]);
  const source=await one("SELECT asset_id AS id FROM dream.project_assets WHERE project_id=$1 AND purpose='productionAudio'",[project]);
  const send=async(cookie,base,key=v7(),assetId=source.id)=>{
    const response=await fetch(origin+"/api/projects/"+project+"/timeline/audio-clips",{method:"POST",headers:{
      ...(cookie&&{cookie}),"content-type":"application/json","idempotency-key":key
    },body:JSON.stringify({assetId,expectedContentRevision:base.rev,expectedTimelineId:base.id})});
    return {status:response.status,body:await response.json()};
  };
  const initial=await state();
  assert.equal((await send(null,initial)).status,401);
  assert.equal((await send(other,initial)).status,404);
  assert.deepEqual((await send(owner,initial)).body.reasons,["PRODUCE_APPROVAL_REQUIRED","BASE_TIMELINE_REQUIRED"]);
  assert.deepEqual(await state(),initial);

  // Only this isolated fixture supplies prior production approval and a pre-existing edited scene.
  const scene=v7(),version=v7(),plan=v7();
  await admin.query("INSERT INTO dream.plans(owner_id,id,project_id,version,steps_json,script,status,approved_scene_snapshot_json,approved_at,created_at) VALUES($1,$2,$3,1,'[]','fixture','approved','[]',now(),now())",[actor,plan,project]);
  await admin.query("UPDATE dream.stage_states SET status='approved',approved_revision=$2,approved_at=now(),approved_plan_id=$3 WHERE project_id=$1 AND stage IN ('produce','edit','review','export')",[project,initial.rev,plan]);
  const baseline={schemaVersion:1,fps:30,aspect:initial.aspect,video:[],audio:[],text:[]};
  async function seed(number) {
    const id=v7(),json=canonicalJson(baseline);
    await admin.query(`INSERT INTO dream.timeline_revisions(owner_id,project_id,id,revision,content_revision,timeline_json,timeline_sha256,source,created_at)
      VALUES($1,$2,$3,$4,$5,$6,encode(sha256(convert_to($6,'UTF8')),'hex'),'user',now())`,[actor,project,id,number,initial.rev+number,json]);
    await admin.query("UPDATE dream.projects SET current_timeline_rev_id=$2,content_revision=$3 WHERE id=$1",[project,id,initial.rev+number]);
    return state();
  }
  assert.equal((await send(owner,await seed(1))).body.code,"OUTPUT_LENGTH_REQUIRED");
  await admin.query("INSERT INTO dream.scenes(owner_id,id,project_id,position,title,description,dialogue_json,character_ids_json,duration_sec) VALUES($1,$2,$3,0,'fixture','','[]','[]',1)",[actor,scene,project]);
  await admin.query("INSERT INTO dream.scene_versions(owner_id,id,scene_id,plan_id,version,kind,input_snapshot_json,result_asset_id,status,created_at) VALUES($1,$2,$3,$4,1,'image','{}',$5,'succeeded',now())",[actor,version,scene,plan,png]);
  await admin.query("UPDATE dream.scenes SET selected_version_id=$2 WHERE id=$1",[scene,version]);
  baseline.video.push({id:v7(),sceneId:scene,sceneVersionId:version,assetId:png,durationFrames:30,trimInFrames:0,trimOutFrames:0,transition:{type:"cut",durationFrames:0}});
  const base=await seed(2),key=v7();
  await admin.query("UPDATE dream.scenes SET needs_recheck=1 WHERE id=$1",[scene]);
  assert.equal((await send(owner,base)).body.code,"BASE_TIMELINE_STALE");
  await admin.query("UPDATE dream.scenes SET needs_recheck=0 WHERE id=$1",[scene]);
  assert.equal((await send(owner,base,v7(),png)).status,404);
  const counts=()=>one(`SELECT (SELECT count(*)::int FROM dream.timeline_revisions WHERE project_id=$1) AS revisions,
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action='timeline.audio.add') AS logs`,[project]);
  await admin.query("CREATE FUNCTION local_wav.test_save_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$");
  await admin.query("CREATE TRIGGER test_save_failure BEFORE INSERT ON dream.activity_log FOR EACH ROW WHEN (NEW.action='timeline.audio.add') EXECUTE FUNCTION local_wav.test_save_failure()");
  try {assert.equal((await send(owner,base,key)).status,503);}
  finally {await admin.query("DROP TRIGGER test_save_failure ON dream.activity_log; DROP FUNCTION local_wav.test_save_failure()");}
  assert.deepEqual(await state(),base);
  assert.deepEqual(await counts(),{revisions:2,logs:0});
  const [first,replay]=await Promise.all([send(owner,base,key),send(owner,base,key)]);
  assert.equal(first.status,200,JSON.stringify(first));
  assert.deepEqual(replay,first);
  assert.deepEqual(await counts(),{revisions:3,logs:1});
  const snapshot=async(id)=>(await one("SELECT timeline_json FROM dream.timeline_revisions WHERE id=$1",[id])).timeline_json;
  assert.equal(await snapshot(base.id),canonicalJson(baseline));
  const saved=JSON.parse(await snapshot(first.body.timelineId));
  assert.equal(saved.audio[0].durationFrames,3);
  assert.equal(saved.audio[0].id,first.body.clipId);
  assert.equal(saved.audioRights.length,1);
  assert.deepEqual(saved.video,baseline.video);
  const stages=(await admin.query("SELECT stage,status,approved_at FROM dream.stage_states WHERE project_id=$1 AND stage IN ('edit','review','export') ORDER BY stage",[project])).rows;
  assert.deepEqual(stages.map(s=>[s.status,s.approved_at]),[["in_progress",null],["locked",null],["locked",null]]);
  const current=await state();
  assert.equal((await send(owner,current,key)).body.code,"REQUEST_CONFLICT");
  const raced=await Promise.all([send(owner,current),send(owner,current)]);
  assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);
  const latest=await state();
  await admin.query("UPDATE dream.assets SET archived_at=now() WHERE id=$1",[source.id]);
  try {
    assert.equal((await send(owner,latest)).status,404);
    assert.deepEqual(await send(owner,base,key),first);
    assert.deepEqual(await state(),latest);
    assert.deepEqual(await counts(),{revisions:4,logs:2});
  } finally {await admin.query("UPDATE dream.assets SET archived_at=NULL WHERE id=$1",[source.id]);}
  console.log("Verified conditional PG timeline save, 3-frame WAV, CAS, historical replay, atomic rollback and stage invalidation");
}
