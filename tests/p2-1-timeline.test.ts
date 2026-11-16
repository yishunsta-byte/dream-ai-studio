// T-061 P2-1 timeline: the product code step 0005 on copies of the fixed backup s4 (never real data), the timeline
// service rules (CAS, immutable rows, required disclosures, stale selection, explicit save only), review/export reading
// paths, and the source/timeout error codes for the CLI and the startup check. Everything runs in OS temp folders.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { v7 } from "uuid";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { codeMigration, codeMigrationSha256, MigrationSourceError } from "@/lib/db/code-migration";
import { journal, migrateDatabase, PRODUCT_CODE_STEPS, productMigrations, productSqlMigrations, type Migration } from "@/lib/db/migrate";
import { LiveMigrationError, migrateLiveDatabase } from "@/lib/db/live-migrate";
import { runMigrateCommand } from "@/lib/db/migrate-command";
import { migrationFailureCopy } from "@/lib/db/migration-copy";
import { checkDatabase } from "@/lib/db/server";
import { readTimelineRow, timelineSha256, type TimelineRow } from "@/lib/db/timeline-data";
import { srtText } from "@/lib/edit/schema";
import { applyEditView, canonicalJson, editViewFromTimeline, framesToMs, secondsToFrames, textFromP1, timelineSchema, timelineSrt, type Timeline } from "@/lib/edit/timeline";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { fileDigest } from "@/lib/export/zip";
import { jobsRepository } from "@/lib/repo/jobs";
import { editingService } from "@/lib/services/editing";
import { bundleLayout } from "@/lib/services/exports";
import { reviewService } from "@/lib/services/review";
import { timelineService, TIMELINE_CONFLICT, TIMELINE_STALE } from "@/lib/services/timeline";
import { S4_INPUTS, S4_ZIP, s4Ids } from "./fixtures/backups/s4-build";
import { snapshotDb } from "./fixtures/backups/s4-compare";

const ids=s4Ids();
let root:string,time:number,committed:{sha256:string;sizeBytes:number};const handles:DatabaseHandle[]=[];
const now=()=>time;
beforeAll(async()=>{committed=await fileDigest(S4_ZIP);});
afterAll(async()=>{expect(await fileDigest(S4_ZIP)).toEqual(committed);});
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-p21-")));time=Date.parse("2026-11-16T09:00:00Z");});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();for(const handle of handles.splice(0))handle.close();if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});

async function s4Copy(name:string){const into=join(root,name);const manifest=await readBackupManifest(S4_ZIP);await verifyBackupArchive(S4_ZIP,manifest,into);return join(into,"data/app.db");}
function migrateFile(file:string,list:readonly Migration[]=productMigrations(),clock=now){const sqlite=new Database(file);try{sqlite.pragma("foreign_keys = ON");sqlite.pragma("recursive_triggers = ON");return migrateDatabase(sqlite,{migrations:list,now:clock});}finally{sqlite.close();}}
function withFile<T>(file:string,fn:(sqlite:Database.Database)=>T,readonly=false){const sqlite=new Database(file,{readonly,fileMustExist:true});try{if(!readonly){sqlite.pragma("foreign_keys = ON");}return fn(sqlite);}finally{sqlite.close();}}
const timelineRows=(file:string)=>withFile(file,sqlite=>sqlite.prepare("SELECT * FROM timeline_revisions ORDER BY project_id,revision").all() as TimelineRow[],true);
const snap=(file:string)=>withFile(file,snapshotDb,true);
const without=(snapshot:ReturnType<typeof snapshotDb>,...names:string[])=>{const copy=new Map(snapshot);for(const name of names)copy.delete(name);return copy;};
const thrown=(fn:()=>unknown)=>{try{fn();}catch(error){return error as Error&{code?:string;status?:number};}throw new Error("expected a throw");};
async function migratedS4(name="s5"){const file=await s4Copy(name);migrateFile(file);return file;}
function open(file:string){const handle=openDatabase(file,{fileMustExist:true});handles.push(handle);return handle;}
const revisionOf=(handle:DatabaseHandle)=>jobsRepository(handle).project(ids.main)!.contentRevision;

