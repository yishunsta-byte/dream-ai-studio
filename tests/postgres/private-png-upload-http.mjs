/* global Buffer, fetch, console */
import assert from "node:assert/strict";
import { v7 } from "uuid";

export async function verifyUpload({ origin, owner, other, png, fixture, admin, a }) {
  async function post(cookie, key, bytes, note = "", filename = "product.png") {
    const response = await fetch(origin + "/api/assets/upload?filename=" + encodeURIComponent(filename) + "&rightsNote=" + encodeURIComponent(note), {
      method: "POST", headers: { "content-type": "image/png", ...(cookie && { cookie }), ...(key && { "idempotency-key": key }) }, body: bytes,
    });
    return { status: response.status, body: await response.json() };
  }
  async function state(key) {
    const result = await admin.query(`SELECT o.lifecycle, o.reserved_asset_id AS asset, i.incoming_key AS incoming,
      EXISTS(SELECT 1 FROM dream.assets a WHERE a.id=o.reserved_asset_id AND a.owner_id=o.owner_id) AS registered,
      (SELECT count(*)::int FROM dream.storage_outbox q WHERE q.object_id=o.id AND q.status='pending') AS pending
      FROM dream.upload_intents i JOIN dream.storage_objects o ON o.id=i.object_id AND o.owner_id=i.owner_id
      WHERE i.owner_id=$1 AND i.request_id=$2`, [a.id, key]);
    return result.rows[0];
  }
  const key = v7();
  assert.equal((await post(null, key, png)).status, 401);
  assert.equal((await post(owner, null, png)).status, 400);
  assert.equal((await post(owner, key, Buffer.alloc(1024*1024+1))).status, 413);
  assert.equal(await state(key), undefined);
  const note = "직접 촬영 / 출처 + 크레디트";
  assert.equal((await post(owner,key,png,"x".repeat(501))).status,400);
  assert.equal((await post(owner,key,png,"bad\0note")).status,400);
  assert.equal(await state(key),undefined);
  fixture.loseFinalPut();
  assert.equal((await post(owner,key,png,note)).status, 503);
  fixture.rejectNextDelete();
  assert.equal((await post(owner,key,png,note)).status, 503);
  const staged = await state(key);
  assert.equal(staged.registered,true);
  assert.ok(fixture.objects.get("/t367-incoming/" + staged.incoming).bytes);
  assert.equal((await post(owner,key,png,note,"renamed.png")).status,409);
  const first = await post(owner,key,png,"  " + note + "  ","C:\\local\\product.png");
  assert.deepEqual(first,{ status:201, body:{ id:staged.asset } });
  assert.deepEqual(await post(owner,key,png,note),first);
  assert.equal((await post(owner,key,png,"Changed")).status,409);
  assert.equal((await post(owner,key,png)).status,409);
  const readNote = async id => (await admin.query("SELECT rights_note FROM dream.assets WHERE id=$1",[id])).rows[0].rights_note;
  assert.equal(await readNote(first.body.id),note);
  const { rows: [file] } = await admin.query("SELECT title,file_path FROM dream.assets WHERE id=$1",[first.body.id]);
  assert.equal(file.title,"product.png");
  assert.ok(!file.file_path.includes(file.title));
  assert.equal((await post(owner,v7(),png,"","x".repeat(256))).status,400);
  assert.equal((await state(key)).pending,0);
  assert.equal(fixture.objects.get("/t367-incoming/" + staged.incoming).bytes,undefined);
  const garbage = Buffer.from("invalid PNG");
  assert.equal((await post(owner,key,garbage,note)).status,409);
  const second = await post(other,key,png);
  assert.equal(second.status,201);
  assert.notEqual(second.body.id,first.body.id);
  assert.equal(await readNote(second.body.id),null);

  const invalid = v7();
  fixture.rejectNextDelete();
  assert.equal((await post(owner,invalid,garbage)).status,503);
  assert.equal((await post(owner,invalid,garbage)).status,409);
  const cleaned = await state(invalid);
  assert.equal(cleaned.lifecycle,"tombstoned");
  assert.equal(cleaned.registered,false);
  assert.equal(cleaned.pending,0);
  assert.equal(fixture.objects.get("/t367-incoming/" + cleaned.incoming).bytes,undefined);
  assert.equal((await post(owner,v7(),garbage)).status,400);
  console.log("Private PNG HTTP upload, lost publication, registered and rejected staging cleanup, owner-scoped retry passed");
  return { ownerImage: first.body.id, otherImage: second.body.id };
}
