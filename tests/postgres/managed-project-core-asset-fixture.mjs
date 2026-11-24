import { createHash } from "node:crypto";
import { v7 } from "uuid";

const sha = raw => createHash("sha256").update(raw).digest("hex");
const seal = (domain,raw) => sha(domain+":v1\n"+raw);
const policy = "p102-fixture", digest = "b".repeat(64), bytesHash = "a".repeat(64);
const worker = v7();

// Reuse the SQL4 state sequence from storage-verification-schema.test.ts.
// Only metadata for synthetic fixtures is created. No file provider is called.
export async function fixturePolicy(admin) {
  await admin.query("INSERT INTO dream.storage_policy_versions VALUES($1,1,$2,now())",[policy,digest]);
  await admin.query("INSERT INTO dream.storage_policies VALUES($1,1,$2,0,now())",[policy,digest]);
}

export async function registeredImage(admin,owner,expired=false) {
  return registeredAsset(admin,owner,"image",expired);
}

// P2 receipt boundary: the whole registration is recorded ahead of now, so verified_at is in the future.
export async function futureImage(admin,owner,aheadMs=600_000) {
  return registeredAsset(admin,owner,"image",{startMs:Date.now()+aheadMs});
}

// timing: false (valid now), true (expired), or {startMs} for an explicit registration start.
export async function registeredAsset(admin,owner,kind,timing=false) {
  const object=v7(),asset=v7(),intent=v7(),op=v7(),run=v7(),receipt=v7();
  const start=typeof timing==="object"&&timing?timing.startMs:Date.now()-(timing?180_000:10_000);
  const time = seconds=>new Date(start+seconds*1000).toISOString();
  const date = seconds=>start+seconds*1000;
  const media=kind==="video"?{extension:"mp4",mime:"video/mp4",durationMs:1200}:{extension:"png",mime:"image/png",durationMs:null};
  const bucket="p102-final", sourceBucket="p102-incoming";
  const key=owner+"/assets/"+asset+"/"+bytesHash+"."+media.extension, incoming=owner+"/incoming/"+intent+"/nonce";
  const identity={ownerId:owner,assetId:asset,bucket,key,sha256:bytesHash,sizeBytes:123,kind,mime:media.mime,providerVersion:null};
  const identityRaw=JSON.stringify(identity), identityDigest=seal("object-identity",identityRaw);
  const claim={workerId:worker,fence:1,claimedAt:date(0),leaseUntil:date(90),authorizationUntil:date(90),
    policyEpoch:1,policyDigest:digest,claimVerifiers:[worker]};
  const publication=JSON.stringify({operationId:op,fence:1,barrierFence:0,reservedAt:date(0),claim,identityDigest});
  const raw=JSON.stringify({id:receipt,objectId:object,identity,operationId:op,generation:1,fence:1,policyEpoch:1,policyDigest:digest,
    source:{bucket:sourceBucket,key:incoming,providerVersion:null},media:{width:2,height:2,durationMs:media.durationMs},
    verifiedAt:date(1),notAfter:date(80),verifierId:worker,verifierVersion:"fixture-v1",toolVersion:"fixture-probe"});
  const terminal=JSON.stringify({status:"succeeded",receiptId:receipt});
  const insert=async (relation,row) => {
    const keys=Object.keys(row);
    return admin.query("INSERT INTO dream."+relation+"("+keys.join(",")+") VALUES("+keys.map((_,i)=>"$"+(i+1)).join(",")+")",Object.values(row));
  };
  await insert("storage_objects",{owner_id:owner,id:object,reserved_asset_id:asset,lifecycle:"reserved",revision:0,barrier_fence:0,
    active_generation:0,created_at:time(0)});
  await insert("upload_intents",{owner_id:owner,id:intent,object_id:object,request_id:v7(),request_fingerprint:"c".repeat(64),
    request_json:"{}",request_raw_sha:sha("{}"),incoming_bucket:sourceBucket,incoming_key:incoming,max_bytes:1024,
    authorization_until:time(100),issue_envelope_until:time(10),max_issues:2,issue_count:0,status:"open",revision:0,created_at:time(0)});
  const transaction=async action=>{
    await admin.query("BEGIN");
    try { await action(); await admin.query("COMMIT"); }
    catch(error){await admin.query("ROLLBACK");throw error;}
  };
  await transaction(async()=>{
    await insert("storage_verification_operations",{owner_id:owner,id:op,object_id:object,intent_id:intent,kind:"initial",generation:1,
      request_fingerprint:"c".repeat(64),request_json:"{}",request_raw_sha:sha("{}"),policy_id:policy,policy_epoch:1,policy_digest:digest,
      authorization_until:time(90),expected_state_revision:0,fence:0,status:"pending",revision:0,created_at:time(0)});
    await admin.query("UPDATE dream.storage_objects SET active_generation=1,revision=revision+1 WHERE id=$1",[object]);
  });
  await transaction(async()=>{
    await admin.query("UPDATE dream.storage_verification_operations SET status='running',fence=1,worker_id=$2,claimed_at=$3,claim_verifiers=ARRAY[$2::uuid],lease_until=authorization_until,revision=revision+1 WHERE id=$1",[op,worker,time(0)]);
    await admin.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1",[object]);
  });
  await admin.query("UPDATE dream.storage_objects SET lifecycle='publication_reserved',bucket=$2,object_key=$3,kind=$8,mime=$9,sha256=$4,size_bytes=123,identity_json=$5,identity_digest=$6,publication_json=$7,revision=revision+1 WHERE id=$1",
    [object,bucket,key,bytesHash,identityRaw,identityDigest,publication,kind,media.mime]);
  await insert("assets",{owner_id:owner,id:asset,kind,title:"Synthetic",role:"original",file_path:key,mime:identity.mime,
    sha256:bytesHash,size_bytes:123,width:2,height:2,duration_ms:media.durationMs,origin:"upload",created_at:time(0)});
  await transaction(async()=>{
    await insert("storage_verification_runs",{owner_id:owner,id:run,object_id:object,operation_id:op,generation:1,fence:1,
      worker_id:worker,outcome:"succeeded",observed_json:"{}",observed_sha:sha("{}"),recorded_at:time(1)});
    await insert("storage_verification_receipts",{owner_id:owner,id:receipt,object_id:object,asset_id:asset,operation_id:op,run_id:run,
      generation:1,fence:1,identity_digest:identityDigest,policy_id:policy,policy_epoch:1,policy_digest:digest,source_bucket:sourceBucket,
      source_key:incoming,width:2,height:2,duration_ms:media.durationMs,verifier_id:worker,verifier_version:"fixture-v1",tool_version:"fixture-probe",verified_at:time(1),
      not_after:time(80),receipt_json:raw,receipt_digest:seal("verification-receipt",raw)});
    await admin.query("UPDATE dream.storage_verification_operations SET status='succeeded',terminal_receipt_id=$2,terminal_json=$3,terminal_digest=$4,completed_at=$5,completed_state_revision=1,completed_aggregate_revision=(SELECT revision+1 FROM dream.storage_objects WHERE id=$6),revision=revision+1 WHERE id=$1",
      [op,receipt,terminal,seal("verification-terminal",terminal),time(1),object]);
    await admin.query("UPDATE dream.storage_objects SET lifecycle='registered',registered_asset_id=reserved_asset_id,revision=revision+1 WHERE id=$1",[object]);
    await insert("asset_receipt_state",{owner_id:owner,asset_id:asset,object_id:object,current_receipt_id:receipt,status:"ready",revision:1,updated_at:time(1)});
  });
  return asset;
}

