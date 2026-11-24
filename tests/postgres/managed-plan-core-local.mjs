/* global AbortSignal, Buffer, console, fetch, process, URL */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { v7 } from "uuid";
import { approvalCommand, route, samplePlan } from "./managed-plan-core-http.mjs";

export async function verifyLocalPlan({admin,rootPath,password,port,loopback,freePort}) {
  const repo=fileURLToPath(rootPath);
  const git=process.platform==="win32"?"C:/Program Files/Git/cmd/git.exe":"git";
  const storage=await readFile(new URL("lib/db/postgres/0004_storage_verification.sql",rootPath),"utf8");
  assert.equal((await admin.query(storage)).at(-1).command,"COMMIT");
  await admin.query("SELECT set_config('dream.t367_owned','on',false)");
  for(const file of ["local.sql","plan-materials.sql"]){
    const spec="0219470769910df658ba5a874840a41b400eeaf4:lib/db/postgres/local-project-brief/"+file;
    const sql=execFileSync(git,["show",spec],{cwd:repo,encoding:"utf8",windowsHide:true});
    assert.equal((await admin.query(sql)).at(-1).command,"COMMIT");
  }
  assert.match(password,/^[a-f0-9]{56}$/);
  await admin.query("CREATE ROLE local_project_brief_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '"+password+"'; "+
    "GRANT local_project_brief TO local_project_brief_login WITH INHERIT FALSE, SET TRUE");
  const user={id:"10000000-0000-4000-8000-000000000108",email:"p108-local@example.invalid",role:"authenticated",aud:"authenticated"};
  await admin.query("INSERT INTO auth.users VALUES($1)",[user.id]);
  const menus=JSON.parse(await readFile(new URL("docs/spec/menus.json",rootPath),"utf8"));
  const menu=menus.menus.find(menu=>menu.id==="shopping-shorts");
  const snapshot=JSON.stringify({schemaVersion:menus.schemaVersion,templateVersion:menus.templateVersion,stages:menus.stages,
    commonInputs:menus.commonInputs,commonReview:menus.commonReview,conditionalReview:menus.conditionalReview,menu});
  const id=v7();
  await admin.query(`INSERT INTO dream.projects(owner_id,id,menu_id,template_version,template_snapshot_json,inputs_json,
    title,goal,target,aspect,length_sec,created_at,updated_at)
    VALUES($1,$2,'shopping-shorts',$3,$4,'{}','Local fixture','Goal','Audience','9:16',17,now(),now())`,[user.id,id,menus.templateVersion,snapshot]);
  await admin.query(`INSERT INTO dream.stage_states(owner_id,project_id,stage,status)
    SELECT $1,$2,s,CASE WHEN s IN ('intake','brief') THEN 'approved' WHEN s='plan' THEN 'todo' ELSE 'locked' END
    FROM unnest(ARRAY['intake','brief','plan','produce','edit','review','export']) s`,[user.id,id]);
  const tokenHead=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  let token;
  const publicKey="sb_publishable_p108_local_fixture_only";
  const auth=createServer((req,res)=>{
    const verified=req.url==="/auth/v1/user"&&req.headers.apikey===publicKey&&req.headers.authorization==="Bearer "+token;
    res.writeHead(verified?200:401,{"content-type":"application/json"});
    res.end(JSON.stringify(verified?user:{message:"Synthetic unauthenticated"}));
  });
  await new Promise((resolve,reject)=>auth.once("error",reject).listen(0,loopback,resolve));
  const authOrigin="http://"+loopback+":"+auth.address().port;
  const now=Math.floor(Date.now()/1000);
  const raw=tokenHead({alg:"HS256",typ:"JWT"})+"."+tokenHead({sub:user.id,iss:authOrigin+"/auth/v1",aud:"authenticated",
    role:"authenticated",email:user.email,iat:now,exp:now+900});
  token=raw+"."+createHmac("sha256","local-p108-fixture").update(raw).digest("base64url");
  const cookie="sb-127-auth-token=base64-"+tokenHead({access_token:token,refresh_token:"fixture",token_type:"bearer",
    expires_at:now+900,expires_in:900,user});
  const appPort=await freePort(), origin="http://"+loopback+":"+appPort;
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|windir|temp|tmp|pathext|comspec|systemdrive|userprofile)$/i.test(key)));
  Object.assign(env,{NODE_ENV:"development",NEXT_TELEMETRY_DISABLED:"1",DREAM_SITE_URL:origin,
    DREAM_AUTH_MODE:"supabase",NEXT_PUBLIC_SUPABASE_URL:authOrigin,NEXT_PUBLIC_SUPABASE_ANON_KEY:publicKey,DREAM_ALLOWED_EMAILS:user.email,
    DREAM_PRIVATE_UPLOAD_BACKEND:"owned-pg17",DREAM_PROJECT_CREATE_BACKEND:"owned-pg17",
    DREAM_OWNED_CREATE_PG_PORT:String(port),DREAM_OWNED_CREATE_PG_PASSWORD:password});
  const nextTypes=new URL("next-env.d.ts",rootPath);
  const beforeTypes=await readFile(nextTypes);
  const app=spawn(process.execPath,[fileURLToPath(new URL("node_modules/next/dist/bin/next",rootPath)),"dev","--webpack",
    "--hostname",loopback,"--port",String(appPort)],{cwd:repo,env,stdio:["ignore","pipe","pipe"],windowsHide:true});
  let logs="";
  for(const stream of [app.stdout,app.stderr]) stream.on("data",data=>logs=(logs+data).slice(-7000));
  const ended=new Promise(resolve=>app.once("exit",resolve));
  try {
    const call=async (expected,input)=>{
      const response=await fetch(origin+route(id),{headers:{cookie,origin,"content-type":"application/json","sec-fetch-site":"same-origin"},
        method:input?"POST":"GET",body:input?JSON.stringify(input):undefined,signal:AbortSignal.timeout(30_000)});
      const value=await response.json();
      assert.equal(response.status,expected,JSON.stringify(value)+" "+logs);
      return value;
    };
    let ready=false;
    for(let i=0;i<45;i++){
      assert.equal(app.exitCode,null,logs);
      const started=await fetch(origin+route(id),{signal:AbortSignal.timeout(5000)}).then(async r=>{await r.body?.cancel();return true;},()=>false);
      if(started){ready=true;break;}
      await delay(200);
    }
    assert(ready,logs);
    const first=await call(200);
    assert.equal(first.version,0);
    const plan=await call(201,{revision:first.revision,version:0,...samplePlan()});
    assert.equal((await call(200)).canApprove,true);
    await call(409,{revision:first.revision,version:0,...samplePlan()});
    const approved=await call(200,approvalCommand(plan));
    assert.equal(approved.approved,true);
    assert.deepEqual((await call(200)).materials,plan.materials);
    const {rows:[state]}=await admin.query("SELECT (SELECT count(*)::int FROM dream.scenes WHERE project_id=$1) AS scenes, "+
      "(SELECT count(*)::int FROM dream.activity_log WHERE project_id=$1 AND actor='local-user') AS audit",[id]);
    assert.deepEqual(state,{scenes:3,audit:2});
    console.log(JSON.stringify({stage:"owned-local-plan",save:true,approval:true,revConflict:true,...state}));
  } finally {
    if(app.exitCode===null)app.kill();
    await ended;
    await new Promise(resolve=>auth.close(resolve));
    const afterTypes=await readFile(nextTypes);
    if (!beforeTypes.equals(afterTypes)) {
      assert.equal(afterTypes.toString().replaceAll("\r\n","\n").replaceAll("./.next/dev/types/","./.next/types/"),
        beforeTypes.toString().replaceAll("\r\n","\n"),"Unexpected Next type declaration change");
      await writeFile(nextTypes,beforeTypes);
    }
  }
}
