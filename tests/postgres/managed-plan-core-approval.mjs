/* global console, URL */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { v7 } from "uuid";
import { approvalCommand, createBrief, route, samplePlan } from "./managed-plan-core-http.mjs";

const draftRole="dream_plan_app", approvalRole="dream_plan_approver";

async function state(admin,id) {
  return (await admin.query(`SELECT
    (SELECT count(*)::int FROM dream.plans WHERE project_id=$1) AS drafts,
    (SELECT count(*)::int FROM local_plan_materials.drafts d JOIN dream.plans p ON (p.owner_id,p.id)=(d.owner_id,d.plan_id) WHERE p.project_id=$1) AS materials,
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action='plan.approve') AS approvals,
    (SELECT coalesce(jsonb_agg(s.id ORDER BY s.position),'[]'::jsonb) FROM dream.scenes s WHERE s.project_id=$1) AS scene_ids,
    (SELECT approved_plan_id FROM dream.projects WHERE id=$1) AS approved_id,
    (SELECT status FROM dream.stage_states WHERE project_id=$1 AND stage='produce') AS produce`,[id])).rows[0];
}

export async function verifyPlanApproval(context, draftConfig) {
  const {admin,rootPath,projectRef,dbHost,cert,startProfile,body,command,connect,users,loseResponse}=context;
  const sql=await readFile(new URL("lib/db/postgres/managed-project-plan/0002_approval.sql",rootPath),"utf8");
  await admin.query("SET ROLE p102_migrate");
  try {
    await admin.query("SELECT set_config('dream.managed_plan.install_ref',$1,false),set_config('dream.managed_plan.install_database','postgres',false)",[projectRef]);
    assert.equal((await admin.query(sql)).at(-1).command,"COMMIT");
  } catch (error) { await admin.query("ROLLBACK"); throw error; }
  finally {await admin.query("RESET ROLE");}
  const secret=randomBytes(25).toString("hex");
  await admin.query("ALTER ROLE "+approvalRole+" LOGIN PASSWORD '"+secret+"'; ALTER ROLE "+approvalRole+" SET plan_cache_mode='force_generic_plan'");
  const env={...draftConfig.env,DREAM_PROJECT_PLAN_APPROVAL_BACKEND:"supabase-postgres",
    DREAM_PROJECT_PLAN_APPROVAL_DB_URL:"postgresql://"+approvalRole+":"+secret+"@"+dbHost+":5432/postgres",
    DREAM_PROJECT_PLAN_APPROVAL_DB_CA:cert};
  let auditedOwner;
  const createDraft=async (call,seconds=17)=>{
    const project=await createBrief({call,body,command},seconds);
    const input={revision:project.revision,version:0,...samplePlan(seconds)};
    const saved=await body(call(route(project.id),{input}),201);
    return {...project,input,saved,approve:approvalCommand(saved)};
  };

  await startProfile({...env,DREAM_PROJECT_PLAN_APPROVAL_DB_URL:draftConfig.env.DREAM_PROJECT_PLAN_DB_URL},async call=>{
    const project=await createDraft(call);
    assert.equal((await body(call(route(project.id)),200)).canApprove,false);
    await body(call(route(project.id),{input:project.approve}),503);
    assert.deepEqual(await state(admin,project.id),{drafts:1,materials:1,approvals:0,scene_ids:[],approved_id:null,produce:"locked"});
  });

  await startProfile(env,async (call,origin)=>{
    const verifyApproved=async (project,count)=>{
      const snapshot=await state(admin,project.id);
      assert.equal(snapshot.approved_id,project.saved.planId);
      assert.equal(snapshot.approvals,1);
      assert.equal(snapshot.produce,"todo");
      assert.equal(snapshot.scene_ids.length,count);
      assert.equal(new Set(snapshot.scene_ids).size,count);
      const {rows:[plan]}=await admin.query("SELECT approved_scene_snapshot_json::jsonb AS scenes FROM dream.plans WHERE id=$1 AND status='approved'",[project.saved.planId]);
      assert.deepEqual(plan.scenes.map(scene=>scene.id),snapshot.scene_ids);
      assert.equal(plan.scenes.reduce((total,scene)=>total+scene.durationSec,0),count===45?180:17);
      assert(plan.scenes.every((scene,index)=>scene.position===index+1&&scene.projectId===project.id));
      return snapshot;
    };
    const first=await createDraft(call);
    auditedOwner=first.id;
    const view=await body(call(route(first.id)),200);
    assert.equal(view.canApprove,true);
    assert.equal(view.hostedProductionAvailable,false);
    await body(call(route(first.id),{actor:1,input:first.approve}),404);
    await body(call(route(first.id),{actor:null,input:first.approve}),401);
    await body(call(route(first.id),{input:first.approve,originOverride:"https://foreign.invalid"}),403);
    await body(call(route(first.id),{input:{...first.approve,version:2}}),409);
    assert.deepEqual((await state(admin,first.id)).scene_ids,[]);
    await loseResponse(origin,route(first.id),v7(),first.approve);
    const committed=await verifyApproved(first,3);
    const replay=await body(call(route(first.id),{input:first.approve}),200);
    assert.deepEqual(replay,{planId:first.saved.planId,version:1,approved:true,produceOpen:true,hostedProductionAvailable:false});
    assert.deepEqual(await state(admin,first.id),committed);
    await body(call(route(first.id),{input:{...first.approve,planId:v7()}}),409);
    await body(call(route(first.id),{input:first.input}),409);
    assert.deepEqual((await body(call(route(first.id)),200)).materials,first.saved.materials);
    assert.equal((await body(call("/api/projects/"+first.id),200)).project.approvedPlanId,first.saved.planId);
    const legacyProduction=await call("/api/projects/"+first.id+"/production");
    assert.equal(legacyProduction.status,405);
    await legacyProduction.body?.cancel();

    const large=await createDraft(call,180);
    await body(call(route(large.id),{input:large.approve}),200);
    await verifyApproved(large,45);

    const late=await createDraft(call);
    await admin.query("CREATE FUNCTION public.p108_fail_produce() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.stage='produce' AND NEW.status='todo' THEN RAISE EXCEPTION 'synthetic produce transition failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER p108_fail_produce BEFORE UPDATE ON dream.stage_states FOR EACH ROW EXECUTE FUNCTION public.p108_fail_produce()");
    const before=await state(admin,late.id);
    try {
      await body(call(route(late.id),{input:late.approve}),503);
      assert.deepEqual(await state(admin,late.id),before);
      assert.equal((await body(call(route(late.id)),200)).canApprove,true);
    } finally {await admin.query("DROP TRIGGER p108_fail_produce ON dream.stage_states; DROP FUNCTION public.p108_fail_produce()");}
    await body(call(route(late.id),{input:late.approve}),200);
    await verifyApproved(late,3);

    async function race(approveFirst) {
      const project=await createDraft(call);
      const save={revision:project.revision,version:1,draft:{...project.saved.draft,script:"Competing edit"}};
      const blocker=await connect("p102_root");
      const wait = async role => {
        for (let i=0;i<40;i++){
          const check=await admin.query("SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'",[role]);
          if(check.rowCount)return;
          await delay(40);
        }
        throw new Error("Project row lock was not observed for "+role);
      };
      let first,second;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM dream.projects WHERE id=$1 FOR UPDATE",[project.id]);
        first=call(route(project.id),{input:approveFirst?project.approve:save});
        await wait(approveFirst?approvalRole:draftRole);
        second=call(route(project.id),{input:approveFirst?save:project.approve});
        await wait(approveFirst?draftRole:approvalRole);
        await blocker.query("COMMIT");
      } finally {await blocker.end();}
      const responses=await Promise.all([first,second]);
      assert.deepEqual(responses.map(response=>response.status),approveFirst?[200,409]:[201,409]);
      for(const response of responses)await response.body?.cancel();
      if(approveFirst) await verifyApproved(project,3);
      else assert.deepEqual(await state(admin,project.id),{drafts:2,materials:2,approvals:0,scene_ids:[],approved_id:null,produce:"locked"});
    }
    await race(true);
    await race(false);
    for(let index=0;index<6;index++){
      const project=await createDraft(call);
      await body(call(route(project.id),{input:project.approve}),200);
      await verifyApproved(project,3);
    }
    const {rows:tls}=await admin.query(`SELECT a.usename AS role,bool_and(s.ssl AND s.version='TLSv1.3') AS verified
      FROM pg_stat_activity a JOIN pg_stat_ssl s USING(pid)
      WHERE a.datname=current_database() AND a.usename=ANY($1::name[]) GROUP BY a.usename ORDER BY a.usename`,
    [["dream_project_core_app",draftRole,approvalRole]]);
    assert.deepEqual(tls,[
      {role:draftRole,verified:true},{role:approvalRole,verified:true},{role:"dream_project_core_app",verified:true},
    ].sort((a,b)=>a.role.localeCompare(b.role)));
  });

  const approver=await connect(approvalRole,secret);
  try {
    assert.equal((await approver.query("SHOW plan_cache_mode")).rows[0].plan_cache_mode,"force_generic_plan");
    await approver.query("BEGIN");
    await approver.query("SELECT set_config('dream.actor_id',$1,true)",[users[1].id]);
    assert.equal((await approver.query("SELECT id FROM dream.projects WHERE id=$1",[auditedOwner])).rowCount,0);
    await approver.query("ROLLBACK");
    await assert.rejects(approver.query("UPDATE dream.plans SET script='Forbidden'"),{code:"42501"});
    await assert.rejects(approver.query("INSERT INTO local_plan_materials.drafts(owner_id) VALUES($1)",[users[0].id]),{code:"42501"});
    await assert.rejects(approver.query("SET ROLE dream_plan_app"),{code:"42501"});
    await assert.rejects(approver.query("SELECT timeline_json FROM dream.timeline_revisions"),{code:"42501"});
  } finally {await approver.end();}
  const {rows:[exposed]}=await admin.query(`SELECT count(*)::int AS grants FROM pg_roles r
    WHERE r.rolname IN ('anon','authenticated','authenticator') AND (
    has_schema_privilege(r.oid,'managed_project_plan','USAGE') OR
    pg_has_role(r.oid,'dream_plan_app'::regrole,'MEMBER') OR pg_has_role(r.oid,'dream_plan_approver'::regrole,'MEMBER'))`);
  assert.equal(exposed.grants,0);
  console.log(JSON.stringify({stage:"approval",separateRoles:true,runtimeTlsRoles:3,browserGrants:0,wrongCredentialClosed:true,ownerIsolation:true,
    lostReplyReplay:true,atomicSceneCounts:[3,45],lateFailureRollback:true,approveThenSave:[200,409],saveThenApprove:[201,409],
    warmRepeatApprovals:6,planCacheMode:"force_generic_plan",hostedProductionAvailable:false}));
}
