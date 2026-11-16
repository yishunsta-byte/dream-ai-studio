// Fixed virtual backup s4: archived-copy check (A1), regeneration check (P_REGEN), privacy scan and
// format comparison with the real backup job. `S4_WRITE=1 npx vitest run tests/s4-fixture.test.ts`
// creates the fixture once; it refuses to replace an existing s4.zip (add s5 for a new structure).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openPromise } from "yauzl";
vi.mock("server-only",()=>({}));
import { openDatabase } from "@/lib/db/connection";
import { productMigrations } from "@/lib/db/migrate";
import { fileDigest } from "@/lib/export/zip";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { backupService, runClaimedBackup } from "@/lib/services/backups";
import { jobsService } from "@/lib/services/jobs";
import { assembleS4Zip, buildS4Runtime, exportBundleBytes, S4_EXPORT_INPUT, S4_GENERATOR_VERSION, S4_RECORD, S4_ZIP, s4Ids } from "./fixtures/backups/s4-build";
import { checkInputs, inputsDigest, logicalHash, P_REGEN, schemaHash, snapshotDb } from "./fixtures/backups/s4-compare";

type S4Record={fixture:string;generatorVersion:number;zip:{sha256:string;sizeBytes:number};manifest:{schemaVersion:number;appVersion:string;backupId:string;createdAt:string;inventorySha256:string;fileCount:number;files:{path:string;sha256:string;sizeBytes:number}[]};migrations:{version:number;name:string;sha256:string}[];logical:{profile:"P_REGEN";all:string;tables:Record<string,string>};journal:{version:number;appliedAt:string}[];schema:string;inputs:{count:number;sha256:string};inputFiles:Record<string,{sha256:string;sizeBytes:number}>;environment:Record<string,string>};
let root:string;
beforeEach(async()=>{root=await realpath(await mkdtemp(join(tmpdir(),"dream-s4-")));});
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});});
async function extractDb(zip:string,into:string){const manifest=await readBackupManifest(zip);await verifyBackupArchive(zip,manifest,into);return {manifest,db:join(into,"data/app.db")};}
function describeDb(path:string){const handle=openDatabase(path,{readonly:true,fileMustExist:true});try{const snap=snapshotDb(handle.sqlite);return {snap,logical:logicalHash(snap,P_REGEN),schema:schemaHash(handle.sqlite),journal:(handle.sqlite.prepare("SELECT version,applied_at FROM __schema_migrations ORDER BY version").all() as {version:number;applied_at:string}[]).map(row=>({version:row.version,appliedAt:row.applied_at}))};}finally{handle.close();}}
async function generate(into:string,write=false){const runtime=join(into,"runtime"),bytes=await exportBundleBytes(write);await buildS4Runtime(runtime,bytes);const out=join(into,"s4.zip");const manifest=await assembleS4Zip(runtime,join(into,"work"),out);return {runtime,out,manifest,bytes};}

describe.runIf(process.env.S4_WRITE==="1")("s4 생성 (한 번만)",()=>{
 it("s4.zip과 기록 파일을 새로 만든다 (있으면 거부)",async()=>{
  if(existsSync(S4_ZIP)||existsSync(S4_RECORD))throw new Error("s4가 이미 있어요. 고정 백업은 덮어쓰지 않아요. 새 구조는 s5로 추가해 주세요.");
  const {out,manifest}=await generate(root,true);const described=describeDb((await extractDb(out,join(root,"check"))).db);
  writeFileSync(S4_ZIP,readFileSync(out),{flag:"wx"});const zip=await fileDigest(S4_ZIP),input=await fileDigest(S4_EXPORT_INPUT),handle=openDatabase(":memory:");let sqliteVersion:string;try{sqliteVersion=(handle.sqlite.prepare("SELECT sqlite_version() AS v").get() as {v:string}).v;}finally{handle.close();}
  const record:S4Record={fixture:"s4",generatorVersion:S4_GENERATOR_VERSION,zip,manifest:{schemaVersion:manifest.schemaVersion,appVersion:manifest.appVersion,backupId:manifest.backupId,createdAt:manifest.createdAt,inventorySha256:manifest.inventorySha256,fileCount:manifest.files.length+1,files:manifest.files},migrations:manifest.migrations,logical:{profile:"P_REGEN",...described.logical},journal:described.journal,schema:described.schema,inputs:{count:Object.keys(await import("./fixtures/backups/s4-build").then(module=>module.S4_INPUTS)).length,sha256:inputsDigest()},inputFiles:{"export-r4.zip":input},environment:{betterSqlite3:"13.2.0",sqlite:sqliteVersion,zipStream:"7.0.5",node:process.versions.node}};
  writeFileSync(S4_RECORD,`${JSON.stringify(record,null,2)}\n`,{flag:"wx"});
 },60000);
});

