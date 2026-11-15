import "server-only";
import { getTableName } from "drizzle-orm";
import { v7 } from "uuid";
import type { MenuConfig } from "@/lib/menus/schema";
import type { DatabaseHandle } from "./connection";
import { projects, stageStates } from "./schema";
import * as tables from "./schema";
import { encodeJson, jsonObject } from "./json";

export function seedDatabase(handle: DatabaseHandle, config: MenuConfig) {
  return handle.sqlite.transaction(()=>{
    for(const table of Object.values(tables)) {
      const tableName=getTableName(table);
      if(handle.sqlite.prepare(`SELECT 1 FROM "${tableName}" LIMIT 1`).get()) return {inserted:0,reason:"기존 데이터가 있어 샘플을 추가하지 않았어요."};
    }
    const menu=config.menus.find((item)=>item.id==="shopping-shorts");
    if(!menu || menu.availability!=="active") throw new Error("쇼핑숏츠 템플릿을 확인해 주세요.");
    const id=v7();
    const now=new Date().toISOString();
    handle.db.insert(projects).values({
      id, menuId:menu.id,templateVersion:config.templateVersion,
      templateSnapshotJson:encodeJson(jsonObject,{schemaVersion:config.schemaVersion,templateVersion:config.templateVersion,stages:config.stages,commonInputs:config.commonInputs,commonReview:config.commonReview,conditionalReview:config.conditionalReview,menu}),
      inputsJson:encodeJson(jsonObject,{title:"[샘플] 첫 쇼핑숏츠",goal:"샘플 제품을 소개해요",target:"짧은 제품 소개를 보는 사람",aspect:"9:16",lengthSec:30,productName:"샘플 텀블러",facts:"사용자가 확인할 샘플 장점",isSample:true}),
      title:"[샘플] 첫 쇼핑숏츠",goal:"샘플 제품을 소개해요",target:"짧은 제품 소개를 보는 사람",aspect:"9:16",lengthSec:30,createdAt:now,updatedAt:now,
    }).run();
    handle.db.insert(stageStates).values(config.stages.map((stage,index)=>({projectId:id,stage:stage.id,status:index===0?"todo":"locked"}))).run();
    return {inserted:1,reason:"샘플 프로젝트를 추가했어요. 승인이나 생성은 실행하지 않았어요."};
  }).immediate();
}
