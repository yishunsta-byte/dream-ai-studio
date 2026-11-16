// T-061: timeline API routes (GET reads only, old save-edit is 410) and the A1 regression (T-064): a saved text that
// already ends after the limit is kept while other texts are edited, and is never extended or cut on save.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { v7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase, productMigrations } from "@/lib/db/migrate";
import { readBackupManifest, verifyBackupArchive } from "@/lib/backup/archive";
import { editingService } from "@/lib/services/editing";
import { timelineService } from "@/lib/services/timeline";
import { GET } from "@/app/api/projects/[id]/timeline/route";
import { POST as finishing } from "@/app/api/projects/[id]/finishing/route";
import { S4_ZIP, s4Ids } from "./fixtures/backups/s4-build";
import { snapshotDb } from "./fixtures/backups/s4-compare";

const ids=s4Ids();let root:string;const handles:DatabaseHandle[]=[];
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-p21api-")));});
afterEach(()=>{vi.unstubAllEnvs();for(const handle of handles.splice(0))handle.close();if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});
// A copy of s4 with one more saved P1 subtitle ending at 40 s (after the 30 s project limit), moved to timeline r1.
async function runtime(){
  const manifest=await readBackupManifest(S4_ZIP);await verifyBackupArchive(S4_ZIP,manifest,join(root,"rt"));const file=join(root,"rt","data/app.db");
  const sqlite=new Database(file);try{const snapshot=JSON.parse((sqlite.prepare("SELECT value_json FROM settings WHERE key=?").get(`project.${ids.main}.edit.${ids.edit2}`) as {value_json:string}).value_json),id=v7(),layer=v7();
    sqlite.prepare("INSERT INTO settings(key,value_json) VALUES(?,?)").run(`project.${ids.main}.edit.${id}`,JSON.stringify({...snapshot,layers:[...snapshot.layers,{...snapshot.layers[2],id:layer,content:"긴 자막",startSec:6,endSec:40}]}));
    sqlite.prepare("UPDATE settings SET value_json=? WHERE key=?").run(JSON.stringify(id),`project.${ids.main}.edit.current`);
    sqlite.pragma("foreign_keys = ON");migrateDatabase(sqlite,{migrations:productMigrations()});return {root:join(root,"rt"),file,layer};}finally{sqlite.close();}
}
const params=(id:string)=>({params:Promise.resolve({id})});

describe("타임라인 API",()=>{
  it("GET은 읽기만 하고 프로젝트 원문·행을 내보내지 않는다. 옛 save-edit는 410",async()=>{
    const {root:folder,file}=await runtime();vi.stubEnv("DREAM_DATA_ROOT",folder);const before=(()=>{const s=new Database(file,{readonly:true});try{return snapshotDb(s);}finally{s.close();}})();
    const response=await GET(new Request("http://127.0.0.1/api"),params(ids.main));expect(response.status).toBe(200);const body=await response.json();
    expect(body.result.current).toMatchObject({revision:1,source:"p1-migration"});expect(body.result.project).toBeUndefined();expect(body.result.row).toBeUndefined();expect(body.result.warnings.textBeyondLimit).toHaveLength(1);
    expect((await GET(new Request("http://127.0.0.1/api"),params("not-a-uuid"))).status).toBe(404);
    const old=await finishing(new Request("http://127.0.0.1/api",{method:"POST",body:JSON.stringify({action:"save-edit",revision:5,input:{}})}),params(ids.main));expect(old.status).toBe(410);
    const after=(()=>{const s=new Database(file,{readonly:true});try{return snapshotDb(s);}finally{s.close();}})();expect(after).toEqual(before);
  });
  it("A1: 한도를 넘은 저장 자막은 다른 글자를 고쳐 저장해도 그대로 남고, 고치면 한도 안으로만 저장된다",async()=>{
    const {file,layer}=await runtime(),handle=openDatabase(file,{fileMustExist:true});handles.push(handle);const editing=editingService(handle),timelines=timelineService(handle);
    const data=editing.get(ids.main);expect(data.maxEndSec).toBe(30);expect(data.value.layers.find(item=>item.id===layer)?.endSec).toBe(40);
    const revision=data.revision,saved=editing.save(ids.main,revision,{...data.value,layers:data.value.layers.map(item=>item.id===ids.layer3?{...item,content:"고친 둘째 자막"}:item)});
    expect(saved.revision).toBe(revision+1);const kept=timelines.get(ids.main).timeline!.text.find(item=>item.id===layer)!;expect(kept.timing).toEqual({startFrame:180,endFrame:1200});
    const next=editing.get(ids.main);expect(()=>editing.save(ids.main,next.revision,{...next.value,layers:next.value.layers.map(item=>item.id===layer?{...item,endSec:35}:item)})).toThrow(/30초 안/);
    expect(editing.save(ids.main,next.revision,{...next.value,layers:next.value.layers.map(item=>item.id===layer?{...item,endSec:30}:item)}).revision).toBe(next.revision+1);
    expect(timelines.get(ids.main).timeline!.text.find(item=>item.id===layer)!.timing).toEqual({startFrame:180,endFrame:900});
  });
});
