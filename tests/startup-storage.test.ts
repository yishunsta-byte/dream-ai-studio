import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { checkStorageStartup } from "@/lib/services/startup";

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
