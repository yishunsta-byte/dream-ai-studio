import { mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh(){}})}));
vi.mock("@/components/editing-panel",()=>({finishingRequest:vi.fn()}));
import { ExportsPanel } from "@/components/exports-panel";
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { editingService } from "@/lib/services/editing";
import { exportService, type ExportsData } from "@/lib/services/exports";
import { reviewService } from "@/lib/services/review";
import { timelineService } from "@/lib/services/timeline";
import { runNextJob } from "@/lib/jobs/runner";
import { S9_RECORD, S9_ZIP } from "./fixtures/backups/s9-build";
import { readS9 } from "./fixtures/backups/s9-compare";

const ids=readS9(S9_RECORD).ids,P=ids.project;
let root:string,folder:string,handle:DatabaseHandle,time:number;
const revision=()=>(handle.sqlite.prepare("SELECT content_revision r FROM projects WHERE id=?").get(P) as {r:number}).r;
const data=()=>exportService(handle).list(P);
const markup=(value=data())=>renderToStaticMarkup(createElement(ExportsPanel,{data:value}));
const text=(html:string)=>html.replace(/<[^>]*>/g," ").replace(/\s+/g," ");
const approve=()=>{handle.sqlite.prepare("UPDATE scenes SET needs_recheck=0 WHERE project_id=?").run(P);editingService(handle).complete(P,revision());const service=reviewService(handle);for(const item of service.get(P).items)service.update(P,revision(),{itemId:item.templateItemId,status:"pass",note:"T164 가상 사본"});service.approve(P,revision());};
const source=()=>join(folder,"storage",(handle.sqlite.prepare("SELECT file_path FROM assets WHERE id=?").get(ids.voice) as {file_path:string}).file_path);
beforeEach(async()=>{
 root=realpathSync(mkdtempSync(join(tmpdir(),"dream-t164-ui-")));folder=join(root,"rt");time=Date.parse("2026-11-17T12:00:00Z");
 await verifyBackupArchive(S9_ZIP,await readBackupManifest(S9_ZIP),folder);mkdirSync(join(folder,"backups"),{recursive:true});
 const sqlite=new Database(join(folder,"data/app.db"));try{sqlite.pragma("foreign_keys=ON");migrateDatabase(sqlite,{migrations:productMigrations()});}finally{sqlite.close();}
 vi.stubEnv("DREAM_DATA_ROOT",folder);handle=openDatabase(join(folder,"data/app.db"),{fileMustExist:true});
 handle.sqlite.prepare("UPDATE jobs SET status='failed',lease_until=NULL WHERE status IN ('running','queued')").run();
});
afterEach(()=>{handle?.close();vi.unstubAllEnvs();if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temp boundary");rmSync(root,{recursive:true,force:true});});

describe("T164 actual fake-DB preview to export UI",()=>{
 it("v2 lists actual source roles/count/rights and honest size/backup/manual-edit limits",()=>{
  approve();const value=data(),html=markup(value),page=text(html);expect(value.preview.ready).toBe(true);if(!value.preview.ready)return;
  expect(page).toContain("묶음 형식 v2");expect(page).toContain("소리 원본 2개");
  for(const sound of value.preview.audio){expect(page).toContain(sound.title);expect(page).toContain(`클립 ${sound.clipCount}개`);}
  for(const sentence of ["목소리","배경 음악","권리 기록 있음","사용권이 확인된 것은 아니에요","백업도 커져요","큰 원본의 예상치 정확도와 작성 시간은 확인하지 않았어요","실행 앱은 들어 있지 않아요","손으로 맞춰야","다시 불러오는 기능이 없어요","저장하지 않은 편집 변경은 포함하지 않아요","최종 영상 내보내기와 게시 게이트는 열리지 않아요"])expect(page).toContain(sentence);
  expect(html).not.toContain(folder);expect(html).not.toContain("검증 통과");expect(html).not.toContain("검증된 해시");
  const row=handle.sqlite.prepare("SELECT sha256 FROM assets WHERE id=?").get(ids.voice) as {sha256:string};expect(html).not.toContain(row.sha256);
  expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>현재 내용/);
 });
 it("actual missing source blocks both create and failed-row recreate with a useful reason",async()=>{
  approve();const file=source(),bytes=readFileSync(file);bytes[bytes.length-1]^=1;writeFileSync(file,bytes);
  const request=exportService(handle).request(P,revision());await runNextJob(handle,{now:()=>time,sleep:async ms=>{time+=ms;}});
  renameSync(file,file+".away");const value=data();expect(value.preview).toMatchObject({audioBlocked:true});
  const html=markup(value),page=text(html);expect(page).toContain("찾을 수 없어요");expect(page).toContain("저장할 때와 달라요");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>현재 내용 r/);expect(html).toMatch(/<button[^>]*disabled=""[^>]*>현재 내용으로 새로 만들기/);
  expect(page).toContain("원본 확인 필요");expect(value.rows.find(row=>row.id===request.id)).toMatchObject({status:"failed",retryable:false,available:false});
 });
 it("v1 without source audio keeps manifest1 and states originals are absent",()=>{
  const service=timelineService(handle),state=service.state(P),old=structuredClone(state.timeline!);
  service.save(P,revision(),state.current!.id,{schemaVersion:1,fps:30,aspect:old.aspect,video:old.video,text:old.text,audio:[]});approve();
  const value=data();expect(value.preview).toMatchObject({manifestVersion:1,audio:[]});const page=text(markup(value));expect(page).toContain("묶음 형식 v1");expect(page).toContain("이 묶음에는 소리 원본이 들어가지 않아요");
 });
 it("a missing registration has unknown source size and never formats null as a byte count",()=>{
  approve();handle.sqlite.pragma("foreign_keys=OFF");handle.sqlite.prepare("UPDATE assets SET id=? WHERE id=?").run("01a1e8a4-0000-7000-8000-000000000098",ids.voice);
  const value=data();expect(value.preview).toMatchObject({audioBlocked:true});if(!value.preview.ready)throw new Error("preview");
  expect(value.preview.audio.find(item=>item.assetId===ids.voice)?.sizeBytes).toBeNull();
  const page=text(markup(value));expect(page).toContain("원본 크기 기록 없음");expect(page).not.toContain("NaN");
 });
 it("actual archived/sample multi-use source shows flags and missing rights without approval claims",()=>{
  const service=timelineService(handle),state=service.state(P),old=structuredClone(state.timeline!);if(old.schemaVersion!==2)throw new Error("Expected s9 v2");const voice=old.audio.find(clip=>clip.assetId===ids.voice)!;
  service.save(P,revision(),state.current!.id,{...old,audio:[...old.audio,{...voice,id:"01a1e8a4-0000-7000-8000-000000000099",role:"effect"}],audioRights:old.audioRights.map((item:{assetId:string})=>item.assetId===ids.voice?{assetId:ids.voice,sourceUrl:null,planName:null,createdOn:null,licenseNote:null}:item)});
  handle.sqlite.prepare("UPDATE assets SET is_mock=1,archived_at=? WHERE id=?").run("2026-11-17T12:00:00Z",ids.voice);approve();
  const value=data(),page=text(markup(value));expect(page).toContain("목소리 · 효과음 · 클립 2개");expect(page).toContain("보관한 원본");expect(page).toContain("샘플");expect(page).toContain("권리 기록 없음 · 직접 확인 필요");
 });
 it("actual stored ZIP history remains distinct from current preview and existence is not fresh integrity",async()=>{
  approve();const request=exportService(handle).request(P,revision());await runNextJob(handle,{now:()=>time,sleep:async ms=>{time+=ms;}});
  handle.sqlite.prepare("UPDATE projects SET content_revision=content_revision+1 WHERE id=?").run(P);
  const value=data(),html=markup(value),page=text(html);expect(value.rows.find(row=>row.id===request.id)).toMatchObject({status:"succeeded",available:true});
  expect(page).toContain("지금 내용과 다름");expect(page).toContain("만들 때 기록한 ZIP 해시");expect(page).toContain("현재 무결성 재검사 결과가 아니에요");expect(html).toContain(`/api/exports/${request.id}`);
 });
 it("real review gate and preview-not-ready stay disabled; malformed/local-path failure text is omitted",()=>{
  const html=markup();expect(html).toMatch(/<button[^>]*disabled=""[^>]*>현재 내용 r/);
  const value=data();const injected:ExportsData={...value,canCreate:true,preview:{ready:false,reason:"기획을 승인하면 미리 볼 수 있어요."},rows:[{id:"f",revision:1,status:"failed",jobId:"j",jobStatus:"failed",error:"D:/private/source.wav",errorCode:"EXPORT_INVALID",retryable:false,createdAt:"2026-11-17T00:00:00Z",completedAt:null,available:false,isMock:null,fileCount:0,sha256:null,fileName:null,sizeBytes:null}]};
  const rendered=markup(injected);expect(rendered).not.toContain("D:/private");expect(rendered).toMatch(/<button[^>]*disabled=""[^>]*>현재 내용으로 새로 만들기/);
 });
});