// P2 receipt boundary: a later reverify generation for a registered asset (same order as the SQL4 schema test R1 -> R2).
// It appends a new operation, run and receipt from the final object, then moves the receipt pointer forward. Older receipts stay.
export async function reverifyAsset(admin,asset) {
  const {rows:[o]}=await admin.query("SELECT owner_id,id,bucket,object_key,identity_json,identity_digest,active_generation::int AS generation FROM dream.storage_objects WHERE registered_asset_id=$1",[asset]);
  const {rows:[media]}=await admin.query("SELECT width,height,duration_ms FROM dream.assets WHERE id=$1",[asset]);
  const owner=o.owner_id,generation=o.generation+1,op=v7(),run=v7(),receipt=v7(),verifier=v7();
  const start=Date.now()-5_000;
  const time = seconds=>new Date(start+seconds*1000).toISOString();
  const date = seconds=>start+seconds*1000;
  const insert=async (relation,row) => {
    const keys=Object.keys(row);
    return admin.query("INSERT INTO dream."+relation+"("+keys.join(",")+") VALUES("+keys.map((_,i)=>"$"+(i+1)).join(",")+")",Object.values(row));
  };
  const transaction=async action=>{
    await admin.query("BEGIN");
    try { await action(); await admin.query("COMMIT"); }
    catch(error){await admin.query("ROLLBACK");throw error;}
  };
  await transaction(async()=>{
    await insert("storage_verification_operations",{owner_id:owner,id:op,object_id:o.id,intent_id:null,kind:"reverify",generation,
      request_fingerprint:"c".repeat(64),request_json:"{}",request_raw_sha:sha("{}"),policy_id:policy,policy_epoch:1,policy_digest:digest,
      authorization_until:time(200),expected_state_revision:generation-1,fence:0,status:"pending",revision:0,created_at:time(0)});
    await admin.query("UPDATE dream.storage_objects SET active_generation=$2,revision=revision+1 WHERE id=$1",[o.id,generation]);
  });
  await transaction(async()=>{
    await admin.query("UPDATE dream.storage_verification_operations SET status='running',fence=1,worker_id=$2,claimed_at=$3,claim_verifiers=ARRAY[$2::uuid],lease_until=authorization_until,revision=revision+1 WHERE id=$1",[op,verifier,time(0)]);
    await admin.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1",[o.id]);
  });
  // Domain columns read back as strings; the receipt JSON and its columns must carry the same numbers.
  const width=Number(media.width),height=Number(media.height),durationMs=media.duration_ms===null?null:Number(media.duration_ms);
  const raw=JSON.stringify({id:receipt,objectId:o.id,identity:JSON.parse(o.identity_json),operationId:op,generation,fence:1,policyEpoch:1,policyDigest:digest,
    source:{bucket:o.bucket,key:o.object_key,providerVersion:null},media:{width,height,durationMs},
    verifiedAt:date(1),notAfter:date(190),verifierId:verifier,verifierVersion:"fixture-v1",toolVersion:"fixture-probe"});
  const terminal=JSON.stringify({status:"succeeded",receiptId:receipt});
  await transaction(async()=>{
    await insert("storage_verification_runs",{owner_id:owner,id:run,object_id:o.id,operation_id:op,generation,fence:1,
      worker_id:verifier,outcome:"succeeded",observed_json:"{}",observed_sha:sha("{}"),recorded_at:time(1)});
    await insert("storage_verification_receipts",{owner_id:owner,id:receipt,object_id:o.id,asset_id:asset,operation_id:op,run_id:run,
      generation,fence:1,identity_digest:o.identity_digest,policy_id:policy,policy_epoch:1,policy_digest:digest,source_bucket:o.bucket,
      source_key:o.object_key,width,height,duration_ms:durationMs,verifier_id:verifier,verifier_version:"fixture-v1",tool_version:"fixture-probe",
      verified_at:time(1),not_after:time(190),receipt_json:raw,receipt_digest:seal("verification-receipt",raw)});
    await admin.query("UPDATE dream.storage_verification_operations SET status='succeeded',terminal_receipt_id=$2,terminal_json=$3,terminal_digest=$4,completed_at=$5,completed_state_revision=$6,completed_aggregate_revision=(SELECT revision+1 FROM dream.storage_objects WHERE id=$7),revision=revision+1 WHERE id=$1",
      [op,receipt,terminal,seal("verification-terminal",terminal),time(1),generation,o.id]);
    await admin.query("UPDATE dream.asset_receipt_state SET current_receipt_id=$2,revision=revision+1,updated_at=$3 WHERE object_id=$1",[o.id,receipt,time(1)]);
    await admin.query("UPDATE dream.storage_objects SET revision=revision+1 WHERE id=$1",[o.id]);
  });
  return {receipt,generation};
}
