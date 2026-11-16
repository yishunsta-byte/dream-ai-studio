import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync, openSync, closeSync, unlinkSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { canStart, type StartupCheck } from "@/lib/domain/startup";
import { checkDatabase } from "@/lib/db/server";
import { providerConfig } from "@/lib/providers/config";
import { runtimeRoot } from "@/lib/config/runtime";

export function checkProviderStartup():StartupCheck {
 try{providerConfig();return {id:"providers",label:"샘플 제공자 설정",status:"pass",message:"샘플 모델과 시험 설정이 정상이에요."};}
 catch{return {id:"providers",label:"샘플 제공자 설정",status:"fail",message:"config/providers.json 파일과 모델 이름·시험 설정을 확인해 주세요."};}
}

export function checkStorageStartup() {
  const directories = [
    { folder: "data", directory: join(runtimeRoot(), "data") },
    { folder: "storage", directory: join(runtimeRoot(), "storage") },
    { folder: "backups", directory: join(runtimeRoot(), "backups") },
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
    const disk = statfsSync(runtimeRoot());
    const available = disk.bavail * disk.bsize;
    checks.push({ id: "disk", label: "남은 저장 공간", status: available < 5 * 1024 ** 3 ? "warning" : "pass", message: `약 ${Math.floor(available / 1024 ** 3)}GB 남았어요.${available < 5 * 1024 ** 3 ? " 5GB 미만이므로 공간을 확보해 주세요." : ""}` });
  } catch {
    checks.push({ id: "disk", label: "남은 저장 공간", status: "warning", message: "남은 용량을 확인하지 못했어요. 탐색기에서 저장 공간을 확인해 주세요." });
  }
  return { checks, canStart: canStart(checks) };
}

export function checkStartup() {
  const storage = checkStorageStartup();
  // 쓰기 실패 중에는 DB 파일에 접근하지 않는다.
  const database = storage.canStart ? checkDatabase() : {ok:false as const,message:"저장 폴더를 확인한 뒤 데이터베이스를 점검해요."};
  const checks: StartupCheck[] = [...storage.checks, database.ok ? { id:"database",label:"데이터베이스·마이그레이션",status:"pass",message:"적용된 버전과 데이터 참조가 정상이에요." } : { id:"database",label:"데이터베이스·마이그레이션",status:"fail",message:database.message,...("detail" in database&&database.detail?{detail:database.detail}:{}),...("code" in database&&database.code?{code:database.code}:{}) },checkProviderStartup()];
  return { checks, canStart:canStart(checks) };
}
