import { lstat, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

// 고정 FFmpeg 묶음의 lib에서 도구가 찾는 이름(libavcodec.so.62 등)은 모두 바로가기(심볼릭 링크)다.
// 운영 함수에 실릴 때 바로가기가 깨지면 도구가 공유 라이브러리를 못 찾고 바로 끝난다.
// 실제 파일(libavcodec.so.62.28.103)을 도구가 찾는 이름으로 옮기고 남은 바로가기는 지운다. 용량은 그대로다.
const VERSIONED = /^(lib[a-z0-9_]+\.so\.\d+)(?:\.\d+)+$/;

export async function flattenLibraryLinks(lib) {
  const kept = [];
  for (const name of await readdir(lib)) {
    const match = VERSIONED.exec(name);
    if (!match || (await lstat(join(lib, name))).isSymbolicLink()) continue;
    await rm(join(lib, match[1]), { force: true });
    await rename(join(lib, name), join(lib, match[1]));
    kept.push(match[1]);
  }
  for (const name of await readdir(lib)) {
    if ((await lstat(join(lib, name))).isSymbolicLink()) await rm(join(lib, name));
  }
  if (!kept.length) throw new Error("The reference-analysis libraries were not found.");
  return kept.sort();
}
