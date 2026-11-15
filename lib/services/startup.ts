import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync, openSync, closeSync, unlinkSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { canStart, type StartupCheck } from "@/lib/domain/startup";

export function checkStartup() {
  const directories = [
    { folder: "data", directory: join(process.cwd(), "data") },
    { folder: "storage", directory: join(process.cwd(), "storage") },
    { folder: "backups", directory: join(process.cwd(), "backups") },
  ];
  const checks: StartupCheck[] = directories.map(({ folder, directory }) => {
    const probe = join(directory, `.write-check-${randomUUID()}`);
    let created = false;
    try {
      mkdirSync(directory, { recursive: true });
      const handle = openSync(probe, "wx");
      created = true;
      closeSync(handle);
      unlinkSync(probe);
      created = false;
      return { id: folder, label: `${folder} 폴더`, status: "pass", message: "파일을 저장할 수 있어요." };
    } catch {
      return { id: folder, label: `${folder} 폴더`, status: "fail", message: "파일을 저장할 수 없어요. 폴더의 쓰기 권한과 디스크 상태를 확인해 주세요." };
    } finally {
      if (created) { try { unlinkSync(probe); } catch { /* 실패 상태는 위에서 반환한다. */ } }
    }
  });
  try {
    const disk = statfsSync(process.cwd());
    const available = disk.bavail * disk.bsize;
    checks.push({ id: "disk", label: "남은 저장 공간", status: available < 5 * 1024 ** 3 ? "warning" : "pass", message: `약 ${Math.floor(available / 1024 ** 3)}GB 남았어요.${available < 5 * 1024 ** 3 ? " 5GB 미만이므로 공간을 확보해 주세요." : ""}` });
  } catch {
    checks.push({ id: "disk", label: "남은 저장 공간", status: "warning", message: "남은 용량을 확인하지 못했어요. 탐색기에서 저장 공간을 확인해 주세요." });
  }
  return { checks, canStart: canStart(checks) };
}