describe("시간·정규화·스키마 (lib/edit/timeline.ts)",()=>{
  it("초→프레임은 정수 반올림(0.5 올림)이고 프레임→밀리초는 왕복이 정확하다",()=>{
    expect([0,0.125,2.5,5.25,30,0.05,1/60].map(secondsToFrames)).toEqual([0,4,75,158,900,2,1]);
    for(let frame=0;frame<2000;frame++)expect(secondsToFrames(framesToMs(frame)/1000)).toBe(frame);
    expect(framesToMs(4)).toBe(133);expect(framesToMs(158)).toBe(5267);
  });
  it("정규화는 키 사전순·배열 순서 유지이고, 글자 앞뒤 공백을 지우지 않는다",()=>{
    expect(canonicalJson({b:[2,1],a:{d:null,c:"x"}})).toBe('{"a":{"c":"x","d":null},"b":[2,1]}');
    const layer=textFromP1({id:ids.layer2,kind:"subtitle",content:S4_INPUTS.subtitle1,fontFamily:"Pretendard",fontSize:40,color:"#FFFFFF",position:"bottom",startSec:0.125,endSec:2.5,locked:false});
    const timeline={schemaVersion:1,fps:30,aspect:"9:16",video:[],audio:[],text:[layer]};
    expect(timelineSchema.parse(timeline).text[0].content).toBe(S4_INPUTS.subtitle1);expect(canonicalJson(timelineSchema.parse(timeline))).toBe(canonicalJson(timeline));
    expect(layer).toMatchObject({box:{x:0.44,y:0.74,anchor:"center",widthRatio:0.76,rotation:0},style:{fontWeight:700,stroke:null,shadow:null,background:null,lineHeight:1.3,maxLines:2},timing:{startFrame:4,endFrame:75},animation:{in:"none",out:"none",emphasis:"none",durationFrames:0,easing:"ease-out"}});
  });
  it("스키마는 정수 프레임·끝>시작·빈 자리 짝·겹치는 id·빈 문구를 거부한다",()=>{
    const layer=textFromP1({id:ids.layer2,kind:"subtitle",content:"a",fontFamily:"Pretendard",fontSize:40,color:"#FFFFFF",position:"bottom",startSec:0,endSec:1,locked:false});
    const clip={id:v7(),sceneId:ids.s1,sceneVersionId:null,assetId:null,durationFrames:90,trimInFrames:0,trimOutFrames:0,transition:{type:"cut",durationFrames:0}};
    const base={schemaVersion:1,fps:30,aspect:"9:16",video:[clip],audio:[],text:[layer]};expect(timelineSchema.safeParse(base).success).toBe(true);
    for(const bad of [{...base,text:[{...layer,timing:{startFrame:1.5,endFrame:3}}]},{...base,text:[{...layer,timing:{startFrame:3,endFrame:3}}]},{...base,video:[{...clip,assetId:v7()}]},{...base,video:[clip,{...clip,sceneId:ids.s2}]},{...base,text:[layer,layer]},{...base,text:[{...layer,content:"   "}]},{...base,fps:25},{...base,video:[{...clip,durationFrames:0}]}])expect(timelineSchema.safeParse(bad).success).toBe(false);
  });
});

