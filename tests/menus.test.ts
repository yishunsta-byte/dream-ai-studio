import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMenuConfig } from "@/lib/menus/parse";

const source = readFileSync(new URL("../docs/spec/menus.json", import.meta.url), "utf8");
const fixture = () => JSON.parse(source);
const paths = (value: unknown) => {
  const result = parseMenuConfig(JSON.stringify(value));
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.issues.map((issue) => issue.path);
};

describe("메뉴 설정", () => {
  it("기준 템플릿의 16개 분야·2개 업무공간과 공통 단계를 보존한다", () => {
    const result = parseMenuConfig(source);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.config.menus).toHaveLength(16);
    expect(result.config.workspaces).toHaveLength(2);
    expect(result.config.menus.filter((menu) => menu.availability === "active").map((menu) => menu.id)).toEqual(["shopping-shorts"]);
    expect(result.config).toEqual(fixture());
  });

  it("지원하지 않는 스키마 버전과 누락 필드의 위치를 표시한다", () => {
    const data = fixture();
    data.schemaVersion = 2;
    delete data.menus[0].label;
    expect(paths(data)).toEqual(expect.arrayContaining(["menus.json.schemaVersion", "menus.json.menus[0].label"]));
  });

  it("분야 ID·그룹 참조·입력 ID 충돌을 거부한다", () => {
    const data = fixture();
    data.menus[1].id = data.menus[0].id;
    data.menus[0].group = "missing";
    data.menus[0].inputs[0].id = data.commonInputs[0].id;
    expect(paths(data)).toEqual(expect.arrayContaining(["menus.json.menus[1].id", "menus.json.menus[0].group", "menus.json.menus[0].inputs[0].id"]));
  });

  it("선택 목록 누락·뒤집힌 범위·잘못된 입력 종류를 거부한다", () => {
    const data = fixture();
    delete data.commonInputs.find((field: { id: string }) => field.id === "aspect").options;
    data.commonInputs.find((field: { id: string }) => field.id === "lengthSec").max = 1;
    data.menus[0].inputs[0].type = "unknown";
    expect(paths(data)).toContain("menus.json.menus[0].inputs[0].type");
    data.menus[0].inputs[0].type = "text";
    expect(paths(data)).toEqual(expect.arrayContaining(["menus.json.commonInputs[3].options", "menus.json.commonInputs[4].max"]));
  });

  it("승인 게이트 변경·잘못된 검수 조건·준비 분야 활성화를 거부한다", () => {
    const data = fixture();
    data.stages[2].gate = false;
    data.conditionalReview[0].when = "title";
    data.menus[1].availability = "active";
    expect(paths(data)).toEqual(expect.arrayContaining(["menus.json.stages[2].gate", "menus.json.conditionalReview[0].when", "menus.json.menus[1].availability"]));
  });

  it("검수 ID 충돌·업무공간 충돌·그룹 순서 중복을 거부한다", () => {
    const data = fixture();
    data.menus[0].review[0].id = data.commonReview[0].id;
    data.workspaces[0].id = data.menus[0].id;
    data.groups[1].order = data.groups[0].order;
    expect(paths(data)).toEqual(expect.arrayContaining(["menus.json.menus[0].review[0].id", "menus.json.workspaces[0].id", "menus.json.groups[1].order"]));
  });

  it("JSON 문법 오류는 위치를 표시하고 입력 내용은 노출하지 않는다", () => {
    const result = parseMenuConfig('{"private-secret": nope}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].path).toMatch(/^menus\.json(?::1:\d+)?$/);
    expect(JSON.stringify(result)).not.toContain("private-secret");
  });

  it("BOM을 허용하고 파싱 결과 변경이 다음 로드에 전파되지 않는다", () => {
    const first = parseMenuConfig("\uFEFF" + source);
    if (!first.ok) throw new Error("기준 템플릿 파싱 실패");
    first.config.menus[0].label = "변경";
    const second = parseMenuConfig(source);
    expect(second.ok && second.config.menus[0].label).toBe(fixture().menus[0].label);
  });
});
