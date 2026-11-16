// Fixed virtual backup s4 (K-6 ⑧, T-034). Test-side only: it runs under vitest with `server-only`
// mocked, writes only into the temporary root it is given, and never opens real data.
// IDs and times come from labels; user-entered strings come from S4_INPUTS; file bytes are constants.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { openDatabase } from "@/lib/db/connection";
import { migrateDatabase, type Migration } from "@/lib/db/migrate";
import { fileDigest, writeArchive, writeZip } from "@/lib/export/zip";
import type { BundleManifest } from "@/lib/export/schema";
import { inventoryHash, storageInventory } from "@/lib/backup/archive";
import { APP_VERSION, backupManifestSchema, backupOriginKey, type BackupManifest } from "@/lib/backup/schema";

export const S4_DIR=fileURLToPath(new URL(".",import.meta.url));
export const S4_ZIP=join(S4_DIR,"s4.zip"),S4_RECORD=join(S4_DIR,"s4.json"),S4_EXPORT_INPUT=join(S4_DIR,"s4-inputs","export-r4.zip");
export const S4_GENERATOR_VERSION=1;
const BASE=Date.parse("2026-01-05T00:00:00.000Z");
export const at=(sec:number)=>new Date(BASE+sec*1000).toISOString();
// UUIDv7 layout: 48-bit time from the label's offset, the rest from sha256("dream-s4:"+label).
export function labelId(label:string,sec:number){const ts=(BASE+sec*1000).toString(16).padStart(12,"0"),h=createHash("sha256").update(`dream-s4:${label}`).digest("hex");return `${ts.slice(0,8)}-${ts.slice(8,12)}-7${h.slice(0,3)}-${(8|(parseInt(h[3],16)&3)).toString(16)}${h.slice(4,7)}-${h.slice(7,19)}`;}

// User-entered values. Never normalized: NFC and NFD stay different, CRLF stays CRLF.
export const S4_INPUTS={
  projectTitle:"[가상] 텀블러 소개 🧋 “따옴표” \\ 역슬래시",
  goal:"가상 제품의 장점을 30초로 소개해요",
  target:"짧은 제품 영상을 보는 사람(가상)",
  productName:"가상 텀블러 S4",
  nfc:"한글 정규화".normalize("NFC"),
  nfd:"한글 정규화".normalize("NFD"),
  emoji:"👩‍👩‍👧 ZWJ 가족 · 🇰🇷 국기",
  script:"첫 줄\r\n둘째 줄\n\t탭 들여쓰기  끝 공백  ",
  dialogue:"<script>alert(1)</script> & \"인용\" 'single'",
  jsonish:"{\"key\": [1, 2]} \u2028 줄 구분 \u0007 벨",
  reviewNote:"보류: 효능 표현을 다시 확인해야 해요 (가상)",
  rightsNote:"직접 촬영한 가상 사진 · 사용 허락 있음",
  subtitle1:"  자막 하나 (0.125초 시작)  ",
  subtitle2:"자막 둘 — 2.5초",
  longTitle:"가".repeat(120),
  emptyDialogue:"",
} as const;
export type S4InputKey=keyof typeof S4_INPUTS;

const png=(b64:string)=>Buffer.from(b64,"base64");
export const S4_FILES={
  upload1:png("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQI12N4FuUGRAwQCgAtNgYZ2DSFcAAAAABJRU5ErkJggg=="),
  upload2:png("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQI12PQqDgBRAwQCgAk7gWhOu5PvwAAAABJRU5ErkJggg=="),
  result1:png("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQI12OIWhUFRAwQCgAmVgV5bH6ERwAAAABJRU5ErkJggg=="),
  result2:png("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQI12P4cMIGiBggFAA5jgfRv7nuTAAAAABJRU5ErkJggg=="),
  result3:png("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQI12OYFrAFiBggFAAsbgZpKdjQOQAAAABJRU5ErkJggg=="),
  archivedText:Buffer.from("보관한 가상 메모\n","utf8"),
};
const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const VIRTUAL_ROOT="C:\\dream-s4";