describe("0005 코드 이관 (s4 사본)",()=>{
  it("P1 current 스냅샷만 r1로 옮기고, 값은 spec fromP1Values 그대로, 다른 표·내용 버전·단계는 그대로다",async()=>{
    const file=await s4Copy("s4"),before=snap(file);expect(migrateFile(file,productMigrations().slice(0,5))).toBe(1);const after=snap(file);
    expect(withFile(file,sqlite=>journal(sqlite)!.map(row=>row.name),true)).toEqual([...productSqlMigrations().map(row=>row.name),"0005_timeline_revisions.cjs"]);
    expect(without(after,"__schema_migrations","timeline_revisions","projects")).toEqual(without(before,"__schema_migrations","projects"));
    const projects=(s:ReturnType<typeof snapshotDb>)=>[...s.get("projects")!.rows.values()].map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=="current_timeline_rev_id")));expect(projects(after)).toEqual(projects(before));
    const rows=timelineRows(file);expect(rows).toHaveLength(1);const [row]=rows;
    expect(row).toMatchObject({project_id:ids.main,revision:1,content_revision:5,source:"p1-migration",restored_from_id:null,migrated_from_key:`project.${ids.main}.edit.${ids.edit2}`,created_at:"2026-01-05T00:13:50.000Z"});
    expect(row.timeline_sha256).toBe(timelineSha256(row.timeline_json));
    const timeline=readTimelineRow(row);
    expect(timeline.video.map(clip=>[clip.sceneId,clip.sceneVersionId,clip.assetId,clip.durationFrames,clip.trimOutFrames])).toEqual([[ids.s1,ids.v11,ids.r1,90,0],[ids.s2,ids.v21,ids.r3,90,0],[ids.s3,null,null,90,0]]);
    expect(timeline.text.map(layer=>[layer.id,layer.kind,layer.content,layer.style.fontSize,layer.style.color,layer.box.y,layer.timing.startFrame,layer.timing.endFrame,layer.locked])).toEqual([[ids.layer1,"disclosure","광고",28,"#FFFFFF",0.16,0,900,true],[ids.layer2,"subtitle",S4_INPUTS.subtitle1,40,"#FFFFFF",0.74,4,75,false],[ids.layer3,"subtitle",S4_INPUTS.subtitle2,40,"#FFFFFF",0.74,75,158,false]]);
    const pointers=withFile(file,sqlite=>sqlite.prepare("SELECT id,current_timeline_rev_id AS p FROM projects ORDER BY id").all(),true);expect(pointers).toEqual([{id:ids.main,p:row.id},{id:ids.draft,p:null},{id:ids.archived,p:null}].sort((a,b)=>a.id.localeCompare(b.id)));
  });
  it("같은 입력이면 다른 시각에도 같은 행·해시이고, 두 번째 실행은 0개다",async()=>{
    const a=await s4Copy("a"),b=await s4Copy("b");migrateFile(a,productMigrations(),()=>Date.parse("2026-11-16T00:00:00Z"));migrateFile(b,productMigrations(),()=>Date.parse("2031-03-01T12:34:56Z"));
    expect(timelineRows(a)).toEqual(timelineRows(b));expect(migrateFile(a)).toBe(0);
  });
  it("영상 결과·speech 선택·보관 프로젝트의 스냅샷도 같은 규칙으로 옮긴다",async()=>{
    const file=await s4Copy("variants"),snapshotId=v7(),archivedKey=`project.${ids.archived}.edit.${snapshotId}`;
    withFile(file,sqlite=>{sqlite.pragma("foreign_keys = OFF");
      sqlite.prepare("UPDATE assets SET kind='video',duration_ms=4000 WHERE id=?").run(ids.r1);
      // Virtual copy only: a P1 database could hold a succeeded speech selection; the completed-version guard is lifted here to make one.
      sqlite.exec("DROP TRIGGER completed_version_immutable");sqlite.prepare("UPDATE scene_versions SET kind='speech' WHERE id=?").run(ids.v21);
      sqlite.prepare("INSERT INTO settings(key,value_json) VALUES(?,?)").run(archivedKey,JSON.stringify({sceneOrder:[ids.s4],layers:[{id:ids.layer3,kind:"title",content:"보관 제목",fontFamily:"Pretendard",fontSize:50,color:"#112233",position:"middle",startSec:0.05,endSec:0.06,locked:false}],schema_version:1,content_revision:1,created_at:"2026-01-05T00:00:40.000Z"}));
      sqlite.prepare("INSERT INTO settings(key,value_json) VALUES(?,?)").run(`project.${ids.archived}.edit.current`,JSON.stringify(snapshotId));});
    migrateFile(file);const rows=timelineRows(file),main=readTimelineRow(rows.find(row=>row.project_id===ids.main)!),archived=readTimelineRow(rows.find(row=>row.project_id===ids.archived)!);
    expect(main.video.map(clip=>[clip.sceneVersionId,clip.durationFrames,clip.trimOutFrames])).toEqual([[ids.v11,90,30],[null,90,0],[null,90,0]]);
    expect(archived.text[0]).toMatchObject({kind:"title",box:{y:0.5},style:{maxLines:2,color:"#112233"},timing:{startFrame:2,endFrame:3}});expect(rows.find(row=>row.project_id===ids.archived)).toMatchObject({migrated_from_key:archivedKey,content_revision:1});
  });
  it.each([["없는 스냅샷을 가리키는 포인터",(s:Database.Database)=>s.prepare("UPDATE settings SET value_json=? WHERE key=?").run(JSON.stringify(v7()),`project.${ids.main}.edit.current`)],["UUID가 아닌 포인터",(s:Database.Database)=>s.prepare("UPDATE settings SET value_json='123' WHERE key=?").run(`project.${ids.main}.edit.current`)],["schema_version이 다른 스냅샷",(s:Database.Database)=>{const id=v7();s.prepare("INSERT INTO settings(key,value_json) VALUES(?,?)").run(`project.${ids.main}.edit.${id}`,JSON.stringify({schema_version:2,content_revision:5,created_at:"2026-01-05T00:00:00.000Z",sceneOrder:[],layers:[]}));s.prepare("UPDATE settings SET value_json=? WHERE key=?").run(JSON.stringify(id),`project.${ids.main}.edit.current`);}]] as const)("%s: 이관 전체 실패, DB 그대로, CLI는 실패 기록·복사본",async(_name,breakIt:(s:Database.Database)=>unknown)=>{
    const folder=join(root,"cli");mkdirSync(join(folder,"data"),{recursive:true});const file=join(folder,"data/app.db");copyFileSync(await s4Copy("src"),file);withFile(file,breakIt);
    const before=snap(file);expect(()=>migrateFile(file)).toThrow();expect(snap(file)).toEqual(before);
    const err:string[]=[];expect(runMigrateCommand({root:folder,now,log:()=>{},error:line=>err.push(line)})).toBe(1);expect(err[0]).toBe(migrationFailureCopy("MIGRATION_FAILED",null,true).headline);expect(snap(file)).toEqual(before);
    expect(checkDatabase(folder)).toMatchObject({ok:false,code:"MIGRATION_FAILED"});
  });
  it("트리거: 행 UPDATE·DELETE·REPLACE 거부, 포인터·되돌리기 출처는 같은 프로젝트 행만, 출처 짝 검사",async()=>{
    const file=await migratedS4(),[row]=timelineRows(file);
    withFile(file,sqlite=>{
      expect(()=>sqlite.prepare("UPDATE timeline_revisions SET timeline_json='{}' WHERE id=?").run(row.id)).toThrow(/immutable/);
      expect(()=>sqlite.prepare("DELETE FROM timeline_revisions WHERE id=?").run(row.id)).toThrow(/immutable/);
      const values=[row.id,row.project_id,row.revision,row.content_revision,row.timeline_json,row.timeline_sha256,row.source,row.restored_from_id,row.migrated_from_key,row.created_at];
      expect(()=>sqlite.prepare("INSERT OR REPLACE INTO timeline_revisions VALUES (?,?,?,?,?,?,?,?,?,?)").run(...values)).toThrow(/immutable/);
      expect(()=>sqlite.prepare("REPLACE INTO timeline_revisions VALUES (?,?,?,?,?,?,?,?,?,?)").run(v7(),row.project_id,1,5,row.timeline_json,row.timeline_sha256,"user",null,null,row.created_at)).toThrow(/immutable/);
      expect(()=>sqlite.prepare("UPDATE projects SET current_timeline_rev_id=? WHERE id=?").run(row.id,ids.draft)).toThrow(/same project/);
      expect(()=>sqlite.prepare("UPDATE projects SET current_timeline_rev_id=? WHERE id=?").run(v7(),ids.main)).toThrow(/same project/);
      const id=v7();expect(()=>sqlite.prepare("INSERT INTO projects(id,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,content_revision,current_timeline_rev_id,created_at,updated_at) SELECT ?,menu_id,template_version,template_snapshot_json,inputs_json,title,goal,target,aspect,length_sec,1,?,created_at,updated_at FROM projects WHERE id=?").run(id,row.id,ids.draft)).toThrow(/same project/);
      expect(()=>sqlite.prepare("INSERT INTO timeline_revisions VALUES (?,?,?,?,?,?,?,?,?,?)").run(v7(),ids.draft,1,1,row.timeline_json,row.timeline_sha256,"restore-version",row.id,null,row.created_at)).toThrow(/same project/);
      expect(()=>sqlite.prepare("INSERT INTO timeline_revisions VALUES (?,?,?,?,?,?,?,?,?,?)").run(v7(),ids.main,2,6,row.timeline_json,row.timeline_sha256,"user",null,"project.x",row.created_at)).toThrow(/CHECK/);
      expect(()=>sqlite.prepare("INSERT INTO timeline_revisions VALUES (?,?,?,?,?,?,?,?,?,?)").run(v7(),ids.main,2,6,row.timeline_json,"short","user",null,null,row.created_at)).toThrow(/CHECK/);
    });
    expect(timelineRows(file)).toEqual([row]);
  });
});

