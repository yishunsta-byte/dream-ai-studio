/* global URL, URLSearchParams, console, fetch */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { v7 } from "uuid";
import sharp from "sharp";

export async function installBrief(admin, cfg) {
  await admin.query(await readFile(new URL("../../lib/db/postgres/local-project-brief/local.sql", import.meta.url), "utf8"));
  const {rows:[credentials]} = await admin.query("SELECT quote_literal($1::text) AS password", [cfg.password]);
  await admin.query("CREATE ROLE local_project_brief_login LOGIN NOINHERIT PASSWORD " + credentials.password);
  await admin.query("GRANT local_project_brief TO local_project_brief_login WITH INHERIT FALSE, SET TRUE");
}

export async function verifyBrief({admin,origin,owner,other,post,body,actor,asset}) {
  const created = await post(owner,v7(),body);
  assert.equal(created.status,201);
  const id = created.body.id;
  const production = cookie => fetch(origin+"/api/projects/"+id+"/production", {
    headers:cookie ? {cookie} : undefined, redirect:"manual",
  });
  const productionPage = cookie => fetch(origin+"/cloud/projects/"+id+"/produce", {
    headers:cookie ? {cookie} : undefined, redirect:"manual",
  });
  const register = (cookie,data,requestOrigin=origin) => fetch(origin+"/api/projects/"+id+"/production", {
    method:"POST",headers:{...(cookie && {cookie}),origin:requestOrigin,"content-type":"application/json"},
    body:JSON.stringify(data),
  });
  const plan = (cookie, command, requestOrigin = origin) => fetch(origin+"/api/projects/"+id+"/plan",{
    method:command ? "POST" : "GET",
    headers:{...(cookie && {cookie}),"content-type":"application/json", origin:requestOrigin},
    body:command && JSON.stringify(command),
  });
  const call = (cookie,command) => fetch(origin+"/api/projects/"+id+"/brief",{
    method:command?"POST":"GET",headers:{...(cookie && {cookie}),"content-type":"application/json"},
    body:command && JSON.stringify(command),
  });
  const read = async () => {
    const response=await call(owner);
    assert.equal(response.status,200);
    return response.json();
  };
  const initial=await read();
  assert.deepEqual(initial.stages,{intake:"approved",brief:"todo",plan:"locked"});
  assert.equal((await plan(owner)).status,409);
  const command={acknowledged:true,revision:initial.revision};
  const counts=async()=>(await admin.query(`SELECT
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action='brief.confirm') approvals,
    (SELECT status FROM dream.stage_states WHERE project_id=$1 AND stage='edit') edit,
    (SELECT count(*)::int FROM dream.timeline_revisions WHERE project_id=$1) timelines`,[id])).rows[0];
  assert.equal((await call(null,command)).status,401);
  assert.equal((await call(other,command)).status,404);
  assert.equal((await call(owner,{...command,acknowledged:false})).status,400);
  assert.equal((await call(owner,{...command,revision:initial.revision+1})).status,409);
  assert.deepEqual(await counts(),{approvals:0,edit:"locked",timelines:0});
  const concurrent=await Promise.all([call(owner,command),call(owner,command)]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  assert.deepEqual((await read()).stages,{intake:"approved",brief:"approved",plan:"todo"});
  assert.deepEqual(await counts(),{approvals:1,edit:"locked",timelines:0});
  console.log("Brief approval: revision conflict, concurrent approval, ownership, edit lock and zero timelines passed");

  const first = await plan(owner);
  assert.equal(first.status,200);
  assert.equal(first.headers.get("cache-control"),"private, no-store");
  const { revision, version, draft } = await first.json();
  assert.equal(version,0);
  assert.equal(draft,null);
  const input = { revision, version, draft:{script:"제품을 보여 줍니다.",scenes:[{
    stepId:"custom",title:"제품 소개",description:"제품 이미지에서 시작합니다.",dialogue:"안녕하세요",
    durationSec:5,characterIds:[],assetIds:[],
  }]} };
  assert.equal((await plan(null,input)).status,401);
  assert.equal((await plan(other)).status,404);
  assert.equal((await plan(other,input)).status,404);
  assert.equal((await plan(owner,input,"https://other.invalid")).status,403);
  assert.equal((await plan(owner,{...input,revision:revision+1})).status,409);
  assert.equal((await plan(owner,{...input,approve:true})).status,400);
  const competing = await Promise.all([plan(owner,input),plan(owner,input)]);
  assert.deepEqual(competing.map(response=>response.status).sort(),[201,409]);
  const saved = await competing.find(response=>response.status===201).json();
  assert.deepEqual(saved,{revision,version:1,planId:saved.planId,draft:input.draft});
  assert.equal((await plan(owner,input)).status,409);
  const update = {...input,version:1,draft:{script:"수정한 대본입니다.",scenes:[...input.draft.scenes,{
    ...input.draft.scenes[0],title:"가방에 넣기",description:"제품을 가방에 넣습니다.",durationSec:3,
  }]}};
  assert.equal((await plan(owner,update)).status,201);
  const reopened = await plan(owner);
  assert.equal(reopened.status,200);
  const loaded = await reopened.json();
  assert.equal(loaded.version,2);
  assert.equal(loaded.canApprove,true);
  assert.equal(loaded.approved,false);
  assert.equal(loaded.produceOpen,false);
  assert.deepEqual(loaded.draft,update.draft);
  assert.deepEqual((await admin.query(`SELECT status,script,approved_at FROM dream.plans
    WHERE project_id=$1 ORDER BY version`,[id])).rows,[
    {status:"draft",script:input.draft.script,approved_at:null},
    {status:"draft",script:update.draft.script,approved_at:null},
  ]);
  assert.deepEqual((await admin.query(`SELECT
    (SELECT approved_plan_id FROM dream.projects WHERE id=$1) approval,
    (SELECT status FROM dream.stage_states WHERE project_id=$1 AND stage='plan') plan,
    (SELECT status FROM dream.stage_states WHERE project_id=$1 AND stage='produce') produce,
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action='plan.draft') saves`,[id])).rows[0],
  {approval:null,plan:"todo",produce:"locked",saves:2});
  assert.deepEqual(await counts(),{approvals:1,edit:"locked",timelines:0});
  assert.equal((await production(owner)).status,404);
  assert.equal((await productionPage(owner)).status,404);
  console.log("Planning draft: save, reopen, revision/version conflict, ownership, approval and production locks passed");

  const approval = { action:"approve-plan", acknowledged:true, revision, version:2, planId:loaded.planId };
  const savedState = async () => (await admin.query(`SELECT
    (SELECT approved_plan_id FROM dream.projects WHERE id=$1) approval,
    (SELECT approved_plan_id FROM dream.stage_states WHERE project_id=$1 AND stage='plan') stage_approval,
    (SELECT status FROM dream.stage_states WHERE project_id=$1 AND stage='plan') plan,
    (SELECT status FROM dream.stage_states WHERE project_id=$1 AND stage='produce') produce,
    (SELECT count(*)::int FROM dream.scenes WHERE project_id=$1 AND archived_at IS NULL) scenes,
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action='plan.approve') approvals`,[id])).rows[0];
  const locked = {approval:null,stage_approval:null,plan:"todo",produce:"locked",scenes:0,approvals:0};
  assert.equal((await plan(null,approval)).status,401);
  assert.equal((await plan(other,approval)).status,404);
  assert.equal((await plan(owner,approval,"https://other.invalid")).status,403);
  assert.equal((await plan(owner,{...approval,acknowledged:false})).status,400);
  assert.equal((await plan(owner,{...approval,revision:revision+1})).status,409);
  assert.equal((await plan(owner,{...approval,version:1,planId:saved.planId})).status,409);
  assert.equal((await plan(owner,{...approval,planId:saved.planId})).status,409);
  assert.deepEqual(await savedState(),locked);
  await admin.query(`CREATE FUNCTION dream.test_plan_approval_rollback() RETURNS trigger LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$;
    CREATE TRIGGER test_plan_approval_rollback BEFORE INSERT ON dream.activity_log
    FOR EACH ROW WHEN (NEW.action='plan.approve') EXECUTE FUNCTION dream.test_plan_approval_rollback()`);
  try {
    assert.equal((await plan(owner,approval)).status,503);
    assert.deepEqual(await savedState(),locked);
    assert.equal((await plan(owner).then(response=>response.json())).canApprove,true);
  } finally {
    await admin.query("DROP TRIGGER test_plan_approval_rollback ON dream.activity_log; DROP FUNCTION dream.test_plan_approval_rollback()");
  }
  const approvers = await Promise.all([plan(owner,approval),plan(owner,approval)]);
  assert.deepEqual(approvers.map(response=>response.status).sort(),[200,409]);
  assert.deepEqual(await savedState(),{
    approval:loaded.planId,stage_approval:loaded.planId,plan:"approved",produce:"todo",scenes:2,approvals:1,
  });
  const approved = await plan(owner).then(response=>response.json());
  assert.equal(approved.planId,loaded.planId);
  assert.equal(approved.approved,true);
  assert.equal(approved.produceOpen,true);
  assert.equal(approved.writable,false);
  assert.deepEqual(approved.draft,update.draft);
  assert.equal((await plan(owner,{...update,version:2})).status,409);
  const { rows: [snapshot] } = await admin.query(`SELECT
    (SELECT approved_scene_snapshot_json FROM dream.plans WHERE id=$2)::jsonb AS snapshot,
    (SELECT id FROM dream.scenes WHERE project_id=$1 AND archived_at IS NULL ORDER BY position LIMIT 1) scene`,[id,loaded.planId]);
  assert.equal(snapshot.snapshot.length,2);
  assert.equal(snapshot.snapshot[0].id,snapshot.scene);
  assert.equal(snapshot.snapshot[0].description,update.draft.scenes[0].description);
  assert.deepEqual(await counts(),{approvals:1,edit:"locked",timelines:0});
  console.log("Plan approval: explicit current-version approval, rollback, owner isolation, scene snapshot and production opening passed");

  assert.equal((await production(null)).status,401);
  assert.equal((await production(other)).status,404);
  assert.equal((await productionPage(other)).status,404);
  const page = await productionPage(owner);
  assert.equal(page.status,200);
  assert.match(await page.text(),/장면 제작/u);
  const initialScenes = await production(owner);
  assert.equal(initialScenes.status,200);
  assert.equal(initialScenes.headers.get("cache-control"),"private, no-store");
  const readAsset = async () => (await admin.query("SELECT id,title,sha256,file_path,rights_note FROM dream.assets WHERE id=$1",[asset])).rows[0];
  const original = await readAsset();
  const savedScenes = {planVersion:2,planId:loaded.planId,revision,canRegister:true,canSelect:true,
    canApprove:false,productionApproved:false,editOpen:false,sources:[{id:asset,title:original.title}],
    scenes:update.draft.scenes.map((scene,index)=>({
    id:snapshot.snapshot[index].id,position:index+1,title:scene.title,description:scene.description,
    durationSec:scene.durationSec,readiness:"waiting",selectedVersionId:null,results:[],
  }))};
  assert.deepEqual(await initialScenes.json(),savedScenes);
  assert.deepEqual(await production(owner).then(response=>response.json()),savedScenes);
  const registration={action:"register-png",sceneId:snapshot.scene,assetId:asset,planId:loaded.planId,revision};
  const productionApproval={action:"approve-production",planId:loaded.planId,revision,acknowledged:true};
  const incomplete=await register(owner,productionApproval);
  assert.equal(incomplete.status,409);
  assert.equal((await incomplete.json()).code,"SCENE_RESULTS_REQUIRED");
  assert.equal((await register(null,registration)).status,401);
  assert.equal((await register(other,registration)).status,404);
  assert.equal((await register(owner,registration,"https://other.invalid")).status,403);
  assert.equal((await register(owner,{...registration,revision:revision+1})).status,409);
  assert.equal((await register(owner,{...registration,planId:saved.planId})).status,409);
  assert.equal((await register(owner,{...registration,sceneId:v7()})).status,404);
  const foreignAsset=(await admin.query("SELECT id FROM dream.assets WHERE owner_id<>$1 AND mime='image/png' LIMIT 1",[actor])).rows[0].id;
  assert.equal((await register(owner,{...registration,assetId:foreignAsset})).status,404);
  for (const [table,row] of [["assets",asset],["scenes",snapshot.scene],["projects",id]]) {
    await admin.query(`UPDATE dream.${table} SET archived_at=now() WHERE id=$1`,[row]);
    try {assert.equal((await register(owner,registration)).status,404);}
    finally {await admin.query(`UPDATE dream.${table} SET archived_at=NULL WHERE id=$1`,[row]);}
  }
  assert.deepEqual(await production(owner).then(response=>response.json()),savedScenes);
  const entries=await Promise.all([register(owner,registration),register(owner,registration)]);
  assert.deepEqual(entries.map(entry=>entry.status).sort(),[200,201]);
  const [result,replay]=await Promise.all(entries.map(entry=>entry.json()));
  assert.deepEqual(replay,result);
  assert.equal(result.assetId,asset);
  assert.equal(result.version,1);
  assert.equal(result.title,original.title);
  const registered={...savedScenes,scenes:savedScenes.scenes.map((scene,index)=>index===0?{...scene,results:[result]}:scene)};
  assert.deepEqual(await production(owner).then(response=>response.json()),registered);
  assert.deepEqual(await readAsset(),original);
  const {rows:[stored]}=await admin.query(`SELECT v.input_snapshot_json,v.status,s.selected_version_id,
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$2 AND action='scene.result_registered') AS audit
    FROM dream.scene_versions v JOIN dream.scenes s ON (s.owner_id,s.id)=(v.owner_id,v.scene_id) WHERE v.id=$1`,[result.id,id]);
  assert.deepEqual(JSON.parse(stored.input_snapshot_json),{
    schemaVersion:1,source:"verified-png",assetId:asset,sha256:original.sha256,rightsNote:original.rights_note,
  });
  assert.equal(stored.status,"succeeded");
  assert.equal(stored.selected_version_id,null);
  assert.equal(stored.audit,1);
  assert.deepEqual(await savedState(),{
    approval:loaded.planId,stage_approval:loaded.planId,plan:"approved",produce:"todo",scenes:2,approvals:1,
  });
  console.log("Scene PNG registration: verified project source, ownership, revisions, archives, deduplicated result and preserved source passed");
  const historicId=v7();
  await admin.query(`INSERT INTO dream.scene_versions
    (owner_id,scene_id,plan_id,result_asset_id,id,version,kind,input_snapshot_json,status,created_at)
    VALUES($1,$2,$3,$4,$5,2,'image',$6,'succeeded',clock_timestamp())`,
  [actor,snapshot.scene,saved.planId,asset,historicId,stored.input_snapshot_json]);
  const versionsBefore = async () => (await admin.query(`
    SELECT id,version,plan_id,result_asset_id,status,input_snapshot_json FROM dream.scene_versions
    WHERE scene_id=$1 ORDER BY version`,[snapshot.scene])).rows;
  const originalResults=await versionsBefore();
  const select={action:"select",sceneId:snapshot.scene,versionId:result.id,expectedVersionId:null,planId:loaded.planId,revision};
  assert.equal((await register(null,select)).status,401);
  assert.equal((await register(other,select)).status,404);
  assert.equal((await register(owner,select,"https://other.invalid")).status,403);
  assert.equal((await register(owner,{...select,planId:saved.planId})).status,409);
  assert.equal((await register(owner,{...select,revision:revision+1})).status,409);
  assert.equal((await register(owner,{...select,expectedVersionId:result.id})).status,409);
  assert.equal((await register(owner,{...select,sceneId:snapshot.snapshot[1].id})).status,404);
  assert.equal((await register(owner,{...select,versionId:historicId})).status,404);
  for (const [table,row] of [["assets",asset],["scenes",snapshot.scene],["projects",id]]) {
    await admin.query(`UPDATE dream.${table} SET archived_at=now() WHERE id=$1`,[row]);
    try {assert.equal((await register(owner,select)).status,404);}
    finally {await admin.query(`UPDATE dream.${table} SET archived_at=NULL WHERE id=$1`,[row]);}
  }
  assert.deepEqual(await production(owner).then(response=>response.json()),registered);
  await admin.query(`CREATE FUNCTION dream.test_scene_selection_rollback() RETURNS trigger LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$;
    CREATE TRIGGER test_scene_selection_rollback BEFORE INSERT ON dream.activity_log
    FOR EACH ROW WHEN (NEW.action='scene.select') EXECUTE FUNCTION dream.test_scene_selection_rollback()`);
  try {
    assert.equal((await register(owner,select)).status,503);
    assert.deepEqual(await production(owner).then(response=>response.json()),registered);
  } finally {
    await admin.query("DROP TRIGGER test_scene_selection_rollback ON dream.activity_log; DROP FUNCTION dream.test_scene_selection_rollback()");
  }
  const selections=await Promise.all([register(owner,select),register(owner,select)]);
  assert.deepEqual(selections.map(entry=>entry.status).sort(),[200,409]);
  const selection=await selections.find(entry=>entry.status===200).json();
  assert.deepEqual(selection,{sceneId:snapshot.scene,selectedVersionId:result.id,revision:revision+1,canApprove:false});
  assert.equal((await register(owner,select)).status,409);
  const duplicate=await register(owner,{...select,expectedVersionId:result.id,revision:revision+1});
  assert.equal(duplicate.status,200);
  assert.deepEqual(await duplicate.json(),selection);
  assert.deepEqual(await versionsBefore(),originalResults);
  assert.deepEqual(await readAsset(),original);
  assert.equal((await admin.query("SELECT count(*)::int AS count FROM dream.activity_log WHERE project_id=$1 AND action='scene.select'",[id])).rows[0].count,1);
  console.log("Scene result selection: owner, scene, approved version, archive, rollback and concurrent CAS passed");
  await admin.query("UPDATE dream.scenes SET needs_recheck=1 WHERE id=$1",[snapshot.snapshot[1].id]);
  const readiness = {...registered,revision:revision+1,scenes:registered.scenes.map((scene,index)=>({
    ...scene,readiness:index===0?"selected":"recheck",selectedVersionId:index===0?result.id:null,
  }))};
  assert.deepEqual(await production(owner).then(response=>response.json()),readiness);
  await admin.query("UPDATE dream.stage_states SET status='locked' WHERE project_id=$1 AND stage='produce'",[id]);
  try {
    assert.equal((await production(owner)).status,404);
    assert.equal((await productionPage(owner)).status,404);
  } finally {
    await admin.query("UPDATE dream.stage_states SET status='todo' WHERE project_id=$1 AND stage='produce'",[id]);
  }
  assert.deepEqual(await production(owner).then(response=>response.json()),readiness);
  assert.deepEqual(await savedState(),{
    approval:loaded.planId,stage_approval:loaded.planId,plan:"approved",produce:"todo",scenes:2,approvals:1,
  });
  assert.deepEqual(await counts(),{approvals:1,edit:"locked",timelines:0});
  console.log("Production entry: protected page, saved plan order, persisted readiness and read-only reload passed");

  const secondScene=snapshot.snapshot[1].id;
  const uploadPng = async (bytes,filename) => {
    const response=await fetch(origin+"/api/assets/upload?"+new URLSearchParams({filename,rightsNote:"추가 PNG 권리 메모"}),{
      method:"POST",headers:{cookie:owner,"content-type":"image/png","idempotency-key":v7()},body:bytes,
    });
    assert.equal(response.status,201);
    return (await response.json()).id;
  };
  const extraBytes=await sharp({create:{width:4,height:4,channels:3,background:"#358faf"}}).png().toBuffer();
  const secondAsset=await uploadPng(extraBytes,"second-product.png");
  const duplicatedBytes=await uploadPng(extraBytes,"second-duplicate.png");
  const attachment={action:"attach-png",planId:loaded.planId,revision:revision+1,assetId:secondAsset};
  assert.equal((await register(null,attachment)).status,401);
  assert.equal((await register(other,attachment)).status,404);
  assert.equal((await register(owner,{...attachment,assetId:foreignAsset})).status,404);
  assert.equal((await register(owner,{...attachment,revision})).status,409);
  const originalReplay=await register(owner,{...attachment,assetId:asset});
  assert.equal(originalReplay.status,200);
  assert.deepEqual(await originalReplay.json(),{id:asset,title:original.title});
  for(const [table,row] of [["assets",secondAsset],["projects",id]]) {
    await admin.query(`UPDATE dream.${table} SET archived_at=now() WHERE id=$1`,[row]);
    try {assert.equal((await register(owner,attachment)).status,404);}
    finally {await admin.query(`UPDATE dream.${table} SET archived_at=NULL WHERE id=$1`,[row]);}
  }
  const firstAttachment=await Promise.all([register(owner,attachment),register(owner,attachment)]);
  assert.deepEqual(firstAttachment.map(response=>response.status).sort(),[200,201]);
  const secondSource={id:secondAsset,title:"second-product.png"};
  for(const response of firstAttachment) assert.deepEqual(await response.json(),secondSource);
  const retryAttachment=await register(owner,attachment);
  assert.equal(retryAttachment.status,200);
  assert.deepEqual(await retryAttachment.json(),secondSource);
  assert.equal((await register(owner,{...attachment,assetId:duplicatedBytes})).status,409);
  assert.deepEqual((await production(owner).then(response=>response.json())).sources,[...savedScenes.sources,secondSource]);
  assert.deepEqual((await admin.query(`SELECT purpose,asset_id FROM dream.project_assets
    WHERE project_id=$1 ORDER BY purpose`,[id])).rows,[
    {purpose:"productAssets",asset_id:asset},{purpose:"productionImage",asset_id:secondAsset},
  ]);
  const attachments=await admin.query("SELECT count(*)::int AS count FROM dream.activity_log WHERE project_id=$1 AND action='production.png_attached'",[id]);
  assert.equal(attachments.rows[0].count,1);
  const nextResult=await register(owner,{...registration,sceneId:secondScene,revision:revision+1,assetId:secondAsset});
  assert.equal(nextResult.status,201);
  const secondResult=await nextResult.json();
  const lastSelection=await register(owner,{...select,sceneId:secondScene,versionId:secondResult.id,revision:revision+1});
  assert.equal(lastSelection.status,200);
  assert.deepEqual(await lastSelection.json(),{sceneId:secondScene,selectedVersionId:secondResult.id,revision:revision+2,canApprove:true});
  const ready=await production(owner).then(response=>response.json());
  assert.equal(ready.canApprove,true);
  assert.deepEqual(ready.scenes.map(scene=>scene.results.find(item=>item.id===scene.selectedVersionId).assetId),[asset,secondAsset]);
  const originalInput=(await admin.query("SELECT inputs_json::jsonb AS inputs FROM dream.projects WHERE id=$1",[id])).rows[0].inputs;
  assert.deepEqual(originalInput.productAssets,[asset]);
  const metadata=(await admin.query("SELECT sha256,rights_note FROM dream.assets WHERE id=$1",[secondAsset])).rows[0];
  assert.notEqual(metadata.sha256,original.sha256);
  assert.equal(metadata.rights_note,"추가 PNG 권리 메모");
  console.log("Second PNG attachment: real upload, independent sources, conflicts, replay and original creation input preserved");
  const request={...productionApproval,revision:revision+2};
  assert.equal((await register(null,request)).status,401);
  assert.equal((await register(other,request)).status,404);
  assert.equal((await register(owner,request,"https://other.invalid")).status,403);
  assert.equal((await register(owner,{...request,acknowledged:false})).status,400);
  assert.equal((await register(owner,{...request,planId:saved.planId})).status,409);
  assert.equal((await register(owner,productionApproval)).status,409);
  for (const [table,column,row,value,restore] of [
    ["scenes","needs_recheck",secondScene,1,0],["scenes","archived_at",secondScene,new Date(),null],
    ["assets","archived_at",asset,new Date(),null],
    ["assets","archived_at",secondAsset,new Date(),null],
  ]) {
    await admin.query(`UPDATE dream.${table} SET ${column}=$2 WHERE id=$1`,[row,value]);
    try {
      const rejected=await register(owner,request);
      assert.equal(rejected.status,409);
      assert.equal((await rejected.json()).code,"SCENE_RESULTS_REQUIRED");
      assert.equal((await production(owner).then(response=>response.json())).canApprove,false);
    } finally {
      await admin.query(`UPDATE dream.${table} SET ${column}=$2 WHERE id=$1`,[row,restore]);
    }
  }
  const approvedState=async ()=>(await admin.query(`SELECT
    (SELECT approved_revision::int FROM dream.stage_states WHERE project_id=$1 AND stage='produce') revision,
    (SELECT approved_plan_id FROM dream.stage_states WHERE project_id=$1 AND stage='produce') approval,
    (SELECT status FROM dream.stage_states WHERE project_id=$1 AND stage='produce') produce,
    (SELECT status FROM dream.stage_states WHERE project_id=$1 AND stage='edit') edit,
    (SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND action='produce.approve') approvals`,[id])).rows[0];
  const beforeApproval={revision:null,approval:null,produce:"todo",edit:"locked",approvals:0};
  assert.deepEqual(await approvedState(),beforeApproval);
  await admin.query(`CREATE FUNCTION dream.test_production_rollback() RETURNS trigger LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$;
    CREATE TRIGGER test_production_rollback BEFORE INSERT ON dream.activity_log
    FOR EACH ROW WHEN (NEW.action='produce.approve') EXECUTE FUNCTION dream.test_production_rollback()`);
  try {
    assert.equal((await register(owner,request)).status,503);
    assert.deepEqual(await approvedState(),beforeApproval);
    assert.deepEqual(await production(owner).then(response=>response.json()),ready);
  } finally {
    await admin.query("DROP TRIGGER test_production_rollback ON dream.activity_log; DROP FUNCTION dream.test_production_rollback()");
  }
  const approvals=await Promise.all([register(owner,request),register(owner,request)]);
  assert.deepEqual(approvals.map(response=>response.status).sort(),[200,409]);
  assert.deepEqual(await approvals.find(response=>response.status===200).json(),{productionApproved:true,editOpen:true});
  assert.deepEqual(await approvedState(),{revision:revision+2,approval:loaded.planId,produce:"approved",edit:"todo",approvals:1});
  assert.deepEqual(await production(owner).then(response=>response.json()),{...ready,
    canApprove:false,canRegister:false,canSelect:false,productionApproved:true,editOpen:true,
  });
  assert.deepEqual(await counts(),{approvals:1,edit:"todo",timelines:0});
  assert.equal((await register(owner,{...attachment,revision:revision+2})).status,409);
  console.log("Production approval: acknowledged complete selections, conflict and rollback, edit opening and persisted approval passed");
}
