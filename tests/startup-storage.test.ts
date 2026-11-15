import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { checkProviderStartup, checkStorageStartup } from "@/lib/services/startup";

const temporary: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporary.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("임시 폴더 밖 정리 금지");
    rmSync(root, { recursive:true, force:true });
  }
});
function useTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "dream-ai-startup-"));
  temporary.push(root);
  vi.spyOn(process, "cwd").mockReturnValue(root);
  return root;
}
describe("실제 저장 폴더 점검", () => {
  it("샘플 설정 누락·잘못된 확률을 한글로 표시하고 유효 설정만 통과한다",()=>{
    const root=useTemporaryRoot();expect(checkProviderStartup().status).toBe("fail");expect(JSON.stringify(checkProviderStartup())).not.toContain(root);mkdirSync(join(root,"config"));const config={schemaVersion:1,mock:{image:"i",video:"v",speech:"s",text:"t"},manualQa:{randomFailureEnabled:false,failureRate:2}};writeFileSync(join(root,"config/providers.json"),JSON.stringify(config));expect(checkProviderStartup().status).toBe("fail");config.manualQa.failureRate=0.1;writeFileSync(join(root,"config/providers.json"),JSON.stringify(config));expect(checkProviderStartup().status).toBe("pass");
  });
  it("새 폴더를 준비하고 쓰기 검사 파일을 남기지 않는다", () => {
    const root=useTemporaryRoot();
    expect(checkStorageStartup().canStart).toBe(true);
    for (const folder of ["data","storage","backups"]) expect(readdirSync(join(root,folder))).toEqual([]);
  });
  it("폴더 자리에 파일이 있으면 덮어쓰지 않고 시작을 차단한다", () => {
    const root=useTemporaryRoot();
    writeFileSync(join(root,"data"),"preserve");
    const result=checkStorageStartup();
    expect(result.canStart).toBe(false);
    expect(result.checks.find((check)=>check.id === "data")?.status).toBe("fail");
    expect(JSON.stringify(result)).not.toContain(root);
  });
});
