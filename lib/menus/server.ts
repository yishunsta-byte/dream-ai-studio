import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMenuConfig, type MenuConfigState } from "./parse";

let state: MenuConfigState | undefined;

/** 서버 시작 시 검증하며, 실패하면 설정 오류 화면만 표시한다. */
export function getMenuConfigState(): MenuConfigState {
  if (state) return state;
  try {
    state = parseMenuConfig(readFileSync(join(process.cwd(), "docs/spec/menus.json"), "utf8"));
  } catch {
    state = { ok: false, issues: [{ path: "docs/spec/menus.json", message: "메뉴 설정을 읽을 수 없습니다. 파일과 읽기 권한을 확인해 주세요." }] };
  }
  return state;
}

export function getMenuConfig() {
  const result = getMenuConfigState();
  if (!result.ok) throw new Error("메뉴 설정 오류로 작업을 시작할 수 없습니다");
  return structuredClone(result.config);
}