export function s4Ids(){return {
  main:labelId("project.main",10),draft:labelId("project.draft",20),archived:labelId("project.archived",30),
  plan1:labelId("plan.main.v1",40),plan2:labelId("plan.main.v2",50),plan3:labelId("plan.main.v3",60),
  char1:labelId("character.1",70),
  up1:labelId("asset.upload.1",80),up2:labelId("asset.upload.2",90),link:labelId("asset.link",100),archivedAsset:labelId("asset.archived",110),
  s1:labelId("scene.main.1",120),s2:labelId("scene.main.2",130),s3:labelId("scene.main.3",140),s4:labelId("scene.main.4",150),
  j11:labelId("job.s1.v1",200),j12:labelId("job.s1.v2",210),j13:labelId("job.s1.v3",220),j21:labelId("job.s2.v1",230),j22:labelId("job.s2.v2",240),j23:labelId("job.s2.v3",250),j31:labelId("job.s3.v1",260),
  g11:labelId("generation.s1.v1",300),g12:labelId("generation.s1.v2",310),g13:labelId("generation.s1.v3",320),g21:labelId("generation.s2.v1",330),g31:labelId("generation.s3.v1",340),
  r1:labelId("asset.result.s1.v1",400),r2:labelId("asset.result.s1.v3",410),r3:labelId("asset.result.s2.v1",420),
  v11:labelId("version.s1.v1",500),v12:labelId("version.s1.v2",510),v13:labelId("version.s1.v3",520),v21:labelId("version.s2.v1",530),v22:labelId("version.s2.v2",540),v23:labelId("version.s2.v3",550),v31:labelId("version.s3.v1",560),
  rv1:labelId("review.r4.1",600),rv2:labelId("review.r4.2",610),rv3:labelId("review.r5.hold",620),rv4:labelId("review.r5.unchecked",630),
  e4:labelId("export.r4",700),e5:labelId("export.r5.failed",710),eRun:labelId("export.r5.running",720),eCan:labelId("export.r5.canceled",730),
  je4:labelId("job.export.r4",740),je5:labelId("job.export.r5.failed",750),jeRun:labelId("job.export.r5.running",760),jeCan:labelId("job.export.r5.canceled",770),
  b0:labelId("backup.b0",800),jb0:labelId("job.backup.b0",810),backup:labelId("backup.s4",900),jBackup:labelId("job.backup.s4",910),
  edit1:labelId("edit.main.1",820),edit2:labelId("edit.main.2",830),layer1:labelId("layer.disclosure",840),layer2:labelId("layer.subtitle.1",841),layer3:labelId("layer.subtitle.2",842),
  check:labelId("restore.check.virtual",850),
  act1:labelId("activity.1",860),act2:labelId("activity.2",861),act3:labelId("activity.3",862),act4:labelId("activity.4",863),act5:labelId("activity.5",864),
};}
export type S4Ids=ReturnType<typeof s4Ids>;
const TEMPLATE={menuId:"shopping-shorts",label:"쇼핑숏츠",templateVersion:"s4-fixture",note:"고정 가상 스냅샷"};

function insert(sqlite:Database.Database,table:string,row:Record<string,unknown>){const keys=Object.keys(row);sqlite.prepare(`INSERT INTO "${table}" (${keys.map(key=>`"${key}"`).join(",")}) VALUES (${keys.map(()=>"?").join(",")})`).run(...keys.map(key=>{const value=row[key];return typeof value==="boolean"?(value?1:0):value;}));}
const json=(value:unknown)=>JSON.stringify(value);

