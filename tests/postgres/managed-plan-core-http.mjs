/* global Buffer, console, structuredClone, URL */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { v7 } from "uuid";

const draftRole = "dream_plan_app";

export function samplePlan(seconds=17, extras=true) {
  const lengths=seconds===17?[3,7,7]:[3,5,...Array(43).fill(4)];
  const source={evidence:"youtube_video",videoId:"A1b2C3d4E5F",provenance:"client_supplied"};
  const scenes=lengths.map((durationSec,index)=>({stepId:"custom",title:"Scene "+(index+1),description:"Synthetic shot",
    dialogue:"Synthetic voice",durationSec,characterIds:[],assetIds:[]}));
  const draft={script:"Synthetic storyboard",scenes};
  if(!extras) return {draft};
  const timing={sceneNumber:1,startSec:0,endSec:3};
  const first=scenes[0];
  return {action:"import-shorts-draft",durationSec:seconds,draft,materials:{schemaVersion:1,source,
    idea:{title:"Synthetic idea",openingHook:"Opening"},scenes:scenes.map((_,index)=>({
      sceneNumber:index+1,caption:index===0?"Caption":null,sfx:index===0?"Sound":null,...(index===0&&{
      prompt:{basis:{...timing,narration:first.dialogue,visual:first.description,caption:"Caption",sfx:"Sound"},
        result:{schemaVersion:1,geminiCredentialVersion:1,source,generation:{kind:"creative_scene_prompt_draft",durationSec:seconds,
          ...timing,sceneSummary:"장면 요약",imagePrompt:"Image prompt",videoPrompt:"Video prompt"}}},
    })})),bgm:{basis:{direction:"Quiet score",cues:[{...timing,note:"Start"}]},result:{schemaVersion:1,geminiCredentialVersion:1,
      source,generation:{kind:"creative_bgm_prompt_draft",durationSec:seconds,title:"Score",genreAndMood:"Quiet",
        recommendedBpmRange:{min:60,max:100},instrumentation:"Strings",dynamicStructure:"Warm",audioMixingNotes:"Low",
        sunoPrompt:"Synthetic quiet score"}}}}};
}