describe.skipIf(process.env.S4_WRITE==="1")("고정 백업 s4",()=>{
 const record=()=>JSON.parse(readFileSync(S4_RECORD,"utf8")) as S4Record;
 it("A1 보관 원본: ZIP 해시·manifest·마이그레이션 4줄이 기록과 같다",async()=>{
  const expected=record();expect(await fileDigest(S4_ZIP)).toEqual(expected.zip);
  const manifest=await readBackupManifest(S4_ZIP);expect(manifest).toMatchObject({schemaVersion:1,appVersion:"0.1.0",backupId:expected.manifest.backupId,createdAt:expected.manifest.createdAt,inventorySha256:expected.manifest.inventorySha256});expect(manifest.files).toEqual(expected.manifest.files);
  expect(manifest.migrations).toEqual(productMigrations().map(({version,name,sha256})=>({version,name,sha256})));expect(manifest.migrations.map(row=>row.sha256)).toEqual(["ee96edd4ecfed0d1c707f0efaa922c421c533cd6562d9b887f3b213c0ca31fa0","6d7b88304f9c2416d544b7f678ae7054a22d072bd8ad95c51a71d9cd5c1420ed","9782fed4c886a4ee37954bf6c1945d165e240b1e8509732e48b704449c409c1e","6ff0cacf3edbc1b0c0911803f38ce01e39ede50a4f7357c2fe779472f91863c3"]);
  const described=describeDb((await extractDb(S4_ZIP,join(root,"a1"))).db);expect(described.logical).toEqual({all:expected.logical.all,tables:expected.logical.tables});expect(described.schema).toBe(expected.schema);expect(described.journal).toEqual(expected.journal);expect(checkInputs(described.snap,s4Ids())).toEqual([]);
  expect(await fileDigest(S4_EXPORT_INPUT)).toEqual(expected.inputFiles["export-r4.zip"]);const bundle=manifest.files.find(file=>file.path.endsWith(`${s4Ids().e4}.zip`))!;expect({sha256:bundle.sha256,sizeBytes:bundle.sizeBytes}).toEqual(expected.inputFiles["export-r4.zip"]);
 });
 it("P_REGEN 재현: 다시 만들면 저장 파일·인벤토리·마이그레이션·논리 내용·스키마가 기록과 같다 (ZIP·DB 바이트는 대상 아님)",async()=>{
  const expected=record(),before=await fileDigest(S4_ZIP);const {out,manifest}=await generate(root);
  expect(manifest.files).toEqual(expected.manifest.files);expect(manifest.inventorySha256).toBe(expected.manifest.inventorySha256);expect(manifest.migrations).toEqual(expected.migrations);
  const described=describeDb((await extractDb(out,join(root,"regen"))).db);expect(described.logical).toEqual({all:expected.logical.all,tables:expected.logical.tables});expect(described.schema).toBe(expected.schema);
  expect(described.journal.map(row=>row.version)).toEqual([1,2,3,4]);for(const row of described.journal)expect(Date.parse(row.appliedAt)).not.toBeNaN();
  expect(inputsDigest()).toBe(expected.inputs.sha256);expect(await fileDigest(S4_ZIP)).toEqual(before);
 },60000);
 it("개인 경로·사용자 이름이 DB 글자·manifest·항목 이름 어디에도 없다",async()=>{
  const {manifest,db}=await extractDb(S4_ZIP,join(root,"privacy"));const name=userInfo().username;const needles=[await realpath(tmpdir()),tmpdir(),"\\Users\\","/Users/","AppData","/home/",...(name.length>=3?[name]:[])].map(value=>value.toLowerCase());
  const texts:string[]=[JSON.stringify(manifest)];const handle=openDatabase(db,{readonly:true,fileMustExist:true});try{for(const table of snapshotDb(handle.sqlite).values())for(const row of table.rows.values())for(const cell of Object.values(row))if(cell&&"t" in cell)texts.push(cell.t);}finally{handle.close();}
  const zip=await openPromise(S4_ZIP,{lazyEntries:true,autoClose:false});try{for await(const entry of zip.eachEntry())texts.push(entry.fileName);}finally{zip.close();}
  expect(texts.filter(value=>needles.some(needle=>value.toLowerCase().includes(needle)))).toEqual([]);
 });
 it("형식 대조: 실제 백업 작업이 만든 ZIP과 항목 순서·저장 방식·manifest 키가 같다",async()=>{
  const runtime=join(root,"runtime");await buildS4Runtime(runtime,await exportBundleBytes(false));await mkdir(join(runtime,"backups"));vi.stubEnv("DREAM_DATA_ROOT",runtime);
  const handle=openDatabase(join(runtime,"data/app.db"),{fileMustExist:true});let real:string;
  try{handle.sqlite.exec("UPDATE jobs SET status='canceled',lease_until=NULL WHERE status IN ('queued','running')");handle.sqlite.prepare("UPDATE settings SET value_json=? WHERE key='backup.directory'").run(JSON.stringify(join(runtime,"backups")));
   const time=Date.parse("2026-11-16T03:00:00Z"),now=()=>time;const request=backupService(handle,now).request()!;const claimed=jobsService(handle,now).claim()!;expect(claimed.refId).toBe(request.id);await runClaimedBackup(handle,claimed,now);real=(handle.sqlite.prepare("SELECT path FROM backups WHERE id=?").get(request.id) as {path:string}).path;}finally{handle.close();}
  const shape=async(path:string)=>{const zip=await openPromise(path,{lazyEntries:true,autoClose:false});const entries:{name:string;method:number}[]=[];try{for await(const entry of zip.eachEntry())entries.push({name:entry.fileName,method:entry.compressionMethod});}finally{zip.close();}const manifest=await readBackupManifest(path);return {entries:entries.map(entry=>({kind:entry.name==="data/app.db"?"db":entry.name==="backup-manifest.json"?"manifest":entry.name.replace(/[0-9a-f-]{36}/g,"<id>"),method:entry.method})),keys:Object.keys(manifest),database:Object.keys(manifest.database),schemaVersion:manifest.schemaVersion,appVersion:manifest.appVersion,fileKeys:Object.keys(manifest.files[0])};};
  const ours=await shape(S4_ZIP),theirs=await shape(real);expect(ours).toEqual(theirs);expect(ours.entries.every(entry=>entry.method===0)).toBe(true);
  expect((await readdir(join(runtime,"backups"))).filter(name=>name.startsWith(".dream-backup-"))).toEqual([]);
 },60000);
});
