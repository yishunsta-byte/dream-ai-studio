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
  it("기준 템플릿의 16개 분야에 주제별 쇼츠를 더한 17개 분야·2개 업무공간과 공통 단계를 보존한다", () => {
    const result = parseMenuConfig(source);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.config.menus).toHaveLength(17);
    expect(result.config.workspaces).toHaveLength(2);
    expect(result.config.menus.filter((menu) => menu.availability === "active").map((menu) => menu.id)).toEqual(["shopping-shorts", "topic-shorts"]);
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
    const travel = data.menus.findIndex((menu: { id: string }) => menu.id === "travel-shorts");
    data.menus[travel].availability = "active";
    expect(paths(data)).toEqual(expect.arrayContaining(["menus.json.stages[2].gate", "menus.json.conditionalReview[0].when", `menus.json.menus[${travel}].availability`]));
  });

  it("주제별 쇼츠는 주제·핵심 메시지 필수, 핵심 메시지 글자 수·이미지/영상 자료 선택, 기본 9:16·30초로 정의한다", () => {
    const result = parseMenuConfig(source);
    if (!result.ok) throw new Error("기준 템플릿 파싱 실패");
    const topical = result.config.menus.find((menu) => menu.id === "topic-shorts")!;
    expect(topical).toMatchObject({ group: "shortform", phase: "P2", availability: "active", defaultAspect: "9:16", defaultLengthSec: 30 });
    expect(topical.lengthOptions).toEqual([10, 20, 30, 40, 50, 60]);
    expect(result.config.menus.find((menu) => menu.id === "shopping-shorts")!.lengthOptions).toBeUndefined();
    expect(topical.inputs.map(({ id, type, required, maxLength, accept, options, default: initial }) => ({ id, type, required, maxLength, accept, options, initial }))).toEqual([
      { id: "topic", type: "text", required: true, maxLength: 80, accept: undefined, options: undefined, initial: undefined },
      { id: "keyMessageLength", type: "select", required: false, maxLength: undefined, accept: undefined, options: ["50", "100", "200", "300"], initial: "100" },
      { id: "keyMessage", type: "textarea", required: true, maxLength: 300, accept: undefined, options: undefined, initial: undefined },
      { id: "referenceAssets", type: "assets", required: false, maxLength: undefined, accept: ["image", "video"], options: undefined, initial: undefined },
    ]);
    // 공통 입력(제목·목표·대상·비율·길이)은 그대로 쓰고, 쇼핑 전용 상품·권리 요구는 일반 쇼츠에 없다.
    expect(topical.inputs.some((field) => ["productName", "productAssets", "usageRights", "facts", "factSources"].includes(field.id))).toBe(false);
    expect(result.config.menus.flatMap((menu) => menu.inputs).filter((field) => field.default !== undefined).map((field) => field.id)).toEqual(["keyMessageLength"]);
    const shopping = result.config.menus.find((menu) => menu.id === "shopping-shorts")!;
    expect(shopping.inputs.filter((field) => field.required).map((field) => field.id)).toEqual(["productName", "productAssets", "facts", "usageRights"]);
  });

  it("길이 선택지는 오름차순·공통 범위 안이고 기본 길이를 포함해야 한다", () => {
    const data = fixture();
    const topical = data.menus.findIndex((menu: { id: string }) => menu.id === "topic-shorts");
    data.menus[topical].lengthOptions = [20, 10, 7201];
    data.menus[topical].defaultLengthSec = 45;
    expect(paths(data)).toEqual(expect.arrayContaining([`menus.json.menus[${topical}].lengthOptions`, `menus.json.menus[${topical}].defaultLengthSec`]));
  });

  it("기본값은 선택지 안이어야 하고 핵심 메시지 글자 수 선택지는 숫자이며 최대값이 핵심 메시지 상한과 같아야 한다", () => {
    const data = fixture();
    const topical = data.menus.findIndex((menu: { id: string }) => menu.id === "topic-shorts");
    const inputs = data.menus[topical].inputs;
    inputs[1].default = "150";
    expect(paths(data)).toContain(`menus.json.menus[${topical}].inputs[1].default`);
    inputs[1].default = "100";
    inputs[1].options = ["50", "100", "two hundred"];
    expect(paths(data)).toContain(`menus.json.menus[${topical}].inputs[1]`);
    inputs[1].options = ["50", "100", "200"];
    expect(paths(data)).toContain(`menus.json.menus[${topical}].inputs[1]`);
  });

  it("활성 분야는 쇼핑숏츠(P1)와 주제별 쇼츠(P2)뿐이며 단계가 다르면 거부한다", () => {
    const data = fixture();
    const topical = data.menus.findIndex((menu: { id: string }) => menu.id === "topic-shorts");
    data.menus[topical].phase = "P1";
    data.menus[0].phase = "P2";
    expect(paths(data)).toEqual(expect.arrayContaining(["menus.json.menus[0].availability", `menus.json.menus[${topical}].availability`]));
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