// The r4 bundle ZIP: made once by writeZip (only when the input file is missing), then copied byte for byte.
export async function exportBundleBytes(write:boolean){
  try{return readFileSync(S4_EXPORT_INPUT);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT"||!write)throw error;}
  const ids=s4Ids();mkdirSync(join(S4_DIR,"s4-inputs"),{recursive:true});
  await writeZip(S4_EXPORT_INPUT,[{path:"scenes/01.png",bytes:S4_FILES.result1},{path:"scenes/02.png",bytes:S4_FILES.result3}],exportManifest(ids));
  return readFileSync(S4_EXPORT_INPUT);
}
export function exportManifest(ids:S4Ids):BundleManifest{return {manifestVersion:1,project:{id:ids.main,title:S4_INPUTS.projectTitle,aspect:"9:16",lengthSec:30},menu:{id:"shopping-shorts",label:"쇼핑숏츠"},templateVersion:"s4-fixture",contentRevision:4,planId:ids.plan2,exportedAt:at(735),isMock:true,kind:"editing-bundle",files:[{path:"scenes/01.png",sha256:sha(S4_FILES.result1),sizeBytes:S4_FILES.result1.length,mime:"image/png",sceneId:ids.s1,versionId:ids.v11,width:2,height:2},{path:"scenes/02.png",sha256:sha(S4_FILES.result3),sizeBytes:S4_FILES.result3.length,mime:"image/png",sceneId:ids.s2,versionId:ids.v21,width:2,height:2}]};}

// Builds data/app.db and storage/ under `runtime` with the product migrations 1–4.
export async function buildS4Runtime(runtime:string,exportBytes:Buffer,migrations?:readonly Migration[]){
  const ids=s4Ids(),I=S4_INPUTS;
  for(const path of ["data","storage/library",`storage/projects/${ids.main}/scenes`,`storage/projects/${ids.main}/exports`])await mkdir(join(runtime,path),{recursive:true});
  const files:Record<string,Buffer>={[`library/${ids.up1}.png`]:S4_FILES.upload1,[`library/${ids.up2}.png`]:S4_FILES.upload2,[`library/${ids.archivedAsset}.txt`]:S4_FILES.archivedText,[`projects/${ids.main}/scenes/${ids.r1}.png`]:S4_FILES.result1,[`projects/${ids.main}/scenes/${ids.r2}.png`]:S4_FILES.result2,[`projects/${ids.main}/scenes/${ids.r3}.png`]:S4_FILES.result3,[`projects/${ids.main}/exports/${ids.e4}.zip`]:exportBytes};
  for(const [path,bytes] of Object.entries(files))writeFileSync(join(runtime,"storage",path),bytes,{flag:"wx"});
  const handle=openDatabase(join(runtime,"data/app.db"));const sqlite=handle.sqlite;
  try{
    migrateDatabase(sqlite,{migrations});
    sqlite.transaction(()=>{
      const project=(id:string,title:string,revision:number,sec:number,extra:Record<string,unknown>={})=>insert(sqlite,"projects",{id,menu_id:"shopping-shorts",template_version:"s4-fixture",template_snapshot_json:json(TEMPLATE),inputs_json:json({title,goal:I.goal,target:I.target,aspect:"9:16",lengthSec:30,isAd:true,productName:I.productName,facts:I.jsonish,usageRights:I.rightsNote,nfc:I.nfc,nfd:I.nfd,emoji:I.emoji}),title,goal:I.goal,target:I.target,aspect:"9:16",length_sec:30,content_revision:revision,created_at:at(sec),updated_at:at(sec+5),...extra});
      project(ids.main,I.projectTitle,5,10);project(ids.draft,I.nfd,1,20);project(ids.archived,I.longTitle,1,30,{archived_at:at(35)});
      const sceneSnapshot=[{title:"장면 1",dialogue:I.dialogue},{title:"장면 2",dialogue:I.emptyDialogue}];
      insert(sqlite,"plans",{id:ids.plan1,project_id:ids.main,version:1,steps_json:json([{step:"hook",text:I.emoji}]),script:I.script,status:"approved",approved_scene_snapshot_json:json(sceneSnapshot.slice(0,1)),approved_at:at(42),created_at:at(40)});
      insert(sqlite,"plans",{id:ids.plan2,project_id:ids.main,version:2,steps_json:json([{step:"hook",text:I.emoji},{step:"cta",text:I.jsonish}]),script:I.script,status:"approved",approved_scene_snapshot_json:json(sceneSnapshot),approved_at:at(52),created_at:at(50)});
      insert(sqlite,"plans",{id:ids.plan3,project_id:ids.main,version:3,steps_json:json([]),script:`${I.script}\n(초안)`,status:"draft",created_at:at(60)});
      sqlite.prepare("UPDATE projects SET approved_plan_id=? WHERE id=?").run(ids.plan2,ids.main);
      const stages=["intake","brief","plan","produce","edit","review","export"];
      const mainStatus=["approved","approved","approved","approved","approved","in_progress","todo"];
      stages.forEach((stage,index)=>{insert(sqlite,"stage_states",{project_id:ids.main,stage,status:mainStatus[index],approved_plan_id:index>=2&&index<=4?ids.plan2:null,approved_revision:index<=4?(index<2?1:2):null,approved_at:index<=4?at(52+index):null,note:index===5?I.reviewNote:null});insert(sqlite,"stage_states",{project_id:ids.draft,stage,status:index===0?"todo":"locked"});insert(sqlite,"stage_states",{project_id:ids.archived,stage,status:index===0?"approved":"locked",approved_revision:index===0?0:null,approved_at:index===0?at(31):null});});
      insert(sqlite,"assets",{id:ids.up1,kind:"image",title:"가상 제품 사진 1",rights_note:I.rightsNote,role:"original",file_path:`library/${ids.up1}.png`,mime:"image/png",size_bytes:S4_FILES.upload1.length,sha256:sha(S4_FILES.upload1),width:2,height:2,origin:"upload",is_mock:0,created_at:at(80)});
      insert(sqlite,"assets",{id:ids.up2,kind:"image",title:I.nfc,rights_note:I.rightsNote,role:"original",file_path:`library/${ids.up2}.png`,mime:"image/png",size_bytes:S4_FILES.upload2.length,sha256:sha(S4_FILES.upload2),width:2,height:2,origin:"upload",is_mock:0,created_at:at(90)});
      insert(sqlite,"assets",{id:ids.link,kind:"link",title:"가상 참고 링크",source_url:"https://example.invalid/s4/reference",rights_note:"링크만 저장",role:"original",origin:"link",is_mock:0,created_at:at(100)});
      insert(sqlite,"assets",{id:ids.archivedAsset,kind:"text",title:"보관한 메모",role:"original",file_path:`library/${ids.archivedAsset}.txt`,mime:"text/plain",size_bytes:S4_FILES.archivedText.length,sha256:sha(S4_FILES.archivedText),origin:"upload",is_mock:0,archived_at:at(115),created_at:at(110)});
      insert(sqlite,"characters",{id:ids.char1,name:"가상 진행자",description:I.emoji,locked_json:json({face:"고정",outfit:"파란 앞치마"}),ref_asset_ids_json:json([ids.up1,ids.up2]),voice_profile_json:json({voice:"mock-ko-1",speed:1.05}),status:"confirmed",created_at:at(70)});
      insert(sqlite,"project_characters",{project_id:ids.main,character_id:ids.char1});
      for(const [asset,purpose] of [[ids.up1,"product"],[ids.up2,"product"],[ids.link,"reference"]] as const)insert(sqlite,"project_assets",{project_id:ids.main,asset_id:asset,purpose});
      const scene=(id:string,position:number,title:string,dialogue:string,extra:Record<string,unknown>={})=>insert(sqlite,"scenes",{id,project_id:ids.main,position,title,description:I.jsonish,dialogue_json:json([{speaker:"내레이션",text:dialogue}]),character_ids_json:json(position===1?[ids.char1]:[]),duration_sec:3,...extra});
      scene(ids.s1,1,"장면 1",I.dialogue);scene(ids.s2,2,"장면 2",I.emptyDialogue,{needs_recheck:1});scene(ids.s3,3,"장면 3",I.nfd);scene(ids.s4,4,"보관한 장면",I.emoji,{archived_at:at(155)});
      const job=(id:string,label:string,sec:number,row:Record<string,unknown>)=>insert(sqlite,"jobs",{id,kind:"image",payload_version:1,input_snapshot_json:json({label}),project_id:ids.main,ref_type:"scene",provider:"mock",idempotency_key:`s4:${label}`,attempts:1,max_attempts:3,created_at:at(sec),updated_at:at(sec+3),...row});
      job(ids.j11,"s1.v1",200,{status:"succeeded",ref_id:ids.s1,finished_at:at(204)});
      job(ids.j12,"s1.v2",210,{status:"failed",ref_id:ids.s1,error_code:"CONTENT_REJECTED",error_message:"제공사가 이 장면을 만들 수 없다고 했어요.",finished_at:at(214)});
      job(ids.j13,"s1.v3",220,{status:"succeeded",ref_id:ids.s1,finished_at:at(224)});
      job(ids.j21,"s2.v1",230,{status:"succeeded",ref_id:ids.s2,finished_at:at(234)});
      job(ids.j22,"s2.v2",240,{status:"canceled",ref_id:ids.s2,cancel_requested_at:at(242),finished_at:at(243)});
      job(ids.j23,"s2.v3",250,{status:"queued",ref_id:ids.s2,error_code:"PROVIDER_TIMEOUT",error_message:"잠시 뒤 다시 시도해요.",next_run_at:at(1000)});
      job(ids.j31,"s3.v1",260,{kind:"speech",status:"running",ref_id:ids.s3,provider_job_id:"mock-s4-running",lease_until:at(1000),heartbeat_at:at(265),next_run_at:at(260)});
      const generation=(id:string,jobId:string,sec:number,row:Record<string,unknown>)=>insert(sqlite,"generations",{id,job_id:jobId,provider:"mock",model:"mock-image-1",params_json:json({aspect:"9:16",prompt:I.dialogue}),reference_snapshot_json:json([{assetId:ids.up1,sha256:sha(S4_FILES.upload1)}]),seed:42,cost_estimate_micros:0,currency:"USD",started_at:at(sec),...row});
      generation(ids.g11,ids.j11,201,{settlement:"settled",cost_actual_micros:0,finished_at:at(203)});
      generation(ids.g12,ids.j12,211,{settlement:"refunded",finished_at:at(213)});
      generation(ids.g13,ids.j13,221,{settlement:"settled",cost_actual_micros:0,finished_at:at(223)});
      generation(ids.g21,ids.j21,231,{settlement:"settled",cost_actual_micros:0,finished_at:at(233)});
      generation(ids.g31,ids.j31,261,{model:"mock-speech-1",settlement:"reserved"});
      const result=(id:string,generationId:string,bytes:Buffer,sec:number)=>insert(sqlite,"assets",{id,kind:"image",title:"[샘플] 생성 결과",role:"intermediate",file_path:`projects/${ids.main}/scenes/${id}.png`,mime:"image/png",size_bytes:bytes.length,sha256:sha(bytes),width:2,height:2,origin:"generated",generation_id:generationId,is_mock:1,created_at:at(sec)});
      result(ids.r1,ids.g11,S4_FILES.result1,400);result(ids.r2,ids.g13,S4_FILES.result2,410);result(ids.r3,ids.g21,S4_FILES.result3,420);
      const version=(id:string,sceneId:string,number:number,sec:number,row:Record<string,unknown>)=>insert(sqlite,"scene_versions",{id,scene_id:sceneId,version:number,plan_id:ids.plan2,kind:"image",input_snapshot_json:json({prompt:I.dialogue,revision:number}),created_at:at(sec),...row});
      version(ids.v11,ids.s1,1,500,{status:"succeeded",job_id:ids.j11,generation_id:ids.g11,result_asset_id:ids.r1});
      version(ids.v12,ids.s1,2,510,{status:"failed",job_id:ids.j12,generation_id:ids.g12});
      version(ids.v13,ids.s1,3,520,{status:"succeeded",job_id:ids.j13,generation_id:ids.g13,result_asset_id:ids.r2});
      version(ids.v21,ids.s2,1,530,{status:"succeeded",job_id:ids.j21,generation_id:ids.g21,result_asset_id:ids.r3});
      version(ids.v22,ids.s2,2,540,{status:"canceled",job_id:ids.j22});
      version(ids.v23,ids.s2,3,550,{status:"queued",job_id:ids.j23});
      version(ids.v31,ids.s3,1,560,{kind:"speech",status:"running",job_id:ids.j31,generation_id:ids.g31});
      sqlite.prepare("UPDATE scenes SET selected_version_id=? WHERE id=?").run(ids.v11,ids.s1);sqlite.prepare("UPDATE scenes SET selected_version_id=? WHERE id=?").run(ids.v21,ids.s2);
      const review=(id:string,revision:number,item:string,status:string,note:string|null,sec:number)=>insert(sqlite,"review_items",{id,project_id:ids.main,content_revision:revision,template_item_id:item,label:`가상 검수 ${item}`,source:item.startsWith("menu")?"menu":"common",required:1,status,note,checked_at:status==="unchecked"?null:at(sec)});
      review(ids.rv1,4,"common.rights","pass",null,600);review(ids.rv2,4,"menu.disclosure","pass",null,610);review(ids.rv3,5,"common.rights","hold",I.reviewNote,620);review(ids.rv4,5,"menu.disclosure","unchecked",null,630);
      const exportJob=(id:string,exportId:string,label:string,sec:number,row:Record<string,unknown>)=>insert(sqlite,"jobs",{id,kind:"export",payload_version:1,input_snapshot_json:json({schemaVersion:1,projectId:ids.main,exportId}),project_id:ids.main,ref_type:"export",ref_id:exportId,provider:"local",idempotency_key:`s4:${label}`,attempts:1,max_attempts:3,created_at:at(sec),updated_at:at(sec+3),...row});
      insert(sqlite,"exports",{id:ids.e4,project_id:ids.main,content_revision:4,status:"succeeded",file_path:`projects/${ids.main}/exports/${ids.e4}.zip`,manifest_version:1,manifest_json:json(exportManifest(ids)),sha256:sha(exportBytes),created_at:at(700),completed_at:at(735)});
      insert(sqlite,"exports",{id:ids.e5,project_id:ids.main,content_revision:5,status:"failed",error:"STORAGE_FAILED",created_at:at(710)});
      insert(sqlite,"exports",{id:ids.eRun,project_id:ids.main,content_revision:5,status:"running",created_at:at(720)});
      insert(sqlite,"exports",{id:ids.eCan,project_id:ids.main,content_revision:5,status:"failed",error:"CANCELED",created_at:at(730)});
      exportJob(ids.je4,ids.e4,"export.r4",740,{status:"succeeded",finished_at:at(745)});
      exportJob(ids.je5,ids.e5,"export.r5.failed",750,{status:"failed",error_code:"STORAGE_FAILED",error_message:"저장 공간을 확인해 주세요.",finished_at:at(755)});
      exportJob(ids.jeRun,ids.eRun,"export.r5.running",760,{status:"running",lease_until:at(1000),heartbeat_at:at(765),next_run_at:at(760)});
      exportJob(ids.jeCan,ids.eCan,"export.r5.canceled",770,{status:"canceled",cancel_requested_at:at(771),finished_at:at(772)});
      insert(sqlite,"backups",{id:ids.b0,kind:"manual",path:`${VIRTUAL_ROOT}\\backups\\${ids.b0}.zip`,db_sha256:sha(Buffer.from("s4-b0-db")),file_inventory_sha256:sha(Buffer.from("s4-b0-inventory")),status:"succeeded",created_at:at(800)});
      insert(sqlite,"jobs",{id:ids.jb0,kind:"backup",payload_version:1,input_snapshot_json:json({schemaVersion:1,backupId:ids.b0,kind:"manual"}),ref_type:"backup",ref_id:ids.b0,provider:"local",idempotency_key:`backup:manual:${ids.b0}`,status:"succeeded",attempts:1,max_attempts:3,created_at:at(810),updated_at:at(815),finished_at:at(815)});
      insert(sqlite,"backups",{id:ids.backup,kind:"manual",path:`${VIRTUAL_ROOT}\\backups\\${ids.backup}.zip`,status:"running",created_at:at(900)});
      insert(sqlite,"jobs",{id:ids.jBackup,kind:"backup",payload_version:1,input_snapshot_json:json({schemaVersion:1,backupId:ids.backup,kind:"manual"}),ref_type:"backup",ref_id:ids.backup,provider:"local",idempotency_key:`backup:manual:${ids.backup}`,status:"running",attempts:1,max_attempts:3,next_run_at:at(910),lease_until:at(1000),heartbeat_at:at(915),created_at:at(910),updated_at:at(915)});
      const layer=(id:string,kind:string,content:string,start:number,end:number,locked:boolean)=>({id,kind,content,fontFamily:"Pretendard",fontSize:kind==="disclosure"?28:40,color:"#FFFFFF",position:kind==="disclosure"?"top":"bottom",startSec:start,endSec:end,locked});
      const setting=(key:string,value:unknown)=>insert(sqlite,"settings",{key,value_json:json(value)});
      setting(`project.${ids.main}.edit.${ids.edit1}`,{sceneOrder:[ids.s1,ids.s2],layers:[layer(ids.layer1,"disclosure","광고",0,30,true)],schema_version:1,content_revision:3,created_at:at(820)});
      setting(`project.${ids.main}.edit.${ids.edit2}`,{sceneOrder:[ids.s1,ids.s2,ids.s3],layers:[layer(ids.layer1,"disclosure","광고",0,30,true),layer(ids.layer2,"subtitle",I.subtitle1,0.125,2.5,false),layer(ids.layer3,"subtitle",I.subtitle2,2.5,5.25,false)],schema_version:1,content_revision:5,created_at:at(830)});
      setting(`project.${ids.main}.edit.current`,ids.edit2);
      setting(`backup.${ids.b0}.meta`,{zipSha256:sha(Buffer.from("s4-b0-zip")),sizeBytes:4096,fileCount:3,verifiedAt:at(815)});
      setting(backupOriginKey(ids.b0),{schemaVersion:1,restoreTicketId:null});setting(backupOriginKey(ids.backup),{schemaVersion:1,restoreTicketId:null});
      setting("backup.directory",`${VIRTUAL_ROOT}\\backups`);
      setting("worker.heartbeat",{at:at(915)});setting("backup.auto.lastDay","2026-01-05");setting(`restore.check.${ids.check}`,{status:"expired"});
      setting(`job.${ids.j31}.startedAt`,at(262));
      const activity=(id:string,sec:number,actor:string,action:string,detail:unknown,projectId:string|null=ids.main)=>insert(sqlite,"activity_log",{id,project_id:projectId,actor,action,detail_json:json(detail),created_at:at(sec)});
      activity(ids.act1,860,"local-user","project.created",{title:I.projectTitle});activity(ids.act2,861,"local-user","plan.approved",{planId:ids.plan2});activity(ids.act3,862,"worker","job.failed",{jobId:ids.j12,code:"CONTENT_REJECTED"});activity(ids.act4,863,"local-user","review.hold",{note:I.reviewNote});activity(ids.act5,864,"worker","backup.succeeded",{backupId:ids.b0},null);
    }).immediate();
    if(sqlite.pragma("integrity_check",{simple:true})!=="ok"||(sqlite.pragma("foreign_key_check") as unknown[]).length)throw new Error("s4 fixture integrity failed");
  }finally{handle.close();}
  return ids;
}

// Same functions and order as runClaimedBackup (snapshot → inventory → manifest → writeArchive), without its
// v7 IDs and real paths. Returns the manifest; the ZIP is written to `out` (new file only).
export async function assembleS4Zip(runtime:string,workdir:string,out:string){
  const ids=s4Ids(),snapshot=join(workdir,"app.db");await mkdir(workdir,{recursive:true});
  const handle=openDatabase(join(runtime,"data/app.db"),{fileMustExist:true});try{await handle.sqlite.backup(snapshot);}finally{handle.close();}
  const files=await storageInventory(join(runtime,"storage"));
  const captured=openDatabase(snapshot,{readonly:true,fileMustExist:true});let migrations:BackupManifest["migrations"];try{migrations=captured.sqlite.prepare("SELECT version,name,sha256 FROM __schema_migrations ORDER BY version").all() as BackupManifest["migrations"];}finally{captured.close();}
  const manifest=backupManifestSchema.parse({schemaVersion:1,backupId:ids.backup,appVersion:APP_VERSION,createdAt:at(900),database:{path:"data/app.db",...await fileDigest(snapshot)},files,inventorySha256:inventoryHash(files),migrations});
  await writeArchive(out,[{path:manifest.database.path,filename:snapshot},...files.map(file=>({path:file.path,filename:join(runtime,file.path)})),{path:"backup-manifest.json",bytes:Buffer.from(JSON.stringify(manifest))}]);
  return manifest;
}
