/* global AbortSignal, URL, console, fetch, process */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { v7 } from "uuid";

export async function enableOwnedReadTls(admin, cfg, root) {
  const { rows: [identity] } = await admin.query("SELECT current_database() AS db, inet_server_addr()::text AS host, inet_server_port() AS port");
  assert.deepEqual(identity,{db:"dream_test_t367",host:"127.0.0.1/32",port:cfg.port});
  const cert = join(root,"server.crt"), key = join(root,"server.key"), config = join(root,"openssl.cnf");
  await writeFile(config,"[req]\ndistinguished_name=dn\n[dn]\n");
  await promisify(execFile)(join(process.env.ProgramFiles,"Git","usr","bin","openssl.exe"),
    ["req","-x509","-newkey","rsa:2048","-noenc","-days","1","-config",config,"-subj","/CN=Owned test PG",
      "-addext","subjectAltName=IP:127.0.0.1","-keyout",key,"-out",cert], {windowsHide:true});
  for (const [name,value] of [["ssl_cert_file",cert],["ssl_key_file",key],["ssl","on"]]) {
    const { rows: [setting] } = await admin.query("SELECT quote_literal($1::text) AS value",[value.replaceAll("\\","/")]);
    await admin.query("ALTER SYSTEM SET " + name + " = " + setting.value);
  }
  await admin.query("SELECT pg_reload_conf()");
  const target = new URL("postgres://127.0.0.1:" + cfg.port + "/dream_test_t367");
  target.username = "t367_legacy";
  target.password = cfg.password;
  return { DATABASE_URL: target.href, NODE_EXTRA_CA_CERTS:cert };
}

export async function verifyReopen({origin, post, owner, unrelated, asset, inputs, admin, firstOwner}) {
  const key = v7(), body = {menuId:"shopping-shorts",inputs:inputs(asset,"Reopen saved shopping short")};
  const first = await post(owner,key,body);
  assert.equal(first.status,201);
  assert.deepEqual(await post(owner,key,body),first);
  const id = first.body.id;
  const list = "/api/projects", detail = list + "/" + id;
  async function get(path, cookie, status) {
    const result = await fetch(origin+path,{ headers:cookie?{cookie}:{},redirect:"manual",signal:AbortSignal.timeout(60000) });
    assert.equal(result.status,status,path);
    assert.equal(result.headers.get("cache-control"),"no-store");
    return result.json();
  }
  const rows = await get(list,owner,200);
  assert.equal(rows.filter(item=>item.id===id).length,1);
  const saved = await get(detail,owner,200);
  assert.equal(saved.project.id,id);
  assert.equal(saved.project.title,body.inputs.title);
  assert.deepEqual(saved.inputs.productAssets,[asset]);
  assert.equal(saved.states.length,7);
  assert.ok(!(await get(list,unrelated,200)).some(item=>item.id===id));
  assert.equal((await get(detail,unrelated,404)).code,"NOT_FOUND");
  assert.equal((await get(detail,firstOwner,404)).code,"NOT_FOUND");
  const tls = await admin.query(`SELECT s.ssl FROM pg_stat_ssl s JOIN pg_stat_activity a USING(pid)
    WHERE a.usename='t367_legacy' AND a.application_name='dream-backend'`);
  assert.ok(tls.rows.length && tls.rows.every(row=>row.ssl));
  await get(list,null,401);
  await get(detail,null,401);
  console.log("PG17 TLS verified: saved project reopens over real authenticated list/detail HTTP; unrelated and anonymous requests isolated");
}
