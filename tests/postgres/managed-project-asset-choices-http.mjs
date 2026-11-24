/* global console, URL */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { v7 } from "uuid";
import { futureImage, registeredImage, registeredAsset, reverifyAsset } from "./managed-project-core-asset-fixture.mjs";

const path="/api/projects/asset-choices";

export async function verifyAssetChoices({admin,rootPath,projectRef,users,startProfile,body,command,counts,good,foreign,expired}) {
  await startProfile({},async call=>{
    const failure=await body(call(path),503);
    assert.equal(failure.code,"PROJECT_CORE_UNAVAILABLE");
    assert.equal((await body(call("/api/projects"),200)).length,11);
  });
  await startProfile({DREAM_PROJECT_CORE_BACKEND:null},async call=>{
    assert.equal((await body(call(path),503)).code,"PROJECT_CORE_UNAVAILABLE");
  });

  const sql=await readFile(new URL("lib/db/postgres/managed-project-core/0002_asset_choices.sql",rootPath),"utf8");
  await admin.query("SET ROLE p102_migrate");
  try{
    await admin.query("SELECT set_config('dream.project_core.install_ref',$1,false)",["zzzzzzzzzzzzzzzzzzzz"]);
    await assert.rejects(admin.query(sql),{message:"PROJECT_ASSET_CHOICES_INSTALL_TARGET"});
    await admin.query("ROLLBACK");
    await admin.query("SELECT set_config('dream.project_core.install_ref',$1,false)",[projectRef]);
    assert.equal((await admin.query(sql)).at(-1).command,"COMMIT");
  } finally {await admin.query("RESET ROLE");}

  const owner=users[0].id, video=await registeredAsset(admin,owner,"video");
  const archived=await registeredImage(admin,owner);
  await admin.query("UPDATE dream.assets SET archived_at=clock_timestamp() WHERE id=$1",[archived]);
  const own=[good,video];
  for(let i=0;i<100;i++) own.push(await registeredImage(admin,owner));

  const {rows:[acl]}=await admin.query(`SELECT
    has_column_privilege('dream_project_core_app','dream.assets','title','SELECT') AS title,
    has_table_privilege('dream_project_core_app','dream.assets','SELECT') AS whole_table,
    has_column_privilege('dream_project_core_app','dream.assets','source_url','SELECT') AS source_url,
    (SELECT count(*)::int FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','authenticator')
      AND (has_schema_privilege(r.oid,'dream','USAGE') OR has_column_privilege(r.oid,'dream.assets','title','SELECT'))) AS browser_grants`);
  assert.deepEqual(acl,{title:true,whole_table:false,source_url:false,browser_grants:0});

  const before=await counts();
  await startProfile({},async call=>{
    await body(call(path,{actor:null}),401);
    await body(call(path,{actor:2}),403);
    await body(call(path+"?cursor=bad"),400);
    await body(call(path+"?cursor="+v7()+"&cursor="+v7()),400);
    assert.deepEqual(await body(call(path,{actor:1}),200),{assets:[{id:foreign,title:"Synthetic",kind:"image"}]});
    const first=await body(call(path+"?ownerId="+users[1].id),200);
    assert.equal(first.assets.length,100);
    assert.equal(first.nextCursor,first.assets.at(-1).id);
    const second=await body(call(path+"?cursor="+first.nextCursor),200);
    assert.equal(second.assets.length,2);
    assert.equal(Object.hasOwn(second,"nextCursor"),false);
    const combined=[...first.assets,...second.assets];
    assert.deepEqual(combined.map(x=>x.id),own.toSorted().reverse());
    assert.equal(new Set(combined.map(x=>x.id)).size,102);
    assert(!combined.some(row=>[foreign,expired,archived].includes(row.id)));
    assert.deepEqual(combined.find(x=>x.id===video),{id:video,title:"Synthetic",kind:"video"});
    assert(combined.every(row=>Object.keys(row).sort().join(",")==="id,kind,title"));
    assert.deepEqual(await body(call(path+"?cursor=00000000-0000-7000-8000-000000000000"),200),{assets:[]});

    assert.deepEqual(await counts(),before);
    const selected=combined.find(x=>x.kind==="image").id;
    await admin.query("UPDATE dream.assets SET archived_at=clock_timestamp() WHERE id=$1",[selected]);
    await body(call("/api/projects",{input:command({productAssets:[selected]})}),400);
    assert.deepEqual(await counts(),before);
    const followup=await body(call("/api/projects",{input:command({productAssets:[video]})}),201);
    const {rows:[created]}=await admin.query("SELECT asset_id FROM dream.project_assets WHERE project_id=$1",[followup.id]);
    assert.equal(created.asset_id,video);
  });
  console.log(JSON.stringify({assetChoices:true,ownerScope:true,roles:acl,pageSizes:[100,2],expiredAndArchivedHidden:true,
    failedClosedWithoutGrant:true,immutableRead:true,selectedVideoValidatedOnPost:true,staleSelectionDenied:true}));
  // P2 receipt boundaries reuse the installed grant: future/expired hidden and rejected, reverify restores selection.
  await verifyReceiptBoundaries({admin,users,startProfile,body,command,counts});
}

