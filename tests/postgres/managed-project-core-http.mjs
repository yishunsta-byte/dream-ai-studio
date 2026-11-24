/* global AbortSignal, Buffer, console, fetch, process, URL */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { v7 } from "uuid";
import { fixturePolicy, registeredImage } from "./managed-project-core-asset-fixture.mjs";

const users = [1,2,3].map(i=>({ id:"10000000-0000-4000-8000-"+String(i).padStart(12,"0"),email:"fixture-"+i+"@example.invalid" }));
const publicKey="sb_publishable_p102_fixture_only_key";
const role="dream_project_core_app";
// --pg17-draft: the same database also gets the unpublished PG17 reservation draft and 0006, and the HTTP assets are
// reserved by a restricted 0005 login with observation-checked receipts (managed-project-pg17-draft-asset-fixture.mjs).
const pg17Draft=process.argv.includes("--pg17-draft");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const base64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");

export async function verifyHttp({ admin, rootPath, connect, cert, key, dbHost, authHost, projectRef, port, password, freePort, loopback }) {
  const authOrigin="https://"+authHost;
  if (pg17Draft && ["--plan-draft","--plan-approval","--scene-flow","--asset-choices"].some(flag=>process.argv.includes(flag)))
    throw new Error("Run --pg17-draft alone so it uses a fresh database.");
  const draft=pg17Draft?await import("./managed-project-pg17-draft-asset-fixture.mjs"):null;
  const sql4 = (await readFile(new URL("lib/db/postgres/0004_storage_verification.sql",rootPath),"utf8")).replaceAll("\r\n","\n");
  assert.equal(digest(sql4),"61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c");
  const sql = (await readFile(new URL("lib/db/postgres/managed-project-core/0001_install.sql",rootPath),"utf8")).replaceAll("\r\n","\n");
  assert.equal(digest(sql),"c4e4bc131d2816e6107f0cff4033d8dc7b20825ccd56a6e40e8f6069f3546182");
  await admin.query("SET ROLE p102_migrate");
  try {
    await assert.rejects(admin.query(sql),{message:"PROJECT_CORE_INSTALL_TARGET"});
    await admin.query("ROLLBACK");
    await admin.query("SELECT set_config('dream.project_core.install_ref',$1,false)",[projectRef]);
    await assert.rejects(admin.query(sql),{message:"PROJECT_CORE_INSTALL_TARGET"});
    await admin.query("ROLLBACK");
    assert.equal((await admin.query(sql4)).at(-1).command,"COMMIT");
    if (draft) await draft.installPg17Draft({admin,rootPath});
    assert.equal((await admin.query(sql)).at(-1).command,"COMMIT");
    if (draft) await draft.installObservation({admin,rootPath});
  } finally { await admin.query("RESET ROLE"); }
  const {rows:[beforeLogin]}=await admin.query("SELECT rolcanlogin,rolsuper,rolinherit,rolbypassrls FROM pg_roles WHERE rolname=$1",[role]);
  assert.deepEqual(beforeLogin,{rolcanlogin:false,rolsuper:false,rolinherit:false,rolbypassrls:false});
  assert.match(password,/^[0-9a-f]{56}$/);
  await admin.query("ALTER ROLE "+role+" LOGIN PASSWORD '"+password+"'");
  await admin.query("INSERT INTO auth.users VALUES($1),($2),($3)",users.map(x=>x.id));
  const {good,foreign,expired} = draft ? await draft.reservedAssets({admin,connect,users}) : await (async()=>{
    await fixturePolicy(admin);
    return {good:await registeredImage(admin,users[0].id),foreign:await registeredImage(admin,users[1].id),
      expired:await registeredImage(admin,users[0].id,true)};
  })();

  const actors=users.map(user=>{
    const now=Math.floor(Date.now()/1000);
    const raw=base64({alg:"HS256",typ:"JWT"})+"."+base64({sub:user.id,iss:authOrigin+"/auth/v1",aud:"authenticated",role:"authenticated",
      email:user.email,iat:now,exp:now+900});
    const token=raw+"."+createHmac("sha256","p102-synthetic-only").update(raw).digest("base64url");
    return {user:{...user,aud:"authenticated",role:"authenticated"}, token,
      cookie:"sb-"+projectRef+"-auth-token=base64-"+base64({access_token:token,refresh_token:"synthetic",
        expires_at:now+900,expires_in:900,token_type:"bearer",user})};
  });
  const events=[];
  const authServer=createServer({cert,key:await readFile(key)},(req,res)=>{
    assert.equal(req.url,"/auth/v1/user");
    assert.equal(req.headers.apikey,publicKey);
    const actor=actors.find(value=>req.headers.authorization==="Bearer "+value.token);
    events.push({tls:req.socket.encrypted===true,found:!!actor});
    res.writeHead(actor?200:401,{"content-type":"application/json"});
    res.end(JSON.stringify(actor?.user??{message:"Synthetic unauthorized"}));
  });
  await new Promise((resolve,reject)=>authServer.once("error",reject).listen(0,loopback,resolve));
  const authPort=authServer.address().port;
  const repo=fileURLToPath(rootPath);
  const next=fileURLToPath(new URL("node_modules/next/dist/bin/next",rootPath));
  const transport=new URL("./managed-project-core-transport.mjs",import.meta.url).href;
  const baseEnv=Object.fromEntries(Object.entries(process.env).filter(([name])=>/^(path|systemroot|windir|temp|tmp|pathext|comspec|systemdrive|userprofile)$/i.test(name)));
  const projectPath="/api/projects";
  const briefPath=id=>projectPath+"/"+id+"/brief";
  const goodInputs = {title:"Synthetic product",goal:"Goal",target:"Audience",aspect:"9:16",lengthSec:30,
    productName:"Product",productAssets:[good],facts:"Fact",usageRights:"직접 촬영"};
  const command=inputs=>({menuId:"shopping-shorts",inputs:{...goodInputs,...inputs}});
  const ds="postgres://"+role+":"+password+"@"+dbHost+":5432/postgres";
  async function startProfile(profile, run) {
    const appPort=await freePort(), origin="http://"+loopback+":"+appPort;
    const env={...baseEnv,NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",VERCEL:"1",DREAM_AUTH_MODE:"supabase",DREAM_SITE_URL:origin,
      NEXT_PUBLIC_SUPABASE_URL:authOrigin,NEXT_PUBLIC_SUPABASE_ANON_KEY:publicKey,DREAM_ALLOWED_EMAILS:users.slice(0,2).map(x=>x.email).join(","),
      DREAM_PROJECT_CORE_BACKEND:"supabase-postgres",DREAM_PROJECT_CORE_DB_URL:ds,DREAM_PROJECT_CORE_DB_CA:cert,
      P102_SYNTHETIC_TRANSPORT:JSON.stringify({authOrigin,appOrigin:origin,dbHost,dbPort:port,authPort,cert:certPath})};
    for(const [name,val] of Object.entries(profile)) if(val===null)delete env[name]; else env[name]=val;
    const app=spawn(process.execPath,["--import",transport,next,"start","--hostname",loopback,"--port",String(appPort)],
      {cwd:repo,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let logs="";
    for(const stream of [app.stdout,app.stderr]) stream.on("data",bytes=>logs=(logs+bytes).slice(-10000));
    const ended=new Promise(resolve=>app.once("exit",resolve));
    const call=(path,{actor=0,input,raw,key=v7(),originOverride=origin}={})=>{
      const text=raw??(input===undefined?undefined:JSON.stringify(input));
      return fetch(origin+path,{method:text===undefined?"GET":"POST",headers:{origin:originOverride,"sec-fetch-site":"same-origin",
        "content-type":"application/json",...(actor!==null&&{cookie:actors[actor].cookie}),...(key&&{"idempotency-key":key})},
        body:text,signal:AbortSignal.timeout(14_000),redirect:"manual"});
    };
    try {
      let ready=false;
      for(let i=0;i<60;i++){
        assert.equal(app.exitCode,null,logs);
        if(await fetch(origin+projectPath,{signal:AbortSignal.timeout(900),redirect:"manual"}).then(async r=>{await r.body?.cancel();return true;},()=>false)){
          ready=true;break;
        }
        await delay(200);
      }
      assert(ready,"Synthetic Next server did not become ready");
      await run(call,origin);
    } finally {
      if(app.exitCode===null)app.kill();
      await ended;
    }
  }
  const body=async (request,status,label="")=>{
    const response=await request, text=await response.text();
    assert.equal(response.status,status,label+" "+text.slice(0,320));
    assert.match(response.headers.get("cache-control")??"",/no-store/);
    return JSON.parse(text);
  };
  const counts=async ()=>{
    const {rows:[row]}=await admin.query(`SELECT
      (SELECT count(*)::int FROM dream.projects) AS projects,
      (SELECT count(*)::int FROM dream.stage_states) AS stages,
      (SELECT count(*)::int FROM dream.activity_log) AS audit,
      (SELECT count(*)::int FROM dream.project_assets) AS links,
      (SELECT count(*)::int FROM dream_project_core.requests) AS receipts,
      (SELECT count(*)::int FROM dream.plans) AS plans,
      (SELECT count(*)::int FROM dream.scenes) AS scenes`);
    return row;
  };
  const noState = {projects:0,stages:0,audit:0,links:0,receipts:0,plans:0,scenes:0};
  const loseResponse=async (origin,path,key,input)=>{
    const payload=Buffer.from(JSON.stringify(input));
    await new Promise((resolve,reject)=>{
      const req=httpRequest(origin+path,{method:"POST",headers:{origin,cookie:actors[0].cookie,"sec-fetch-site":"same-origin",
        "content-type":"application/json","idempotency-key":key,"content-length":payload.length}},response=>{response.destroy();resolve();});
      req.once("error",reject);
      req.setTimeout(12_000,()=>req.destroy(new Error("Discarded response fixture timed out")));
      req.end(payload);
    });
  };
  const certPath=join(dirname(key),"server.crt");
  try {
    for (const profile of [
      {DREAM_PROJECT_CORE_BACKEND:null,DREAM_PROJECT_CORE_DB_URL:null},
      {DREAM_PROJECT_CORE_DB_URL:ds.replace(dbHost,"db.zzzzzzzzzzzzzzzzzzzz.supabase.co")},
      {DREAM_PROJECT_CORE_DB_CA:"invalid fixture CA"},
    ]) {
      await startProfile(profile,async call=>{
        await body(call(projectPath,{input:command()}),503);
        await body(call(briefPath(v7())),503);
        assert.deepEqual(await counts(),noState);
      });
    }
    let target, otherProject;
    await startProfile({},async (call,origin)=>{
      await body(call(projectPath,{actor:null,input:command()}),401);
      await body(call(projectPath,{actor:2,input:command()}),403);
      await body(call(projectPath,{input:command(),originOverride:"https://foreign.invalid"}),403);
      await body(call(projectPath,{input:command(),key:null}),400);
      await body(call(projectPath,{raw:" ".repeat(64*1024+1)}),413);
      await body(call(projectPath,{input:command({productAssets:[]})}),400);
      await body(call(projectPath,{input:command({productAssets:[foreign]})}),400);
      await body(call(projectPath,{input:command({productAssets:[expired]})}),400);
      await body(call(projectPath,{input:command({owner_id:users[1].id})}),400);
      assert.deepEqual(await counts(),noState);

      const createKey=v7(), input=command();
      const replies=await Promise.all([body(call(projectPath,{input,key:createKey}),201,"first create"),
        body(call(projectPath,{input,key:createKey}),201,"concurrent create")]);
      assert.deepEqual(replies[0],replies[1]);
      target=replies[0].id;
      assert.equal((await body(call(projectPath,{input:command({title:"Changed"}),key:createKey}),409)).code,"IDEMPOTENCY_CONFLICT");
      assert.deepEqual(await counts(),{...noState,projects:1,stages:7,audit:1,links:1,receipts:1});
      const list=await body(call(projectPath),200);
      assert.equal(list.length,1);
      assert.equal(list[0].id,target);
      assert.equal(list[0].nextStage,"brief");
      assert.deepEqual(await body(call(projectPath,{actor:1}),200),[]);
      assert.equal((await body(call(projectPath+"/"+target),200)).project.id,target);
      await body(call(projectPath+"/"+target,{actor:1}),404);
      await body(call(briefPath(target),{actor:1}),404);
      await body(call(briefPath(target),{actor:1,input:{acknowledged:true,revision:1}}),404);
      const initial=await body(call(briefPath(target)),200);
      assert.equal(initial.revision,1);
      assert.deepEqual(initial.stages,{intake:"approved",brief:"todo",plan:"locked"});
      await body(call(briefPath(target),{input:{acknowledged:true,revision:2}}),409);
      const brief={acknowledged:true,revision:1};
      const keys=[v7(),v7()];
      const pending=await Promise.all(keys.map(key=>call(briefPath(target),{input:brief,key})));
      assert.deepEqual(pending.map(resp=>resp.status).sort(),[200,409]);
      const successful=keys[pending.findIndex(resp=>resp.status===200)];
      for(const resp of pending)await resp.body?.cancel();
      assert.deepEqual(await body(call(briefPath(target),{input:brief,key:successful}),200),{stage:"plan",revision:1});
      assert.equal((await body(call(briefPath(target),{input:{...brief,revision:2},key:successful}),409)).code,"IDEMPOTENCY_CONFLICT");
      assert.deepEqual((await body(call(briefPath(target)),200)).stages,{intake:"approved",brief:"approved",plan:"todo"});
      assert.deepEqual(await counts(),{...noState,projects:1,stages:7,audit:2,links:1,receipts:2});

      const delayedCreate=v7();
      await loseResponse(origin,projectPath,delayedCreate,command({title:"Lost response project"}));
      const recovered=(await body(call(projectPath,{input:command({title:"Lost response project"}),key:delayedCreate}),201)).id;
      const delayedBrief=v7();
      await loseResponse(origin,briefPath(recovered),delayedBrief,brief);
      assert.deepEqual(await body(call(briefPath(recovered),{input:brief,key:delayedBrief}),200),{stage:"plan",revision:1});
      assert.deepEqual(await counts(),{...noState,projects:2,stages:14,audit:4,links:2,receipts:4});

      await admin.query("CREATE FUNCTION public.p102_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$; CREATE TRIGGER p102_fail BEFORE INSERT ON dream_project_core.requests FOR EACH ROW EXECUTE FUNCTION public.p102_fail()");
      const failedKey=v7(), before=await counts();
      await body(call(projectPath,{input:command(),key:failedKey}),503);
      assert.deepEqual(await counts(),before);
      await admin.query("DROP TRIGGER p102_fail ON dream_project_core.requests");
      const third=(await body(call(projectPath,{input:command(),key:failedKey}),201)).id;
      const beforeBrief=await counts();
      await admin.query("CREATE TRIGGER p102_fail BEFORE INSERT ON dream.activity_log FOR EACH ROW EXECUTE FUNCTION public.p102_fail()");
      const failedBrief=v7();
      await body(call(briefPath(third),{input:brief,key:failedBrief}),503);
      assert.deepEqual(await counts(),beforeBrief);
      assert.equal((await body(call(briefPath(third)),200)).stages.plan,"locked");
      await admin.query("DROP TRIGGER p102_fail ON dream.activity_log; DROP FUNCTION public.p102_fail()");
      await body(call(briefPath(third),{input:brief,key:failedBrief}),200);

      await admin.query("UPDATE dream_project_core.installation SET project_ref='zzzzzzzzzzzzzzzzzzzz'");
      await body(call(projectPath),503);
      await body(call(projectPath,{input:command()}),503);
      await admin.query("UPDATE dream_project_core.installation SET project_ref=$1",[projectRef]);
      assert.equal((await body(call(projectPath),200)).length,3);
      // Cross PostgreSQL's generic-plan threshold on reused connections.
      for (let i=0;i<8;i++){
        const repeated=(await body(call(projectPath,{input:command({title:"Repeated "+i})}),201,"reused create "+i)).id;
        await body(call(briefPath(repeated),{input:brief}),200,"reused brief "+i);
      }
      otherProject=(await body(call(projectPath,{actor:1,input:command({productAssets:[foreign]}),key:createKey}),201)).id;
      assert.notEqual(otherProject,target);
      assert.deepEqual((await body(call(projectPath,{actor:1}),200)).map(item=>item.id),[otherProject]);
      await body(call(projectPath+"/"+otherProject),404);
      await admin.query("UPDATE dream.projects SET archived_at=clock_timestamp() WHERE id=$1",[otherProject]);
      await body(call(briefPath(otherProject),{actor:1}),404);
      await body(call(briefPath(otherProject),{actor:1,input:brief}),404);
      assert.deepEqual(await body(call(projectPath,{actor:1}),200),[]);
    });

    const restricted=await connect(role);
    try{
      await restricted.query("BEGIN");
      await restricted.query("SELECT set_config('dream.actor_id',$1,true)",[users[1].id]);
      assert.equal((await restricted.query("SELECT id FROM dream.projects")).rowCount,0);
      assert.deepEqual((await restricted.query("SELECT project_id FROM dream_project_core.requests")).rows,[{project_id:otherProject}]);
      await assert.rejects(restricted.query("UPDATE dream.projects SET title='Forbidden' WHERE id=$1",[target]),{code:"42501"});
      await restricted.query("ROLLBACK");
      await assert.rejects(restricted.query("SELECT id FROM dream.scenes"),{code:"42501"});
      assert.equal((await restricted.query("SELECT job_id FROM dream.renders")).rowCount,0);
      assert.equal((await restricted.query("SELECT id FROM dream.plans")).rowCount,0);
      await assert.rejects(restricted.query("SELECT input_json FROM dream.renders"),{code:"42501"});
      await assert.rejects(restricted.query("SELECT script FROM dream.plans"),{code:"42501"});
      await assert.rejects(restricted.query("SET ROLE dream_api"),{code:"42501"});
    } finally { await restricted.end(); }
    assert(events.length>20&&events.every(event=>event.tls));
    assert.deepEqual(await counts(),{...noState,projects:12,stages:84,audit:23,links:12,receipts:23});
    console.log(JSON.stringify({next:"production-build",auth:"synthetic-https",authRequests:events.length,
      tls:"verified-pg17",badConfigurations:3,ownerIsolation:true,retryResponses:true,races:true,rollback:true,
      persisted:await counts(),rolePrivileges:true}));
    const verifyPlan = process.argv.includes("--plan-draft") || process.argv.includes("--plan-approval");
    const verifyChoices = process.argv.includes("--asset-choices");
    if (verifyPlan && verifyChoices) throw new Error("Run plan and asset choice verification separately so each uses a fresh database.");
    if (verifyPlan) {
      const {verifyPlanDrafts} = await import("./managed-plan-core-http.mjs");
      const context={admin,rootPath,projectRef,dbHost,cert,connect,users,startProfile,body,command,loseResponse};
      const draft=await verifyPlanDrafts(context);
      if (process.argv.includes("--plan-approval")) {
        const {verifyPlanApproval}=await import("./managed-plan-core-approval.mjs");
        await verifyPlanApproval(context,draft);
      }
      if (process.argv.includes("--scene-flow")) {
        if (!process.argv.includes("--plan-approval")) throw new Error("--scene-flow runs after --plan-approval.");
        const {verifySceneFlow}=await import("./managed-scene-flow-http.mjs");
        await verifySceneFlow({...context,port,loopback},draft);
      }
    }
    if (verifyChoices) {
      const {verifyAssetChoices}=await import("./managed-project-asset-choices-http.mjs");
      await verifyAssetChoices({admin,rootPath,projectRef,users,startProfile,body,command,counts,good,foreign,expired});
    }
    if (draft) await draft.verifyDraftChoices({admin,rootPath,projectRef,users,startProfile,body,good,foreign,expired});
  } finally { await new Promise(resolve=>authServer.close(resolve)); }
}
