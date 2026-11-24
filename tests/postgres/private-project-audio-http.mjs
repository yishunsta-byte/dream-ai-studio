/* global fetch,console */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {URL} from "node:url";
import {v7} from "uuid";
import {setTimeout as delay} from "node:timers/promises";
import {Client} from "pg";

export async function installProjectAudio(admin,cfg) {
  await admin.query(await readFile(new URL("../../lib/db/postgres/private-wav-upload/project-audio.sql",import.meta.url),"utf8"));
  const {rows:[password]}=await admin.query("SELECT quote_literal($1::text) AS literal",[cfg.password]);
  await admin.query("CREATE ROLE local_project_audio_login LOGIN NOINHERIT PASSWORD "+password.literal);
  await admin.query("GRANT local_project_audio TO local_project_audio_login WITH INHERIT FALSE, SET TRUE");
}

export async function testProjectAudio({origin,owner,other,admin,cfg,a,b,project,png,post,key,body}) {
  const own=(await admin.query("SELECT asset_id FROM local_wav.files WHERE owner_id=$1 ORDER BY asset_id",[a.id])).rows;
  const foreign=(await admin.query("SELECT asset_id FROM local_wav.files WHERE owner_id=$1",[b.id])).rows[0].asset_id;
  const one=own[0].asset_id,two=own[1].asset_id;
  const path=origin+"/api/projects/"+project+"/audio-assets";
  const call=(cookie,id)=>fetch(path+(id?"/"+id:""),{method:id?"PUT":"GET",headers:cookie?{cookie}:{},redirect:"manual"});
  const counts=async()=>(await admin.query(`SELECT
    (SELECT count(*)::int FROM dream.project_assets WHERE project_id=$1 AND purpose='productionAudio') AS links,
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action='project.audio.attach') AS logs`,[project])).rows[0];
  assert.deepEqual(await (await call(owner)).json(),{assets:[]});
  assert.equal((await call(null)).status,401);
  assert.equal((await call(null,one)).status,401);
  assert.equal((await call(other)).status,404);
  for(const id of [png,foreign,v7()]) assert.equal((await call(owner,id)).status,404);
  assert.equal((await call(other,foreign)).status,404);
  await admin.query("CREATE FUNCTION local_wav.test_log_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$");
  await admin.query("CREATE TRIGGER test_log_failure BEFORE INSERT ON dream.activity_log FOR EACH ROW WHEN (NEW.action='project.audio.attach') EXECUTE FUNCTION local_wav.test_log_failure()");
  try { assert.equal((await call(owner,one)).status,503); }
  finally { await admin.query("DROP TRIGGER test_log_failure ON dream.activity_log; DROP FUNCTION local_wav.test_log_failure()"); }
  assert.deepEqual(await counts(),{links:0,logs:0});
  const concurrent=await Promise.all([call(owner,one),call(owner,one)]);
  for(const response of concurrent) {assert.equal(response.status,200);assert.deepEqual(await response.json(),{assetId:one});}
  assert.equal((await call(owner,one)).status,200);
  assert.deepEqual(await counts(),{links:1,logs:1});
  const list=await call(owner);
  assert.equal(list.headers.get("cache-control"),"private, no-store");
  assert.deepEqual(await list.json(),{assets:[{id:one,title:"track.wav",durationMs:100,rightsNote:"직접 만든 시험 음원"}]});
  assert.deepEqual(await post(owner,key,body),{status:201,body:{id:project}});
  const preview = (cookie, id) => fetch(path + "/" + id, { headers: { ...(cookie && {cookie}), range:"bytes=0-3" } });
  const media = await preview(owner,one);
  assert.equal(media.status,206);
  assert.equal(await media.text(),"RIFF");
  assert.equal(media.headers.get("cache-control"),"private, no-store");
  assert.equal((await preview(other,one)).status,404);
  assert.equal((await preview(owner,two)).status,404);
  assert.equal((await preview(owner,foreign)).status,404);
  assert.equal((await preview(null,one)).status,401);
  await admin.query("UPDATE dream.assets SET archived_at=clock_timestamp() WHERE id=$1",[one]);
  try {
    assert.equal((await preview(owner,one)).status,404);
    assert.deepEqual(await (await call(owner)).json(),{assets:[]});
  } finally {await admin.query("UPDATE dream.assets SET archived_at=NULL WHERE id=$1",[one]);}
  const locker=new Client({...cfg,user:admin.user});
  await locker.connect();
  try {
    await locker.query("BEGIN");
    await locker.query("UPDATE dream.assets SET archived_at=clock_timestamp() WHERE id=$1",[two]);
    const raced=call(owner,two);
    try {
      let blocked=false;
      for(let i=0;i<50&&!blocked;i++){
        blocked=(await admin.query("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE usename='local_project_audio_login' AND $1=ANY(pg_blocking_pids(pid))) AS blocked",[locker.processID])).rows[0].blocked;
        if(!blocked)await delay(50);
      }
      assert.ok(blocked,"attach waits for archival");
    } finally {await locker.query("COMMIT");}
    assert.equal((await raced).status,404);
  } finally {await locker.end();}
  assert.deepEqual(await counts(),{links:1,logs:1});
  await admin.query("UPDATE dream.projects SET archived_at=clock_timestamp() WHERE id=$1",[project]);
  try {
    assert.equal((await preview(owner,one)).status,404);
    assert.equal((await call(owner)).status,404);
    assert.equal((await call(owner,one)).status,404);
  } finally { await admin.query("UPDATE dream.projects SET archived_at=NULL WHERE id=$1",[project]); }
  const {rows:[grants]}=await admin.query(`SELECT
    has_column_privilege('local_project_audio','local_wav.files','content','SELECT') AS bytes,
    has_column_privilege('local_project_audio','dream.assets','archived_at','UPDATE') AS archive,
    has_table_privilege('local_wav','dream.project_assets','INSERT') AS upload_links`);
  assert.deepEqual(grants,{bytes:false,archive:false,upload_links:false});
  console.log("Project WAV attach/list, owner isolation, rollback, concurrent replay and archive race passed");
}
