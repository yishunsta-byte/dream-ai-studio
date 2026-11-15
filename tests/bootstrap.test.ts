import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

describe("작업 처리기 시작 점검",()=>{
 it("준비되지 않은 DB에서 작업을 시작하지 않고 안전한 안내와 실패 코드로 종료한다",()=>{
  const root=mkdtempSync(join(tmpdir(),"dream-ai-worker-start-"));
  try{const result=spawnSync(process.execPath,["--conditions=react-server","--import",new URL("../node_modules/tsx/dist/loader.mjs",import.meta.url).href,fileURLToPath(new URL("../worker/main.ts",import.meta.url))],{cwd:root,env:{...process.env,TSX_TSCONFIG_PATH:fileURLToPath(new URL("../tsconfig.json",import.meta.url))},encoding:"utf8",timeout:10000});expect(result.error).toBeUndefined();expect(result.status).toBe(1);expect(result.stderr).toContain("시작 점검을 확인");expect(result.stderr).not.toContain(root);expect(result.stdout).not.toContain("처리기 시작");}finally{if(resolve(root).startsWith(resolve(tmpdir())+sep))rmSync(root,{recursive:true,force:true});}
 });
});
