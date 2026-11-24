/* global Buffer, URL, fetch, console */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {v7} from "uuid";

export async function installOwnedWav(admin,cfg) {
  await admin.query(await readFile(new URL("../../lib/db/postgres/private-wav-upload/local.sql",import.meta.url),"utf8"));
  const {rows:[quoted]}=await admin.query("SELECT quote_literal($1::text) AS value",[cfg.password]);
  await admin.query("CREATE ROLE local_wav_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD "+quoted.value);
  await admin.query("GRANT local_wav TO local_wav_login WITH INHERIT FALSE, SET TRUE");
}

export async function verifyOwnedWav({origin,owner,other,admin,post,inputs}) {
  const wav=Buffer.alloc(44+1600);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length-8,4); wav.write("WAVEfmt ",8);
  wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34);
  wav.write("data",36); wav.writeUInt32LE(1600,40);
  for(let i=0;i<800;i++) wav.writeInt16LE(Math.round(8000*Math.sin(2*Math.PI*440*i/8000)),44+i*2);
  const key=v7(),note="직접 만든 시험 음원";
  async function upload(cookie,body=wav,rights=note,requestId=key) {
    const response=await fetch(origin+"/api/assets/upload?format=wav&filename=track.wav&rightsNote="+encodeURIComponent(rights),{
      method:"POST",headers:{"content-type":"audio/wav","idempotency-key":requestId,...(cookie&&{cookie})},body});
    return {status:response.status,body:await response.json()};
  }
  assert.equal((await upload(null)).status,401);
  const invalid=Buffer.from(wav); invalid.writeUInt32LE(20000,40);
  assert.equal((await upload(owner,invalid)).status,400);
  assert.equal((await upload(owner,Buffer.alloc(1024*1024+1))).status,413);
  const interrupted = v7();
  await admin.query("CREATE FUNCTION local_wav.test_fail_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$");
  await admin.query("CREATE TRIGGER test_wav_failure BEFORE INSERT ON dream.assets FOR EACH ROW WHEN (NEW.kind='audio') EXECUTE FUNCTION local_wav.test_fail_asset()");
  try { assert.equal((await upload(owner,wav,note,interrupted)).status,503); }
  finally { await admin.query("DROP TRIGGER test_wav_failure ON dream.assets; DROP FUNCTION local_wav.test_fail_asset()"); }
  assert.equal((await admin.query("SELECT count(*)::integer AS n FROM local_wav.files WHERE request_id=$1",[interrupted])).rows[0].n,0);
  assert.equal((await upload(owner,wav,note,interrupted)).status,201);
  const [first,replay]=await Promise.all([upload(owner),upload(owner)]);
  assert.equal(first.status,201,JSON.stringify(first.body)); assert.deepEqual(first,replay);
  assert.equal((await upload(owner,wav,"changed")).status,409);
  const changed=Buffer.from(wav); changed[44]^=1;
  assert.equal((await upload(owner,changed)).status,409);
  const otherFile=await upload(other);
  assert.equal(otherFile.status,201); assert.notEqual(otherFile.body.id,first.body.id);
  const {rows:[row]}=await admin.query("SELECT kind,mime,title,rights_note,duration_ms,width,height FROM dream.assets WHERE id=$1",[first.body.id]);
  assert.deepEqual(row,{kind:"audio",mime:"audio/wav",title:"track.wav",rights_note:note,duration_ms:"100",width:null,height:null});
  const resource=origin+"/api/assets/"+first.body.id+"?format=wav";
  const own=await fetch(resource,{headers:{cookie:owner}});
  assert.equal(own.status,200); assert.deepEqual(Buffer.from(await own.arrayBuffer()),wav);
  const partial=await fetch(resource,{headers:{cookie:owner,range:"bytes=44-51"}});
  assert.equal(partial.status,206); assert.deepEqual(Buffer.from(await partial.arrayBuffer()),wav.subarray(44,52));
  const last = wav.length - 1;
  for (const range of ["bytes=-8", `bytes=${last - 7}-`, `bytes=${last - 7}-${last + 10}`]) {
    const tail = await fetch(resource, {headers:{cookie:owner,range}});
    assert.equal(tail.status,206,range);
    assert.equal(tail.headers.get("content-range"),`bytes ${last - 7}-${last}/${wav.length}`);
    const declaredLength = tail.headers.get("content-length");
    if (declaredLength !== null && !tail.headers.has("content-encoding")) assert.equal(declaredLength,"8");
    assert.equal(tail.headers.get("cache-control"),"private, no-store");
    assert.deepEqual(Buffer.from(await tail.arrayBuffer()),wav.subarray(-8));
  }
  const beyond = await fetch(resource,{headers:{cookie:owner,range:`bytes=${wav.length}-`}});
  assert.equal(beyond.status,416);
  assert.equal(beyond.headers.get("content-range"),`bytes */${wav.length}`);
  assert.equal((await beyond.arrayBuffer()).byteLength,0);
  assert.equal((await fetch(resource,{headers:{cookie:other}})).status,404);
  assert.equal((await fetch(resource,{redirect:"manual"})).status,401);
  assert.equal((await post(owner,v7(),{menuId:"shopping-shorts",inputs:inputs(first.body.id)})).status,400);
  console.log("WAV private registration, duration, rights, concurrent replay, read/range and account isolation passed");
}
