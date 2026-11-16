import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v7 } from "uuid";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:()=>{},push:()=>{}})}));
import { openDatabase, type DatabaseHandle } from "@/lib/db/connection";
import { migrateDatabase } from "@/lib/db/migrate";
import { assets, projects, scenes } from "@/lib/db/schema";
import { parseMenuConfig } from "@/lib/menus/parse";
import { projectService } from "@/lib/services/projects";
import { planningService } from "@/lib/services/planning";
import { jobsService } from "@/lib/services/jobs";
import { runNextJob } from "@/lib/jobs/runner";
import { productionService } from "@/lib/services/production";
import { ProductionPanel } from "@/components/production-panel";

// Renders the real ProductionPanel to HTML from real service data (no browser).
// Virtual fixtures only: OS temp root and the mock provider, same setup as tests/jobs.test.ts.
const parsed=parseMenuConfig(readFileSync(new URL("../docs/spec/menus.json",import.meta.url),"utf8"));if(!parsed.ok)throw new Error("메뉴 오류");const config=parsed.config;
const providerJson=readFileSync(new URL("../config/providers.json",import.meta.url),"utf8");
let handle:DatabaseHandle,root:string,id:string,sceneId:string,time:number;
const now=()=>time,sleep=async(ms:number)=>{time+=ms;};
const service=()=>jobsService(handle,now),revision=()=>handle.db.select().from(projects).get()!.contentRevision;
const enqueue=(scenario="success",kind="image")=>service().enqueue({projectId:id,sceneId,revision:revision(),kind,scenario});
const render=()=>renderToStaticMarkup(createElement(ProductionPanel,{data:productionService(handle).get(id)}));
// Every failure/wait box is a <section aria-labelledby> whose body has no nested section.
const rejectedBoxes=(html:string)=>[...html.matchAll(/<section aria-labelledby="[^"]+"[^>]*>([\s\S]*?)<\/section>/g)].map(match=>match[1]).filter(body=>body.includes("제공사가 이 장면을 만들 수 없다고 했어요."));
beforeEach(()=>{
 root=mkdtempSync(join(tmpdir(),"dream-t028-"));mkdirSync(join(root,"data"));mkdirSync(join(root,"config"));mkdirSync(join(root,"storage/library"),{recursive:true});writeFileSync(join(root,"config/providers.json"),providerJson);
 mkdirSync(join(root,"public/fonts"),{recursive:true});for(const name of ["PretendardVariable.woff2","OFL.txt"])copyFileSync(new URL(`../public/fonts/${name}`,import.meta.url),join(root,"public/fonts",name));
 handle=openDatabase(join(root,"data/app.db"));migrateDatabase(handle.sqlite);const assetId=v7();writeFileSync(join(root,`storage/library/${assetId}.png`),"fixture");handle.db.insert(assets).values({id:assetId,kind:"image",title:"샘플",role:"original",origin:"upload",filePath:`library/${assetId}.png`,mime:"image/png",sizeBytes:7,sha256:"a".repeat(64),isMock:true,rightsNote:"직접 촬영"}).run();
 vi.spyOn(process,"cwd").mockReturnValue(root);time=Date.now();
 id=projectService(handle,config).create("shopping-shorts",{title:"T028 샘플",goal:"제품 소개",target:"샘플",aspect:"9:16",lengthSec:30,isAd:true,productName:"가상 제품",productAssets:[assetId],facts:"샘플",usageRights:"직접 촬영"});const planning=planningService(handle,config);planning.confirmBrief(id,1,true);const plan=planning.save(id,1,{script:"샘플 대본",scenes:[{stepId:config.menus[0].planSteps[0].id,title:"T028 장면",description:"샘플 설명",dialogue:"샘플 대사",durationSec:3,assetIds:[assetId],characterIds:[]}]});planning.approve(id,plan.id,2);sceneId=handle.db.select().from(scenes).get()!.id;
});
afterEach(()=>{vi.restoreAllMocks();handle.close();if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw new Error("임시 경로 오류");rmSync(root,{recursive:true,force:true});});

describe("버전 비교의 실패 상자 (F-017-1)",()=>{
 it("기본 카드에서 사라진 오래된 거절도 비교 영역에 기획·자료 링크를 남기고 선택 유지·재시도 금지를 지킨다",async()=>{
  enqueue();await runNextJob(handle,{now,sleep});const selected=handle.db.select().from(scenes).get()!.selectedVersionId;
  const rejected=enqueue("fail:CONTENT_REJECTED");await runNextJob(handle,{now,sleep});enqueue();await runNextJob(handle,{now,sleep});
  expect(productionService(handle).get(id).scenes[0].versions.map(version=>version.status)).toEqual(["succeeded","failed","succeeded"]);
  const html=render(),boxes=rejectedBoxes(html);
  expect(boxes).toHaveLength(1);// latest attempt succeeded, so the old rejection lives only in the compare area
  expect(html.indexOf(boxes[0])).toBeGreaterThan(html.indexOf("<details"));
  expect(boxes[0]).toContain(`href="/projects/${id}/plan"`);expect(boxes[0]).toContain(">기획 고치기</a>");expect(boxes[0]).toContain(`href="/library"`);expect(boxes[0]).toContain(">자료 바꾸기</a>");
  expect(boxes[0]).toContain("자동 재시도 안 함");expect(boxes[0]).not.toContain("<button");
  expect(html).not.toContain("다시 시도</button>");expect(html.match(/이 버전으로 되돌리기/g)).toHaveLength(1);// only the unselected success, never the failure
  expect(productionService(handle).get(id).scenes[0].selectedVersionId).toBe(selected);expect(()=>service().retry(rejected.jobId)).toThrow();
 });
 it("최근 시도가 거절이면 기본 카드와 비교 영역 모두 같은 링크를 보인다",async()=>{
  enqueue();await runNextJob(handle,{now,sleep});enqueue("fail:CONTENT_REJECTED");await runNextJob(handle,{now,sleep});
  const html=render(),boxes=rejectedBoxes(html);
  expect(boxes).toHaveLength(2);for(const box of boxes){expect(box).toContain(">기획 고치기</a>");expect(box).toContain(">자료 바꾸기</a>");}
  expect(boxes[0]).toContain("선택한 v1은 그대로예요.");expect(html).not.toContain("다시 시도</button>");
 });
});