export async function installPlan({admin,rootPath,projectRef,dbHost,cert}) {
  const sql=await readFile(new URL("lib/db/postgres/managed-project-plan/0001_install.sql",rootPath),"utf8");
  await admin.query("SET ROLE p102_migrate");
  try {
    await admin.query("SELECT set_config('dream.managed_plan.install_ref',$1,false),set_config('dream.managed_plan.install_database','postgres',false)",[projectRef]);
    assert.equal((await admin.query(sql)).at(-1).command,"COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  } finally { await admin.query("RESET ROLE"); }
  const secret = randomBytes(25).toString("hex");
  await admin.query("ALTER ROLE "+draftRole+" LOGIN PASSWORD '"+secret+"'");
  return {secret, env:{
    DREAM_PROJECT_PLAN_BACKEND:"supabase-postgres",
    DREAM_PROJECT_PLAN_DB_URL:"postgresql://"+draftRole+":"+secret+"@"+dbHost+":5432/postgres",
    DREAM_PROJECT_PLAN_DB_CA:cert,
  }};
}

export const route = id => "/api/projects/"+id+"/plan";
export const approvalCommand = saved => ({action:"approve-plan",acknowledged:true,revision:saved.revision,version:saved.version,planId:saved.planId});

export async function createBrief({call,body,command},lengthSec, approve=true) {
  const {id}=await body(call("/api/projects",{input:command({lengthSec,title:"Synthetic "+lengthSec})}),201,"managed project");
  const brief="/api/projects/"+id+"/brief";
  const {revision}=await body(call(brief),200);
  if(approve) await body(call(brief,{input:{acknowledged:true,revision}}),200);
  return {id,revision};
}

async function planState(admin,id) {
  return (await admin.query(`SELECT
    (SELECT count(*)::int FROM dream.plans WHERE project_id=$1) AS drafts,
    (SELECT count(*)::int FROM local_plan_materials.drafts d JOIN dream.plans p ON (d.owner_id,d.plan_id)=(p.owner_id,p.id) WHERE p.project_id=$1) AS materials,
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action LIKE 'plan.%') AS audit,
    (SELECT count(*)::int FROM dream.scenes WHERE project_id=$1) AS scenes,
    (SELECT status FROM dream.stage_states WHERE project_id=$1 AND stage='produce') AS produce`,[id])).rows[0];
}

export async function verifyPlanDrafts(context) {
  const {admin,startProfile,body,command,loseResponse,connect,users}=context;
  const {secret,env}=await installPlan(context);
  await startProfile(env, async (call,origin)=>{
    const api={call,body,command};
    const blocked=await createBrief(api,17,false);
    await body(call(route(blocked.id)),409);
    const active=await createBrief(api,17);
    const get=await body(call(route(active.id)),200);
    assert.equal(get.revision,active.revision);
    assert.equal(get.version,0);
    assert.deepEqual(get.capabilities,{saveDraft:true,importShortsDraft:true,approvePlan:false});
    const input={revision:get.revision,version:0,...samplePlan()};
    await body(call(route(active.id),{actor:null,input}),401);
    await body(call(route(active.id),{actor:1}),404);
    await body(call(route(active.id),{actor:1,input}),404);
    await body(call(route(active.id),{input,originOverride:"https://foreign.invalid"}),403);
    await body(call(route(active.id),{input:{...input,revision:99}}),409);
    await body(call(route(active.id),{input:{...input,durationSec:18}}),400);
    const mismatch=structuredClone(input);
    mismatch.materials.scenes[0].caption="Changed without regenerating";
    assert.equal((await body(call(route(active.id),{input:mismatch}),409)).code,"PLAN_MATERIALS_STALE");
    assert.deepEqual(await planState(admin,active.id),{drafts:0,materials:0,audit:0,scenes:0,produce:"locked"});
    const race=await Promise.all([call(route(active.id),{input}),call(route(active.id),{input})]);
    assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
    const saved = await race.find(r=>r.status===201).json();
    await race.find(r=>r.status===409).body?.cancel();
    assert.equal(saved.materials.scenes[0].caption,"Caption");
    assert.equal(saved.materials.bgm.result.generation.sunoPrompt,"Synthetic quiet score");
    assert.deepEqual((await body(call(route(active.id)),200)).materials,saved.materials);
    assert.equal((await body(call(route(active.id),{input:approvalCommand(saved)}),409)).code,"PLAN_APPROVAL_UNAVAILABLE");

    const next={revision:get.revision,version:1,draft:{...saved.draft,script:"Reopened after discarded response"}};
    await loseResponse(origin,route(active.id),v7(),next);
    const reopened=await body(call(route(active.id)),200);
    assert.equal(reopened.version,2);
    assert.equal(reopened.draft.script,next.draft.script);
    assert.deepEqual(reopened.materials,saved.materials);
    await body(call(route(active.id),{input:next}),409);
    assert.deepEqual(await planState(admin,active.id),{drafts:2,materials:2,audit:2,scenes:0,produce:"locked"});

    const large=await createBrief(api,180);
    const largeInput={revision:large.revision,version:0,...samplePlan(180)};
    const raw=JSON.stringify(largeInput);
    const padded=raw+" ".repeat(4*1024*1024-Buffer.byteLength(raw));
    await body(call(route(large.id),{raw:padded+" "}),413);
    const savedLarge=await body(call(route(large.id),{raw:padded}),201);
    assert.equal(savedLarge.draft.scenes.length,45);
    assert.deepEqual((await body(call(route(large.id)),200)).materials,savedLarge.materials);

    await admin.query("CREATE FUNCTION public.p108_fail_draft() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='plan.draft' THEN RAISE EXCEPTION 'synthetic draft audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER p108_fail_draft BEFORE INSERT ON dream.activity_log FOR EACH ROW EXECUTE FUNCTION public.p108_fail_draft()");
    const before=await planState(admin,active.id);
    const failed={revision:get.revision,version:2,draft:next.draft};
    try {
      await body(call(route(active.id),{input:failed}),503);
      assert.deepEqual(await planState(admin,active.id),before);
    } finally { await admin.query("DROP TRIGGER p108_fail_draft ON dream.activity_log; DROP FUNCTION public.p108_fail_draft()"); }
    assert.equal((await body(call(route(active.id),{input:failed}),201)).version,3);
  });

  const check=await connect(draftRole,secret);
  try {
    await check.query("BEGIN");
    await check.query("SELECT set_config('dream.actor_id',$1,true)",[users[1].id]);
    assert.equal((await check.query("SELECT id FROM dream.plans")).rowCount,0);
    await check.query("ROLLBACK");
    await assert.rejects(check.query("UPDATE dream.plans SET status='approved'"),{code:"42501"});
    await assert.rejects(check.query("INSERT INTO dream.scenes(owner_id) VALUES($1)",[users[1].id]),{code:"42501"});
  } finally {await check.end();}
  const {rows:[roles]}=await admin.query("SELECT count(*)::int AS grants FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','authenticator') AND (has_schema_privilege(r.oid,'managed_project_plan','USAGE') OR has_schema_privilege(r.oid,'local_plan_materials','USAGE'))");
  assert.equal(roles.grants,0);
  console.log(JSON.stringify({stage:"draft",commonProjectBrief:true,currentAuthOwner:true,cas:[201,409],lostResponseRecovered:true,
    materials:true,scenesInLongDraft:45,bodyLimitMiB:4,auditRollback:true,approveUnavailable:true,browserGrants:0}));
  return {secret,env};
}