// P2-MANAGED-ASSET-RECEIPT-PG17-REGRESSION: receipt time boundaries on the real asset choice and project create routes.
async function verifyReceiptBoundaries({admin,users,startProfile,body,command,counts}) {
  const owner=users[0].id, other=users[1].id;
  const future=await futureImage(admin,owner);
  const expired=await registeredImage(admin,owner,true);
  const foreignExpired=await registeredImage(admin,other,true);
  const receipts=async asset=>(await admin.query(
    "SELECT id,generation::int,receipt_json,receipt_digest,verified_at,not_after FROM dream.storage_verification_receipts WHERE asset_id=$1 ORDER BY generation",[asset])).rows;
  const original=await receipts(expired);
  assert.equal(original.length,1);

  const choices=async (call,actor)=>{
    const ids=[];
    let cursor;
    do {
      const page=await body(call(path+(cursor?"?cursor="+cursor:""),{actor}),200);
      ids.push(...page.assets.map(row=>row.id));
      cursor=page.nextCursor;
    } while (cursor);
    return ids;
  };
  const created=async id=>(await admin.query("SELECT asset_id FROM dream.project_assets WHERE project_id=$1",[id])).rows.map(row=>row.asset_id);

  let reverified;
  await startProfile({},async call=>{
    // Future and expired receipts are neither offered nor accepted, and a rejected create writes nothing.
    const before=await counts();
    const own=await choices(call,0);
    assert(!own.includes(future)&&!own.includes(expired)&&!own.includes(foreignExpired));
    await body(call("/api/projects",{input:command({productAssets:[future]})}),400,"future receipt create");
    await body(call("/api/projects",{input:command({productAssets:[expired]})}),400,"expired receipt create");
    assert.deepEqual(await counts(),before);

    // A second-generation reverify makes the same owner's asset selectable and creatable again.
    reverified=await reverifyAsset(admin,expired);
    assert.equal(reverified.generation,2);
    await reverifyAsset(admin,foreignExpired);
    const again=await choices(call,0);
    assert(again.includes(expired));
    assert(!again.includes(future)&&!again.includes(foreignExpired));
    assert((await choices(call,1)).includes(foreignExpired));
    assert(!(await choices(call,1)).includes(expired));
    const project=(await body(call("/api/projects",{input:command({productAssets:[expired]})}),201,"reverified create")).id;
    assert.deepEqual(await created(project),[expired]);
    const after=await counts();
    assert.deepEqual(after,{...before,projects:before.projects+1,stages:before.stages+7,audit:before.audit+1,links:before.links+1,receipts:before.receipts+1});

    // Another owner's freshly reverified asset still cannot be used, and the future receipt is still excluded.
    await body(call("/api/projects",{input:command({productAssets:[foreignExpired]})}),400,"foreign reverified create");
    await body(call("/api/projects",{input:command({productAssets:[future]})}),400,"future receipt create after reverify");
    assert.deepEqual(await counts(),after);
  });

  // The first receipt is kept byte for byte; the pointer moved to generation 2.
  const history=await receipts(expired);
  assert.deepEqual(history.map(row=>row.generation),[1,2]);
  assert.deepEqual(history[0],original[0]);
  assert.equal(history[1].id,reverified.receipt);
  const {rows:[pointer]}=await admin.query("SELECT current_receipt_id FROM dream.asset_receipt_state WHERE asset_id=$1",[expired]);
  assert.equal(pointer.current_receipt_id,reverified.receipt);
  const {rows:[futureReceipt]}=await admin.query(
    "SELECT r.verified_at>clock_timestamp() AS ahead FROM dream.asset_receipt_state s JOIN dream.storage_verification_receipts r ON r.id=s.current_receipt_id WHERE s.asset_id=$1",[future]);
  assert.equal(futureReceipt.ahead,true);
  console.log(JSON.stringify({receiptBoundaries:true,futureHiddenAndRejected:true,expiredHiddenAndRejected:true,
    reverifiedSelectableAndCreated:true,firstReceiptKept:true,receiptGenerations:history.map(row=>row.generation),foreignStillBlocked:true}));
}