describe("타임라인 서비스 (옮긴 s4 프로젝트)",()=>{
  it("읽기는 쓰지 않고, 경고(영상보다 긴 글자·빈 자리)를 알려 주며, 옮긴 r1은 P1 스냅샷과 같은 묶음 글자·SRT를 만든다",async()=>{
    const file=await migratedS4(),handle=open(file),before=snapshotDb(handle.sqlite);
    const data=timelineService(handle).get(ids.main),screen=editingService(handle).get(ids.main);expect(snapshotDb(handle.sqlite)).toEqual(before);
    expect(data.current).toMatchObject({revision:1,source:"p1-migration"});expect(data.stale).toEqual([]);expect(data.warnings).toEqual({textBeyondVideo:[ids.layer1],textBeyondLimit:[],emptySlots:[ids.s3]});
    expect(screen).toMatchObject({savedId:data.current!.id,maxEndSec:30,stale:[]});expect(screen.value.layers.map(layer=>[layer.content,layer.position,layer.startSec,layer.endSec,layer.fontSize])).toEqual([["광고","top",0,30,28],[S4_INPUTS.subtitle1.trim(),"bottom",0.133,2.5,40],[S4_INPUTS.subtitle2,"bottom",2.5,5.267,40]]);
    const p1=editingService(handle).current(ids.main),view=timelineService(handle).editView(ids.main);expect({id:view.id,value:view.value,snapshot:view.snapshot}).toEqual(p1);
    const project=jobsRepository(handle).project(ids.main)!,plan=jobsRepository(handle).plan(project.approvedPlanId!)!,layout=(edit:typeof p1)=>bundleLayout(handle,{project,plan,edit,revision:project.contentRevision,reviews:[],selected:[]}).filter(entry=>entry.source==="text").map(entry=>[entry.path,entry.source==="text"?entry.text:""]);
    expect(layout(view)).toEqual(layout(p1));expect(screen.savedSrt).toBe(srtText(p1.value!.layers));expect(screen.savedSrt).toContain("00:00:00,125 --> 00:00:02,500");expect(screen.fromP1).toBe(true);expect(layout(view).find(([path])=>path==="subtitles/manual.srt")?.[1]).toBe(srtText(p1.value!.layers));
    expect(snapshotDb(handle.sqlite)).toEqual(before);
  });
  it("같은 내용 저장은 새 행 없음, 바꾸면 새 행·포인터·내용 버전+1·뒤 단계 무효, r1 그대로, SRT는 프레임에서",async()=>{
    const handle=open(await migratedS4()),editing=editingService(handle),timelines=timelineService(handle),rev=revisionOf(handle),r1=timelines.get(ids.main).row!;
    expect(editing.save(ids.main,rev,editing.get(ids.main).value)).toEqual({revision:rev,id:r1.id});expect(revisionOf(handle)).toBe(rev);
    const value=editing.get(ids.main).value,saved=editing.save(ids.main,rev,{...value,layers:value.layers.map(layer=>layer.id===ids.layer3?{...layer,content:"  고친 자막  "}:layer)});
    expect(saved.revision).toBe(rev+1);const state=timelines.get(ids.main);expect(state.current).toMatchObject({id:saved.id,revision:2,source:"user",contentRevision:rev+1});
    expect(state.timeline!.text.map(layer=>layer.content)).toEqual(["광고",S4_INPUTS.subtitle1,"고친 자막"]);expect(state.timeline!.text[1].timing).toEqual({startFrame:4,endFrame:75});
    expect(handle.sqlite.prepare("SELECT * FROM timeline_revisions WHERE id=?").get(r1.id)).toEqual(r1);
    const log=handle.sqlite.prepare("SELECT detail_json FROM activity_log WHERE action='timeline.save'").all() as {detail_json:string}[];expect(log.map(row=>JSON.parse(row.detail_json))).toEqual([{timelineId:saved.id,timelineRevision:2,previousTimelineId:r1.id,previousRevision:rev,contentRevision:rev+1,origin:"edit"}]);
    expect(handle.sqlite.prepare("SELECT status FROM stage_states WHERE project_id=? AND stage IN ('edit','review') ORDER BY stage").all(ids.main)).toEqual([{status:"in_progress"},{status:"locked"}]);
    const view=timelines.editView(ids.main);expect(view.id).toBe(saved.id);expect(srtText(view.value!.layers)).toBe(timelineSrt(state.timeline!.text));expect(srtText(view.value!.layers)).toContain("00:00:00,133 --> 00:00:02,500");
    // Stored bytes keep the outer spaces; the view, bundle text and SRT show them trimmed exactly as the P1 reader did.
    expect(S4_INPUTS.subtitle1).not.toBe(S4_INPUTS.subtitle1.trim());expect(view.value!.layers[1].content).toBe(S4_INPUTS.subtitle1.trim());expect(srtText(view.value!.layers)).toContain(`\n${S4_INPUTS.subtitle1.trim()}\n`);expect(timelineSrt(state.timeline!.text)).not.toContain(S4_INPUTS.subtitle1);
  });
  it("CAS: 내용 버전·타임라인 id가 다르면 409, 장면·결과·글자 규칙을 서버가 다시 검사한다",async()=>{
    const handle=open(await migratedS4()),timelines=timelineService(handle),rev=revisionOf(handle),data=timelines.get(ids.main),base=data.timeline!,id=data.current!.id;
    expect(thrown(()=>timelines.save(ids.main,rev-1,id,base))).toMatchObject({code:"CONFLICT"});
    expect(thrown(()=>timelines.save(ids.main,rev,null,base))).toMatchObject({code:"CONFLICT",message:TIMELINE_CONFLICT});
    expect(timelines.save(ids.main,rev,id,base)).toMatchObject({created:false,revision:rev});
    const disclosure=base.text[0],extra=(over:object)=>({...textFromP1({id:v7(),kind:"subtitle",content:"추가",fontFamily:"Pretendard",fontSize:40,color:"#FFFFFF",position:"bottom",startSec:0,endSec:1,locked:false}),...over});
    const cases:[Timeline,RegExp|string][]=[
      [{...base,video:base.video.slice(1)},"현재 장면을 빠짐없이"],
      [{...base,video:base.video.map((clip,index)=>index===2?{...clip,sceneVersionId:ids.v31,assetId:ids.r1}:clip)},"지금 선택과 달라요"],
      [{...base,video:base.video.map((clip,index)=>index===0?{...clip,id:v7()}:clip)},"지금 선택과 달라요"],
      [{...base,video:base.video.map((clip,index)=>index===0?{...clip,durationFrames:60}:clip)},"지금 선택과 달라요"],
      [{...base,aspect:"16:9"},"화면 비율"],
      [{...base,text:base.text.slice(1)},"필수 표기"],
      [{...base,text:[{...disclosure,content:"광고 아님"},...base.text.slice(1)]},"필수 표기"],
      [{...base,text:[{...disclosure,timing:{startFrame:0,endFrame:600}},...base.text.slice(1)]},"필수 표기"],
      [{...base,text:[...base.text,extra({timing:{startFrame:0,endFrame:901}})]},"30초 안"],
      [{...base,text:[...base.text,extra({locked:true})]},"잠긴 필수 표기"],
    ];
    for(const [timeline,message] of cases)expect(thrown(()=>timelines.save(ids.main,rev,id,timeline)).message).toMatch(message);
    expect(()=>timelines.save(ids.main,rev,id,{...base,text:[...base.text,base.text[1]]})).toThrow();
    expect(timelineRows(join(root,"s5","data/app.db"))).toHaveLength(1);
    // Allowed: move the required disclosure (its P1 size 28 and 0–30 s are kept), add a text that ends after the video.
    const moved=timelines.save(ids.main,rev,id,{...base,text:[{...disclosure,box:{...disclosure.box,y:0.74}},...base.text.slice(1),extra({timing:{startFrame:0,endFrame:600}})]});
    expect(moved.created).toBe(true);const after=timelines.get(ids.main);expect(after.timeline!.text[0]).toMatchObject({style:{fontSize:28},timing:{startFrame:0,endFrame:900},box:{y:0.74}});expect(after.warnings.textBeyondVideo).toHaveLength(2);
  });
  it("되돌리기: 같은 프로젝트 행만, 지금 규칙으로 다시 검사해 새 restore-version 행을 만든다",async()=>{
    const handle=open(await migratedS4()),editing=editingService(handle),timelines=timelineService(handle),r1=timelines.get(ids.main).row!;
    const value=editing.get(ids.main).value;editing.save(ids.main,revisionOf(handle),{...value,layers:value.layers.slice(0,2)});const r2=timelines.get(ids.main).current!;
    expect(thrown(()=>timelines.restore(ids.main,revisionOf(handle),r2.id,v7()))).toMatchObject({status:404});
    const restored=timelines.restore(ids.main,revisionOf(handle),r2.id,r1.id);expect(restored).toMatchObject({created:true,timelineRevision:3});
    const row=timelines.get(ids.main).row!;expect(row).toMatchObject({source:"restore-version",restored_from_id:r1.id,timeline_json:r1.timeline_json,timeline_sha256:r1.timeline_sha256});
    expect(timelines.restore(ids.main,revisionOf(handle),row.id,r1.id)).toMatchObject({created:false});
    // After the selection changes, the old version no longer matches today's scenes and is refused.
    handle.sqlite.prepare("UPDATE scenes SET selected_version_id=? WHERE id=?").run(ids.v13,ids.s1);
    expect(thrown(()=>timelines.restore(ids.main,revisionOf(handle),row.id,r2.id)).message).toContain("그대로 되돌릴 수 없어요");
  });
  it("선택이 바뀌면 stale: 화면 경고, 편집 완료·검수 승인 거부, 지금 선택으로 다시 저장하면 풀린다. 옛 행·원본은 그대로",async()=>{
    const file=await migratedS4(),handle=open(file),editing=editingService(handle),timelines=timelineService(handle),r1=timelines.get(ids.main).row!,settingsBefore=snapshotDb(handle.sqlite).get("settings");
    const version=handle.sqlite.prepare("SELECT id,status FROM scene_versions WHERE id=?").get(ids.v13) as {id:string;status:string};expect(version.status).toBe("succeeded");
    handle.sqlite.prepare("UPDATE scenes SET selected_version_id=? WHERE id=?").run(ids.v13,ids.s1);
    const data=editing.get(ids.main);expect(data.stale).toEqual([ids.s1]);expect(data.clips[0]).toMatchObject({sceneId:ids.s1,sceneVersionId:ids.v13,assetId:ids.r2,id:readTimelineRow(r1).video[0].id});
    expect(thrown(()=>editing.complete(ids.main,revisionOf(handle))).message).toBe(TIMELINE_STALE);
    expect(thrown(()=>reviewService(handle).approve(ids.main,revisionOf(handle))).message).toBe(TIMELINE_STALE);
    expect(timelines.editView(ids.main).stale).toEqual([ids.s1]);
    const saved=editing.save(ids.main,revisionOf(handle),data.value);expect(saved.id).not.toBe(r1.id);expect(timelines.get(ids.main).stale).toEqual([]);
    expect(readTimelineRow(timelines.get(ids.main).row!).video[0]).toMatchObject({sceneVersionId:ids.v13,assetId:ids.r2});
    expect(handle.sqlite.prepare("SELECT * FROM timeline_revisions WHERE id=?").get(r1.id)).toEqual(r1);expect(snapshotDb(handle.sqlite).get("settings")).toEqual(settingsBefore);
  });
  it("변조는 숨기지 않는다: 해시가 다른 행, 해시는 맞지만 원래 P1 글자와 다른 r1은 읽기·묶음에서 거부",async()=>{
    const file=await migratedS4(),[row]=timelineRows(file);
    withFile(file,sqlite=>{sqlite.exec("DROP TRIGGER timeline_revisions_update_guard");sqlite.prepare("UPDATE timeline_revisions SET timeline_json=replace(timeline_json,'광고','광 고') WHERE id=?").run(row.id);});
    let handle=open(file);expect(()=>timelineService(handle).editView(ids.main)).toThrow(/hash/);handle.close();handles.splice(handles.indexOf(handle),1);
    const changed=JSON.parse(row.timeline_json) as Timeline;changed.text[1].content="바뀐 자막";const json=canonicalJson(changed);
    withFile(file,sqlite=>sqlite.prepare("UPDATE timeline_revisions SET timeline_json=?,timeline_sha256=? WHERE id=?").run(json,timelineSha256(json),row.id));
    handle=open(file);expect(thrown(()=>timelineService(handle).editView(ids.main)).message).toContain("원래 글자 설정과 달라요");
  });
  it("화면 변환: 손대지 않은 칸은 저장 값 그대로, 바꾼 칸만 새 값(새 글자는 앞뒤 공백 정리)",async()=>{
    const handle=open(await migratedS4()),data=editingService(handle).get(ids.main);
    expect(canonicalJson(applyEditView(data.base,data.value,data.clips))).toBe(canonicalJson(data.base));
    const next=applyEditView(data.base,{...data.value,layers:[...data.value.layers.map(layer=>layer.id===ids.layer2?{...layer,position:"middle" as const,startSec:0.125}:layer),{...data.value.layers[1],id:v7(),content:"  새 글자  "}]},data.clips);
    expect(next.text[1]).toMatchObject({content:S4_INPUTS.subtitle1,box:{y:0.5},timing:{startFrame:4,endFrame:75}});expect(next.text[3].content).toBe("새 글자");
    expect(editViewFromTimeline(next).sceneOrder).toEqual([ids.s1,ids.s2,ids.s3]);
  });
});

