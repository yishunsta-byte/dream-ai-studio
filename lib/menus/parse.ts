import { menusSchema, type MenuConfig } from "./schema";

export type MenuConfigIssue = { path: string; message: string };
export type MenuConfigState =
  | { ok: true; config: MenuConfig }
  | { ok: false; issues: MenuConfigIssue[] };

export function parseMenuConfig(raw: string): MenuConfigState {
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    // JSON.parse 메시지의 입력값 조각은 노출하지 않고 줄·열 위치만 사용한다.
    const location = error instanceof Error ? error.message.match(/position (\d+)|line (\d+) column (\d+)/) : null;
    const position = location?.[1] ? Number(location[1]) : null;
    const prefix = position === null ? null : raw.slice(0, position);
    const line = prefix === null ? location?.[2] : prefix.split("\n").length;
    const column = prefix === null ? location?.[3] : prefix.length - prefix.lastIndexOf("\n");
    return { ok: false, issues: [{ path: line ? `menus.json:${line}:${column}` : "menus.json", message: "JSON 문법이 올바르지 않습니다. 쉼표와 따옴표를 확인해 주세요." }] };
  }
  const result = menusSchema.safeParse(data);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.reduce<string>((path, part) => typeof part === "number" ? `${path}[${part}]` : `${path}.${String(part)}`, "menus.json"),
        message: issue.code === "custom" ? issue.message : "필수 항목, 값의 종류 또는 허용 범위를 확인해 주세요.",
      })),
    };
  }
  return { ok: true, config: result.data };
}
