/* global console, URL */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
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
  return {env,secret,draftSecret:draftConfig.secret};
}

// P2-MANAGED-TOPIC-SHORTS-PLAN: 주제별 쇼츠 같은 프로젝트로 생성 → 브리프 승인 → 메뉴별 기획 초안 저장·조회 → 명시 승인.
// managed-project-core 0003(verifyTopicShorts)이 설치된 뒤에 부르고, 여기서 기획 0003을 더한다.
export async function verifyTopicPlan(context, approvalRun, {sceneRead=false}={}) {
  const {admin,rootPath,projectRef,startProfile,body,connect,users,loseResponse}=context;
  // --scene-flow가 앞에서 승인 역할 비밀번호를 바꾸므로, 이 확인에 쓸 두 로그인 비밀번호를 새로 정한다(출력하지 않는다).
  const draftSecret=randomBytes(25).toString("hex"), secret=randomBytes(25).toString("hex");
  await admin.query("ALTER ROLE "+draftRole+" PASSWORD '"+draftSecret+"'; ALTER ROLE "+approvalRole+" PASSWORD '"+secret+"'");
  const login=(name,value)=>"postgresql://"+name+":"+value+"@"+new URL(approvalRun.env.DREAM_PROJECT_PLAN_DB_URL).host+"/postgres";
  const approvalConfig={draftSecret,secret,env:{...approvalRun.env,DREAM_PROJECT_PLAN_DB_URL:login(draftRole,draftSecret),
    DREAM_PROJECT_PLAN_APPROVAL_DB_URL:login(approvalRole,secret)}};
  const sql=(await readFile(new URL("lib/db/postgres/managed-project-plan/0003_topic_shorts.sql",rootPath),"utf8")).replaceAll("\r\n","\n");
  assert.equal(createHash("sha256").update(sql).digest("hex"),"6664e5eb6b3f499842ffa339bd33d70624eacffca6cf3ac90cc72f1655a6f086");
  const topicCommand=inputs=>({menuId:"topic-shorts",inputs:{title:"Topic plan",goal:"Goal",target:"Audience",aspect:"9:16",lengthSec:20,
    topic:"겨울철 실내 습도",keyMessage:"습도를 지키면 도움이 된다.",...inputs}});
  const topicBrief=async (call,inputs={},approve=true)=>{
    const {id}=await body(call("/api/projects",{input:topicCommand(inputs)}),201,"topic project");
    const brief="/api/projects/"+id+"/brief";
    const {revision}=await body(call(brief),200);
    if(approve) await body(call(brief,{input:{acknowledged:true,revision}}),200,"topic brief");
    return {id,revision};
  };
  const scenesFor=(lengths,steps=["hook","message","close"])=>lengths.map((durationSec,index)=>({stepId:steps[index]??"custom",
    title:"Topic scene "+(index+1),description:"Synthetic topic shot",dialogue:"Synthetic topic voice",durationSec,characterIds:[],assetIds:[]}));
  const draftOf=(project,version=0,lengths=[5,7,8],steps)=>({revision:project.revision,version,
    draft:{script:"Topic storyboard",scenes:scenesFor(lengths,steps)}});

  // 기획 0003 전: 기획 역할 정책이 주제별 쇼츠 프로젝트를 보지 않아 404이고 아무것도 쓰지 않는다.
  let early;
  await startProfile(approvalConfig.env,async call=>{
    early=await topicBrief(call);
    await body(call(route(early.id)),404,"topic plan before 0003");
    await body(call(route(early.id),{input:draftOf(early)}),404,"topic save before 0003");
  });
  assert.deepEqual(await state(admin,early.id),{drafts:0,materials:0,approvals:0,scene_ids:[],approved_id:null,produce:"locked"});
  await admin.query("SET ROLE p102_migrate");
  try {
    await admin.query("SELECT set_config('dream.managed_plan.install_ref',$1,false),set_config('dream.managed_plan.install_database','postgres',false)",[projectRef]);
    assert.equal((await admin.query(sql)).at(-1).command,"COMMIT");
    await assert.rejects(admin.query(sql),{message:"MANAGED_PLAN_TOPIC_SHORTS_TARGET"});
    await admin.query("ROLLBACK");
  } finally { await admin.query("RESET ROLE"); }
  const {rows:policies}=await admin.query(`SELECT polname,pg_get_expr(polqual,polrelid) AS qual,pg_get_expr(polwithcheck,polrelid) AS check
    FROM pg_policy WHERE polrelid='dream.projects'::regclass AND polname LIKE 'managed_%' ORDER BY polname`);
  assert.deepEqual(policies.map(policy=>policy.polname),["managed_approval_project_link","managed_approval_project_lock",
    "managed_approval_project_read","managed_plan_lock","managed_plan_read"]);
  for (const policy of policies) {
    assert.match(policy.qual,/menu_id = ANY \(ARRAY\['shopping-shorts'::text, 'topic-shorts'::text\]\)/);
    assert.match(policy.qual,/owner_id = dream\.actor_id\(\)/);
    assert.match(policy.qual,/archived_at IS NULL/);
  }
  assert.match(policies[0].qual,/approved_plan_id IS NULL/);
  assert.match(policies[0].check,/reviewed_plan_id/);
  assert.deepEqual([policies[1].check,policies[3].check],["false","false"]);

  let audited, locked, waitingId, draftId;
  await startProfile(approvalConfig.env,async (call,origin)=>{
    // 0003 전에 만든 같은 프로젝트를 그대로 이어 간다.
    const opened=await body(call(route(early.id)),200);
    assert.deepEqual(opened.steps,[{id:"hook",label:"첫 장면 훅"},{id:"message",label:"핵심 메시지"},{id:"support",label:"근거·예시"},
      {id:"close",label:"마무리·행동 유도"}]);
    assert.deepEqual([opened.version,opened.lengthSec,opened.draft,opened.planId,opened.canApprove],[0,20,null,null,false]);
    assert.deepEqual(opened.capabilities,{saveDraft:true,importShortsDraft:true,approvePlan:false});

    const waiting=await topicBrief(call,{},false);
    waitingId=waiting.id;
    assert.equal((await body(call(route(waiting.id)),409)).error,"브리프를 먼저 승인해 주세요.");
    await body(call(route(waiting.id),{input:draftOf(waiting)}),409);

    const project=early, input=draftOf(project);
    await body(call(route(project.id),{actor:null}),401);
    await body(call(route(project.id),{actor:1}),404);
    await body(call(route(project.id),{actor:1,input}),404);
    await body(call(route(project.id),{input,originOverride:"https://foreign.invalid"}),403);
    await body(call(route(project.id),{input:{...input,revision:99}}),409);
    await body(call(route(project.id),{input:draftOf(project,0,[5,7,8],["hook","proof","close"])}),400,"shopping step");
    assert.deepEqual(await state(admin,project.id),{drafts:0,materials:0,approvals:0,scene_ids:[],approved_id:null,produce:"locked"});

    const race=await Promise.all([call(route(project.id),{input}),call(route(project.id),{input})]);
    assert.deepEqual(race.map(response=>response.status).sort(),[201,409]);
    const saved=await race.find(response=>response.status===201).json();
    await race.find(response=>response.status===409).body?.cancel();
    assert.deepEqual(saved.draft,input.draft);
    const read=await body(call(route(project.id)),200);
    assert.deepEqual([read.version,read.planId,read.draft,read.canApprove,read.capabilities.approvePlan],[1,saved.planId,input.draft,true,true]);

    // 응답을 잃은 저장은 다시 읽으면 반영돼 있고, 같은 내용 재전송은 낡은 버전으로 거부된다.
    const next=draftOf(project,1,[4,8,8]);
    await loseResponse(origin,route(project.id),v7(),next);
    const reopened=await body(call(route(project.id)),200);
    assert.deepEqual([reopened.version,reopened.draft],[2,next.draft]);
    await body(call(route(project.id),{input:next}),409);
    assert.deepEqual(await state(admin,project.id),{drafts:2,materials:0,approvals:0,scene_ids:[],approved_id:null,produce:"locked"});

    const approve=approvalCommand({revision:reopened.revision,version:reopened.version,planId:reopened.planId});
    await body(call(route(project.id),{input:approvalCommand(saved)}),409,"old version approval");
    await body(call(route(project.id),{actor:1,input:approve}),404);
    await body(call(route(project.id),{actor:null,input:approve}),401);
    await loseResponse(origin,route(project.id),v7(),approve);
    const committed=await state(admin,project.id);
    assert.deepEqual([committed.approved_id,committed.approvals,committed.produce,committed.scene_ids.length],[reopened.planId,1,"todo",3]);
    const replies=await Promise.all([body(call(route(project.id),{input:approve}),200),body(call(route(project.id),{input:approve}),200)]);
    for (const replay of replies) assert.deepEqual(replay,{planId:reopened.planId,version:2,approved:true,produceOpen:true,hostedProductionAvailable:false});
    assert.deepEqual(await state(admin,project.id),committed);
    const {rows:[plan]}=await admin.query("SELECT approved_scene_snapshot_json::jsonb AS scenes,steps_json::jsonb AS steps FROM dream.plans WHERE id=$1 AND status='approved'",[reopened.planId]);
    assert.deepEqual(plan.scenes.map(scene=>scene.id),committed.scene_ids);
    assert.deepEqual(plan.scenes.map(scene=>[scene.position,scene.durationSec,scene.projectId]),[[1,4,project.id],[2,8,project.id],[3,8,project.id]]);
    assert.deepEqual(plan.steps.map(scene=>scene.stepId),["hook","message","close"]);
    const after=await body(call(route(project.id)),200);
    assert.deepEqual([after.approved,after.produceOpen,after.writable,after.canApprove],[true,true,false,false]);
    await body(call(route(project.id),{input:draftOf(project,2)}),409);
    assert.equal((await body(call("/api/projects/"+project.id),200)).project.approvedPlanId,reopened.planId);
    audited=project.id;

    // 길이가 다른 초안은 저장되지만 승인할 수 없다(프로젝트 길이 30초, 초안 20초).
    const longer=await topicBrief(call,{lengthSec:30,keyMessageLength:"50"});
    draftId=longer.id;
    const short=await body(call(route(longer.id),{input:draftOf(longer)}),201);
    assert.equal((await body(call(route(longer.id)),200)).canApprove,false);
    await body(call(route(longer.id),{input:approvalCommand(short)}),409);
    assert.deepEqual((await state(admin,longer.id)).approvals,0);

    // 잠긴 분야 프로젝트(관리자가 직접 넣은 travel-shorts)는 기획 경로에서 보이지 않는다.
    locked=v7();
    await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,
      aspect,length_sec,content_revision,created_at,updated_at) SELECT owner_id,$2,'travel-shorts',template_version,template_snapshot_json,
      inputs_json,title,goal,target,aspect,length_sec,1,created_at,updated_at FROM dream.projects WHERE id=$1`,[longer.id,locked]);
    await admin.query(`INSERT INTO dream.stage_states(owner_id,project_id,stage,status,approved_at)
      SELECT owner_id,$2,stage,status,approved_at FROM dream.stage_states WHERE project_id=$1`,[longer.id,locked]);
    await body(call(route(locked)),404,"locked menu plan");
    await body(call(route(locked),{input:draftOf({revision:1})}),404,"locked menu save");
  });

  for (const [name,secret] of [[draftRole,approvalConfig.draftSecret],[approvalRole,approvalConfig.secret]]) {
    const client=await connect(name,secret);
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dream.actor_id',$1,true)",[users[0].id]);
      assert.equal((await client.query("SELECT id FROM dream.projects WHERE id=$1",[audited])).rowCount,1,name);
      assert.equal((await client.query("SELECT id FROM dream.projects WHERE id=$1",[locked])).rowCount,0,name);
      await client.query("SELECT set_config('dream.actor_id',$1,true)",[users[1].id]);
      assert.equal((await client.query("SELECT id FROM dream.projects WHERE id=$1",[audited])).rowCount,0,name);
      await client.query("ROLLBACK");
    } finally { await client.end(); }
  }
  console.log(JSON.stringify({stage:"topic-plan",before0003:"404-no-state",install:"0003",rerunRejected:true,policies:5,
    briefLocked:true,menuSteps:["hook","message","support","close"],cas:[201,409],lostSaveRecovered:true,staleVersion:409,
    lostApprovalReplayed:true,concurrentReplays:[200,200],scenes:3,snapshotMatches:true,lengthMismatchBlocked:true,
    ownerIsolation:true,lockedMenuHidden:true}));
  // --scene-flow(장면 SQL 설치) 뒤면 같은 승인 프로젝트로 결과 등록·장면 읽기·선택을 확인한다.
  if (sceneRead) {
    const {verifyTopicScenes}=await import("./managed-scene-flow-http.mjs");
    await verifyTopicScenes(context,approvalConfig.env,{approved:audited,waiting:waitingId,draft:draftId,locked});
  }
}
