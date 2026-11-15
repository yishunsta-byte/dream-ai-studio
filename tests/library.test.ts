import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v7 } from "uuid";
vi.mock("server-only",()=>({}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase } from "@/lib/db/migrate";
import { assets, projectAssets, projects } from "@/lib/db/schema";
import { libraryService } from "@/lib/services/library";
let handle:DatabaseHandle,root:string,id:string;
beforeEach(()=>{handle=openDatabase(":memory:");migrateDatabase(handle.sqlite);root=mkdtempSync(join(tmpdir(),"dream-ai-library-"));mkdirSync(join(root,"storage/library"),{recursive:true});id=v7();writeFileSync(join(root,`storage/library/${id}.png`),"fixture");handle.db.insert(assets).values({id,title:"샘플 원본",kind:"image",role:"original",origin:"upload",filePath:`library/${id}.png`,mime:"image/png",sha256:"a".repeat(64),sizeBytes:7,isMock:true}).run();vi.spyOn(process,"cwd").mockReturnValue(root);});
afterEach(()=>{vi.restoreAllMocks();handle.close();if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw new Error("임시 경로 오류");rmSync(root,{recursive:true,force:true});});
describe("자료·캐릭터 보관함",()=>{
 it("링크는 네트워크 요청 없이 메타데이터만 저장한다",()=>{
   const fetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("must not fetch"));const service=libraryService(handle);const link=service.link({title:"샘플 링크",sourceUrl:"https://example.com/product",rightsNote:"출처 확인 필요"});
   expect(fetch).not.toHaveBeenCalled();expect(service.asset(link)).toMatchObject({kind:"link",filePath:null,sourceUrl:"https://example.com/product"});
   expect(()=>service.link({title:"거절",sourceUrl:"file:///private"})).toThrow();
 });
 it("보관·복원은 원본 파일과 프로젝트 참조를 유지한다",()=>{
   const projectId=v7();handle.db.insert(projects).values({id:projectId,title:"샘플",menuId:"shopping-shorts",templateVersion:"test",templateSnapshotJson:"{}",inputsJson:"{}",goal:"샘플",target:"샘플",aspect:"9:16",lengthSec:30}).run();handle.db.insert(projectAssets).values({projectId,assetId:id,purpose:"input"}).run();
   const service=libraryService(handle);service.archive("asset",id);expect(service.list().assets[0]).toMatchObject({archived:true,usageCount:1});expect(existsSync(join(root,`storage/library/${id}.png`))).toBe(true);expect(handle.db.select().from(projectAssets).all()).toHaveLength(1);
   service.archive("asset",id,false);expect(service.list().assets[0].archived).toBe(false);
 });
 it("고정 설정을 저장하며 참조 없는 확인됨과 잘못된 참조를 거부한다",()=>{
   const service=libraryService(handle);const locked=Object.fromEntries(["face","outfit","hair","accessories","body","voice"].map((key)=>[key,{locked:key==="face",note:key==="face"?"샘플 참조 기준":""}]));const input={name:"샘플 캐릭터",description:"가상의 검증용 캐릭터",locked,refAssetIds:[id],confirmed:true};
   const characterId=service.character(input);expect(service.list().characters[0]).toMatchObject({id:characterId,status:"confirmed",locked:{face:{locked:true,note:"샘플 참조 기준"}}});
   expect(()=>service.character({...input,refAssetIds:[]})).toThrow();expect(()=>service.character({...input,refAssetIds:[v7()]})).toThrow();
   service.archive("character",characterId);expect(service.list().characters[0].archived).toBe(true);service.archive("character",characterId,false);expect(service.list().characters[0].archived).toBe(false);
 });
});