describe("원문·시간 초과 오류 (CLI·시작 점검)",()=>{
  const step=PRODUCT_CODE_STEPS[0];
  function copySources(base:string){for(const path of step.files){const to=join(base,...path.split("/"));mkdirSync(dirname(to),{recursive:true});copyFileSync(join(process.cwd(),...path.split("/")),to);}}
  it("선언 해시는 지금 원문과 같고, 한 글자 수정·파일 누락은 실행 전에 거부한다",()=>{
    expect(codeMigrationSha256(step.files.map(path=>({path,text:readFileSync(join(process.cwd(),...path.split("/")),"utf8")})))).toBe(step.sha256);
    const base=join(root,"edited");copySources(base);const shared=join(base,...step.files[1].split("/"));writeFileSync(shared,readFileSync(shared,"utf8").replace("0.76","0.77"));
    expect(()=>codeMigration({...step,files:[...step.files],root:base})).toThrow(MigrationSourceError);
    unlinkSync(shared);expect(()=>codeMigration({...step,files:[...step.files],root:base})).toThrow(/파일을 읽지 못했어요/);
  });
  it("앱 폴더 밖에서 실행하면 MIGRATION_SOURCE: CLI는 안내 후 종료 1, 시작 점검도 같은 문장, DB 바이트 그대로",async()=>{
    const folder=join(root,"runtime");mkdirSync(join(folder,"data"),{recursive:true});const file=join(folder,"data/app.db");copyFileSync(await s4Copy("src"),file);const before=await fileDigest(file);
    vi.spyOn(process,"cwd").mockReturnValue(join(root,"elsewhere"));
    expect(()=>productMigrations()).toThrow(MigrationSourceError);const copy=migrationFailureCopy("MIGRATION_SOURCE",null,false);
    const err:string[]=[];expect(runMigrateCommand({root:folder,now,log:()=>{},error:line=>err.push(line)})).toBe(1);expect(err).toEqual([copy.headline,copy.next]);
    expect(checkDatabase(folder)).toEqual({ok:false,message:copy.headline,detail:[copy.next],code:"MIGRATION_SOURCE"});expect(await fileDigest(file)).toEqual(before);
  });
  it("코드 단계가 시간 안에 끝나지 않으면 MIGRATION_TIMEOUT: DB 그대로, 복사본 남김, CLI·시작 점검 같은 문장",async()=>{
    const folder=join(root,"runtime");mkdirSync(join(folder,"data"),{recursive:true});const file=join(folder,"data/app.db");copyFileSync(await migratedS4("five"),file);
    const base=join(root,"probe"),path="lib/db/migrations/0006_probe.cjs";mkdirSync(join(base,"lib/db/migrations"),{recursive:true});writeFileSync(join(base,path),"module.exports.sql=\"CREATE TABLE probe_t061 (x TEXT) STRICT;\";\nmodule.exports.run=function run(){for(;;){}};\n");
    const list=[...productMigrations(),codeMigration({version:6,name:"0006_probe.cjs",files:[path],sha256:codeMigrationSha256([{path,text:readFileSync(join(base,path),"utf8")}]),root:base,runTimeoutMs:200})];
    const before=snap(file),handle=open(file);expect(()=>migrateLiveDatabase(handle,{snapshotDirectory:join(root,"pre"),migrations:list,now})).toThrow(expect.objectContaining({code:"MIGRATION_TIMEOUT"}) as LiveMigrationError);handle.close();handles.splice(handles.indexOf(handle),1);expect(snap(file)).toEqual(before);
    time+=1000;const err:string[]=[];expect(runMigrateCommand({root:folder,migrations:list,now,log:()=>{},error:line=>err.push(line)})).toBe(1);const copy=migrationFailureCopy("MIGRATION_TIMEOUT",null,true);expect(err.slice(0,2)).toEqual([copy.headline,copy.next]);
    expect(checkDatabase(folder,list)).toMatchObject({ok:false,message:copy.headline,code:"MIGRATION_TIMEOUT"});expect(snap(file)).toEqual(before);
  },30000);
  it("실제 제품 목록 CLI: s4 사본 4→6(0005·0006, 복사본 남김)→0, 빈 폴더는 6단계, 시작 점검 통과",async()=>{
    const folder=join(root,"runtime");mkdirSync(join(folder,"data"),{recursive:true});copyFileSync(await s4Copy("src"),join(folder,"data/app.db"));
    const out:string[]=[];expect(runMigrateCommand({root:folder,now,log:line=>out.push(line),error:()=>{}})).toBe(0);expect(out[0]).toBe("데이터베이스 준비 완료: 새 마이그레이션 2개");expect(out[1]).toMatch(/^바꾸기 전 복사본: backups\/pre-migrate\/\d{8}T\d{6}Z_s4-s6\.db/);
    out.length=0;expect(runMigrateCommand({root:folder,now,log:line=>out.push(line),error:()=>{}})).toBe(0);expect(out).toEqual(["데이터베이스 준비 완료: 새 마이그레이션 0개"]);expect(checkDatabase(folder)).toEqual({ok:true});
    const fresh=join(root,"fresh");out.length=0;expect(runMigrateCommand({root:fresh,now,log:line=>out.push(line),error:()=>{}})).toBe(0);expect(out).toEqual(["데이터베이스 준비 완료: 새 마이그레이션 6개"]);expect(timelineRows(join(fresh,"data/app.db"))).toEqual([]);
  });
});
