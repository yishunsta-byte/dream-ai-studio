// Standalone SQL integration test; isolated PGlite dependency, no Supabase credentials.
// npm install --prefix tmp/pg-schema-validation --no-save --ignore-scripts --package-lock=false @electric-sql/pglite@0.5.16
// node tests/postgres/schema-rls.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '../../tmp/pg-schema-validation/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
let checks = 0;
const sha = text => createHash('sha256').update(text).digest('hex');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1), B=id(2), PA=id(10), PB=id(20), PC=id(30);
const now='2026-11-17T00:00:00.000Z';
const q = (sql, params=[]) => db.query(sql, params);
async function check(label, fn) { await fn(); checks++; console.log(`PASS ${label}`); }
async function reject(sql, params, code) {
  await db.exec('SAVEPOINT negative_case');
  let caught;
  try { await q(sql,params); } catch (error) { caught=error; }
  await db.exec('ROLLBACK TO SAVEPOINT negative_case; RELEASE SAVEPOINT negative_case');
  assert.ok(caught,'expected rejection');
  if(code) assert.equal(caught.code,code);
}
async function asRole(role,actor,fn) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
  try {
    if(actor) await q("SELECT set_config('dream.actor_id',$1,true)",[actor]);
    await fn(); await db.exec('COMMIT');
  } catch(error) { await db.exec('ROLLBACK'); throw error; }
}
async function insert(table,row) {
  const entries=Object.entries(row);
  return q(`INSERT INTO dream.${table} (${entries.map(([key])=>key).join(',')}) VALUES (${entries.map((_,i)=>`$${i+1}`).join(',')})`,entries.map(([,value])=>value));
}
const project=(owner,projectId)=>({owner_id:owner,id:projectId,menu_id:'test',template_version:'1',template_snapshot_json:'{}',inputs_json:'{}',title:'Synthetic',goal:'test',target:'test',aspect:'9:16',length_sec:4,created_at:now,updated_at:now});
try {
  await db.exec('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE ROLE anon; CREATE ROLE authenticated;');
  await q('INSERT INTO auth.users VALUES ($1),($2)',[A,B]);
  for(const file of ['0001_schema.sql','0002_invariants.sql','0003_rls.sql']) {
    await db.exec(await readFile(new URL(`../../lib/db/postgres/${file}`,import.meta.url),'utf8'));
  }
  await check('18 tables, all FORCE RLS and two scoped policies',async()=>{
    const {rows}=await q("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='dream' AND relkind='r'");
    assert.equal(rows.length,18); assert.ok(rows.every(r=>r.relrowsecurity&&r.relforcerowsecurity));
    assert.equal((await q("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='dream'")).rows[0].n,36);
  });
  await check('application roles are neither owners nor RLS bypass roles',async()=>{
    const {rows}=await q("SELECT rolname,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname IN ('dream_api','dream_worker')");
    assert.equal(rows.length,2); assert.ok(rows.every(r=>!r.rolsuper&&!r.rolbypassrls&&!r.rolcanlogin));
  });
  await asRole('dream_api',A,async()=>{
    await check('A can insert own project',()=>insert('projects',project(A,PA)));
    await check('A cannot insert B owner',()=>reject('INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,created_at,updated_at) VALUES($1,$2,\'x\',\'1\',\'{}\',\'{}\',\'x\',\'x\',\'x\',\'9:16\',4,$3,$3)',[B,id(999),now],'42501'));
    await insert('projects',project(A,PC));
    await check('owner cannot change even to another existing account',()=>reject('UPDATE dream.projects SET owner_id=$1 WHERE id=$2',[B,PA],'23514'));
    await check('missing owner is rejected',()=>reject('INSERT INTO dream.settings(key,value_json) VALUES(\'missing\',\'{}\')',[],'42501'));
    await check('safe integer overflow rejected',()=>reject('UPDATE dream.projects SET length_sec=9007199254740992 WHERE id=$1',[PA],'23514'));
    await check('raw invalid JSON rejected',()=>reject('UPDATE dream.projects SET inputs_json=\'bad\' WHERE id=$1',[PA],'22P02'));
    await insert('settings',{owner_id:A,key:'same',value_json:'{"a":1}'});
    await insert('assets',{owner_id:A,id:id(40),kind:'link',title:'A link',source_url:'https://example.invalid/a',role:'original',origin:'link',created_at:now});
    await insert('plans',{owner_id:A,id:id(50),project_id:PA,version:1,steps_json:'[]',script:'x',status:'draft',created_at:now});
    await insert('plans',{owner_id:A,id:id(51),project_id:PC,version:1,steps_json:'[]',script:'x',status:'draft',created_at:now});
    await insert('scenes',{owner_id:A,id:id(60),project_id:PA,position:0,title:'x',description:'x',dialogue_json:'[]',character_ids_json:'[]',duration_sec:4});
    await check('same-owner different-project scene/plan rejected',()=>reject("INSERT INTO dream.scene_versions(owner_id,id,scene_id,plan_id,version,kind,input_snapshot_json,status,created_at) VALUES($1,$2,$3,$4,1,'image','{}','queued',$5)",[A,id(61),id(60),id(51),now],'23514'));
    await insert('characters',{owner_id:A,id:id(41),name:'synthetic',description:'x',locked_json:'{}',ref_asset_ids_json:'[]',voice_profile_json:'{}',status:'confirmed',created_at:now});
    await insert('project_characters',{owner_id:A,project_id:PA,character_id:id(41)});
    await insert('project_assets',{owner_id:A,project_id:PA,asset_id:id(40),purpose:'test'});
    await insert('stage_states',{owner_id:A,project_id:PA,stage:'plan',status:'todo'});
    await insert('review_items',{owner_id:A,id:id(42),project_id:PA,content_revision:1,template_item_id:'test',label:'x',source:'common',required:1,status:'unchecked'});
    await check('revision cannot decrease',()=>reject('UPDATE dream.projects SET content_revision=0 WHERE id=$1',[PA],'23514'));
  });
  await asRole('dream_api',B,async()=>{
    await insert('projects',project(B,PB));
    await insert('assets',{owner_id:B,id:id(43),kind:'link',title:'B link',source_url:'https://example.invalid/b',role:'original',origin:'link',created_at:now});
    await insert('settings',{owner_id:B,key:'same',value_json:'{"b":1}'});
    await check('B sees no A projects or settings',async()=>{
      assert.equal((await q('SELECT count(*)::int AS n FROM dream.projects')).rows[0].n,1);
      assert.equal((await q('SELECT value_json FROM dream.settings')).rows[0].value_json,'{"b":1}');
    });
    await check('B cannot update A row',async()=>assert.equal((await q("UPDATE dream.projects SET title='forged' WHERE id=$1 RETURNING id",[PA])).rows.length,0));
    await check('B cannot delete A row',async()=>assert.equal((await q('DELETE FROM dream.projects WHERE id=$1 RETURNING id',[PA])).rows.length,0));
    await check('cross-owner FK rejects A asset under B project',()=>reject("INSERT INTO dream.project_assets VALUES($1,$2,$3,'test')",[B,PB,id(40)],'23503'));
    await check('cross-owner FK rejects A project',()=>reject("INSERT INTO dream.project_assets VALUES($1,$2,$3,'test')",[B,PA,id(43)],'23503'));
  });
  await asRole('dream_api',null,async()=>{
    await check('actor reset after transaction: no rows',async()=>assert.equal((await q('SELECT count(*)::int AS n FROM dream.projects')).rows[0].n,0));
    await check('missing actor cannot write',()=>reject("INSERT INTO dream.settings VALUES($1,'unset','{}')",[A],'42501'));
    await check('API cannot truncate or create tables',async()=>{
      await reject('TRUNCATE dream.projects',[],'42501');
      await reject('CREATE TABLE dream.forbidden(id integer)',[],'42501');
    });
  });
  for(const role of ['anon','authenticated']) await asRole(role,null,async()=>{
    await check(`${role} cannot directly access data or actor function`,async()=>{
      await reject('SELECT * FROM dream.projects',[],'42501');
      await reject('SELECT dream.actor_id()',[],'42501');
    });
  });
  await asRole('dream_api',A,async()=>{
    await check('invalid actor fails closed',async()=>{
      await q("SELECT set_config('dream.actor_id','invalid',true)");
      await reject('SELECT * FROM dream.projects',[],'22P02');
      await q("SELECT set_config('dream.actor_id',$1,true)",[A]);
    });
    const raw=' { "schemaVersion": 1, "audio": [] } ';
    await insert('timeline_revisions',{owner_id:A,id:id(70),project_id:PA,revision:1,content_revision:1,timeline_json:raw,timeline_sha256:sha(raw),source:'user',created_at:now});
    await check('timeline preserves raw bytes',async()=>assert.equal((await q('SELECT timeline_json FROM dream.timeline_revisions')).rows[0].timeline_json,raw));
    await check('timeline cannot update or delete',async()=>{
      await reject("UPDATE dream.timeline_revisions SET source='user'",[],'23514');
      await reject('DELETE FROM dream.timeline_revisions',[],'23514');
    });
    await check('timeline hash is verified',()=>reject("INSERT INTO dream.timeline_revisions(owner_id,id,project_id,revision,content_revision,timeline_json,timeline_sha256,source,created_at) VALUES($1,$2,$3,2,1,$4,$5,'user',$6)",[A,id(71),PA,raw,'0'.repeat(64),now],'23514'));
    await check('timeline v2 missing fields fails closed',()=>reject("INSERT INTO dream.timeline_revisions(owner_id,id,project_id,revision,content_revision,timeline_json,timeline_sha256,source,created_at) VALUES($1,$2,$3,2,1,$4,$5,'user',$6)",[A,id(71),PA,'{"schemaVersion":2}',sha('{"schemaVersion":2}'),now],'23514'));
    await q('UPDATE dream.projects SET current_timeline_rev_id=$1 WHERE id=$2',[id(70),PA]);
    await check('same-owner cross-project timeline pointer rejected',()=>reject('UPDATE dream.projects SET current_timeline_rev_id=$1 WHERE id=$2',[id(70),PC],'23514'));
    await q("UPDATE dream.plans SET status='approved', approved_at=$1, approved_scene_snapshot_json='[]' WHERE id=$2",[now,id(50)]);
    await check('approved plan cannot change or delete',async()=>{
      await reject("UPDATE dream.plans SET script='changed' WHERE id=$1",[id(50)],'23514');
      await reject('DELETE FROM dream.plans WHERE id=$1',[id(50)],'23514');
    });
    await insert('activity_log',{owner_id:A,id:id(72),project_id:PA,actor:'test',action:'test',detail_json:'{}',created_at:now});
    await check('activity append-only',()=>reject("UPDATE dream.activity_log SET action='changed'",[],'23514'));
    await insert('backups',{owner_id:A,id:id(73),kind:'manual',path:'synthetic-only',status:'succeeded',created_at:now});
    await check('successful backup immutable',()=>reject('DELETE FROM dream.backups',[],'23514'));
    await insert('settings',{owner_id:A,key:'project.test.edit.snapshot',value_json:'{}'});
    await check('old edit snapshot immutable',()=>reject("UPDATE dream.settings SET value_json='[]' WHERE key='project.test.edit.snapshot'",[],'23514'));
    await check('object key owner prefix required',()=>reject("INSERT INTO dream.assets(owner_id,id,kind,title,role,origin,file_path,mime,size_bytes,sha256,created_at) VALUES($1,$2,'image','x','original','upload',$3,'image/png',1,$4,$5)",[A,id(74),`${B}/_library/${id(74)}.png`,'0'.repeat(64),now],'23514'));
    await check('traversal key rejected',()=>reject("INSERT INTO dream.assets(owner_id,id,kind,title,role,origin,file_path,mime,size_bytes,sha256,created_at) VALUES($1,$2,'image','x','original','upload',$3,'image/png',1,$4,$5)",[A,id(74),`${A}/../${id(74)}.png`,'0'.repeat(64),now],'23514'));
    const input=JSON.stringify({schemaVersion:1,projectId:PA,timelineRevId:id(70),timelineRevision:1,contentRevision:1});
    await insert('jobs',{owner_id:A,id:id(80),kind:'render',input_snapshot_json:'{}',status:'queued',project_id:PA,ref_type:'render',ref_id:id(81),provider:'local',idempotency_key:'render-1',created_at:now,updated_at:now});
    await insert('renders',{owner_id:A,id:id(81),project_id:PA,job_id:id(80),timeline_rev_id:id(70),timeline_revision:1,content_revision:1,input_json:input,input_sha256:sha(input),status:'queued',frames_total:120,display_name:'sample.mp4',name_seq:1,is_sample:1,created_at:now});
    await check('render job identity locked',()=>reject("UPDATE dream.jobs SET kind='image' WHERE id=$1",[id(80)],'23514'));
    await check('render input immutable',()=>reject('UPDATE dream.renders SET frames_total=121',[],'23514'));
    await check('render cannot jump queued to success',()=>reject("UPDATE dream.renders SET status='succeeded',finished_at=$1",[now],'23514'));
    await q("UPDATE dream.renders SET status='running'");
    await check('incomplete successful render file tuple rejected',()=>reject("UPDATE dream.renders SET status='succeeded',file_path=$1,finished_at=$2",[`${A}/${PA}/${id(81)}.mp4`,now],'23514'));
    await q("UPDATE dream.renders SET status='failed',error_code='SYNTHETIC',finished_at=$1",[now]);
    await check('finished render permits cleanup only',async()=>{
      await q("UPDATE dream.renders SET cleanup_left_json='[]'");
      await reject("UPDATE dream.renders SET error_code='CHANGED'",[],'23514');
      await reject('DELETE FROM dream.renders',[],'23514');
    });
    await insert('generations',{owner_id:A,id:id(82),job_id:id(80),provider:'test',model:'test',params_json:'{}',reference_snapshot_json:'[]',currency:'USD',settlement:'none',started_at:now});
    await check('generation inputs immutable',()=>reject("UPDATE dream.generations SET params_json='[]'",[],'23514'));
    await check('export missing manifest fields rejected',()=>reject("INSERT INTO dream.exports(owner_id,id,project_id,content_revision,status,manifest_json,created_at) VALUES($1,$2,$3,1,'running','{}',$4)",[A,id(90),PA,now],'23514'));
    const manifest=JSON.stringify({manifestVersion:1,kind:'editing-bundle',project:{id:PA},contentRevision:1,files:[{}]});
    await insert('exports',{owner_id:A,id:id(90),project_id:PA,content_revision:1,status:'running',manifest_json:manifest,created_at:now});
    await q('UPDATE dream.exports SET status=\'succeeded\',file_path=$1,sha256=$2,completed_at=$3 WHERE id=$4',[`${A}/${PA}/${id(90)}.zip`,'0'.repeat(64),now,id(90)]);
    await check('completed export immutable',()=>reject("UPDATE dream.exports SET error='changed'",[],'23514'));
    await check('same-owner child update trigger works for tables without id/status',async()=>{
      await q("UPDATE dream.stage_states SET status='in_progress'");
      await q("UPDATE dream.project_assets SET purpose='changed'");
      await q("UPDATE dream.project_characters SET character_id=character_id");
      await q("UPDATE dream.settings SET value_json='{}' WHERE key='same'");
    });
    await check('all 18 tables hide other owners',async()=>{
      const tables=(await q("SELECT tablename FROM pg_tables WHERE schemaname='dream'")).rows;
      for(const {tablename} of tables) {
        assert.match(tablename,/^[a-z_]+$/);
        assert.equal((await q(`SELECT count(*)::int AS n FROM dream.${tablename} WHERE owner_id<>$1`,[A])).rows[0].n,0);
      }
    });
    const v2='{"schemaVersion":2,"audioMixProfile":"p2-5-local-v1","audio":[],"audioJoins":[],"audioRights":[]}';
    await check('valid v2 timeline and silent render envelope accepted',async()=>{
      await insert('timeline_revisions',{owner_id:A,id:id(100),project_id:PA,revision:2,content_revision:1,timeline_json:v2,timeline_sha256:sha(v2),source:'user',created_at:now});
      await insert('jobs',{owner_id:A,id:id(101),kind:'render',input_snapshot_json:'{}',status:'queued',project_id:PA,ref_type:'render',ref_id:id(102),provider:'local',idempotency_key:'render-2',created_at:now,updated_at:now});
      const input2=JSON.stringify({schemaVersion:1,projectId:PA,timelineRevId:id(100),timelineRevision:2,contentRevision:1,timeline:JSON.parse(v2),audioPlan:{schemaVersion:1,mode:'none'},output:{audio:'none'}});
      await insert('renders',{owner_id:A,id:id(102),project_id:PA,job_id:id(101),timeline_rev_id:id(100),timeline_revision:2,content_revision:1,input_json:input2,input_sha256:sha(input2),status:'queued',frames_total:120,display_name:'sample.mp4',name_seq:1,is_sample:1,created_at:now});
    });
    await check('one active render per owner/project enforced',async()=>{
      await insert('jobs',{owner_id:A,id:id(103),kind:'render',input_snapshot_json:'{}',status:'queued',project_id:PA,ref_type:'render',ref_id:id(104),provider:'local',idempotency_key:'render-3',created_at:now,updated_at:now});
      await reject("INSERT INTO dream.renders(owner_id,id,project_id,job_id,timeline_rev_id,timeline_revision,content_revision,input_json,input_sha256,status,frames_total,display_name,name_seq,is_sample,created_at) VALUES($1,$2,$3,$4,$5,1,1,$6,$7,'queued',120,'sample.mp4',2,1,$8)",[A,id(104),PA,id(103),id(70),input,sha(input),now],'23505');
    });
    await check('manifest v2 accepts fixed audio timeline and rejects null timeline',async()=>{
      const base={manifestVersion:2,kind:'editing-bundle',project:{id:PA},contentRevision:1,files:[{}],timeline:{schemaVersion:2,audioMixProfile:'p2-5-local-v1'}};
      await insert('exports',{owner_id:A,id:id(105),project_id:PA,content_revision:1,status:'running',manifest_version:2,manifest_json:JSON.stringify(base),created_at:now});
      await reject('UPDATE dream.exports SET manifest_json=$1 WHERE id=$2',[JSON.stringify({...base,timeline:null}),id(105)],'23514');
    });
  });
  await asRole('dream_worker',null,async()=>{
    await check('worker can inspect both owners under explicit policy',async()=>assert.equal((await q('SELECT count(*)::int AS n FROM dream.projects')).rows[0].n,3));
    await check('worker cannot truncate or delete',async()=>{
      await reject('TRUNCATE dream.projects',[],'42501');
      await reject('DELETE FROM dream.settings',[],'42501');
    });
    await check('worker still obeys immutable history',()=>reject("UPDATE dream.activity_log SET action='worker'",[],'23514'));
  });
  console.log(`SQL integration: ${checks} checks passed; PostgreSQL ${ (await q('SHOW server_version')).rows[0].server_version } (PGlite, synthetic auth.users only).`);
} finally { await db.close(); }
