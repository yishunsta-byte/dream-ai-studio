import { z } from "zod";

const text = z.string().trim().min(1, "빈 값은 사용할 수 없습니다");
const id = text.regex(/^[a-z][a-zA-Z0-9.-]*$/, "영문 소문자로 시작하는 ID가 필요합니다");
const inputType = z.enum(["text", "textarea", "url", "number", "select", "multiselect", "date", "datetime", "checkbox", "assets", "characters"]);
const phase = z.enum(["P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]);
const labeled = { id, label: text };
// 관리형 생성 서버·DB 정책(managed-project-core 0003)과 같은 두 분야만 활성화한다.
const activeMenuPhases = new Map([["shopping-shorts", "P1"], ["topic-shorts", "P2"]]);
const input = z.strictObject({
  ...labeled, type: inputType, required: z.boolean(), help: text.optional(),
  maxLength: z.number().int().positive().optional(),
  min: z.number().nonnegative().optional(), max: z.number().nonnegative().optional(),
  options: z.array(text).min(1).optional(),
  accept: z.array(z.enum(["image", "video", "audio", "doc"])).min(1).optional(),
  // 비워 두면 서버가 적용하는 선택 값(select만). 화면은 같은 값을 처음 선택으로 보여 준다.
  default: text.optional(),
}).superRefine((value, ctx) => {
  if (value.default !== undefined && (value.type !== "select" || !value.options?.includes(value.default))) {
    ctx.addIssue({ code: "custom", path: ["default"], message: "기본값은 선택 항목 목록 중 하나여야 합니다" });
  }
  if (["select", "multiselect"].includes(value.type) && !value.options) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "선택 항목 목록이 필요합니다" });
  }
  if (value.min !== undefined && value.max !== undefined && value.min > value.max) {
    ctx.addIssue({ code: "custom", path: ["max"], message: "최댓값은 최솟값 이상이어야 합니다" });
  }
  if (value.options && new Set(value.options).size !== value.options.length) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "선택 항목이 중복되었습니다" });
  }
});
const review = z.strictObject({ ...labeled, required: z.boolean(), auto: z.enum(["ffprobe", "is_mock", "db"]).optional() });
const menu = z.strictObject({
  ...labeled, group: id, phase, availability: z.enum(["active", "skeleton", "planned"]),
  description: text, source: z.array(text).min(1),
  defaultAspect: z.enum(["9:16", "16:9", "1:1"]), defaultLengthSec: z.number().int().nonnegative(),
  // 고를 수 있는 목표 길이(초). 있으면 서버 입력 검증과 화면이 이 목록만 쓴다. 없는 분야(기존 쇼핑숏츠·저장된 스냅샷)는 공통 범위를 그대로 쓴다.
  lengthOptions: z.array(z.number().int().positive()).min(1).optional(),
  inputs: z.array(input),
  planSteps: z.array(z.strictObject({ ...labeled, help: text.optional() })).min(1),
  reviseOptions: z.array(z.strictObject(labeled)).min(1),
  review: z.array(review).min(1),
  outputs: z.array(z.strictObject({ ...labeled, format: text.optional() })).min(1),
  unconfirmed: z.array(text),
});

export const menusSchema = z.strictObject({
  schemaVersion: z.literal(1), templateVersion: text, source: text,
  stages: z.array(z.strictObject({ ...labeled, gate: z.boolean() })).length(7),
  inputTypes: z.array(inputType).min(1), commonInputs: z.array(input).min(1),
  commonReview: z.array(review).min(1),
  conditionalReview: z.array(z.strictObject({ ...labeled, when: id, required: z.boolean() })),
  groups: z.array(z.strictObject({ ...labeled, order: z.number().int().positive() })).min(1),
  menus: z.array(menu).min(1),
  workspaces: z.array(z.strictObject({
    ...labeled, phase: z.literal("P8"), availability: z.literal("separate-project"),
    description: text, notDoing: z.array(text).min(1),
  })),
}).superRefine((value, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const unique = (items: { id: string }[], path: (string | number)[], initial: string[] = []) => {
    const seen = new Set(initial);
    items.forEach((item, index) => {
      if (seen.has(item.id)) issue([...path, index, "id"], "ID가 중복되었습니다");
      seen.add(item.id);
    });
  };
  for (const key of ["stages", "commonInputs", "commonReview", "conditionalReview", "groups", "menus", "workspaces"] as const) {
    unique(value[key], [key]);
  }
  unique(value.workspaces, ["workspaces"], value.menus.map((item) => item.id));
  unique(value.conditionalReview, ["conditionalReview"], value.commonReview.map((item) => item.id));
  const expectedStages = ["intake", "brief", "plan", "produce", "edit", "review", "export"];
  value.stages.forEach((stage, index) => {
    if (stage.id !== expectedStages[index]) issue(["stages", index, "id"], "공통 제작 단계의 순서가 올바르지 않습니다");
    if (stage.gate !== ["plan", "review"].includes(stage.id)) issue(["stages", index, "gate"], "기획과 검수에만 승인 게이트가 필요합니다");
  });
  if (new Set(value.inputTypes).size !== value.inputTypes.length) issue(["inputTypes"], "입력 종류가 중복되었습니다");
  const orders = new Set<number>();
  value.groups.forEach((group, index) => {
    if (orders.has(group.order)) issue(["groups", index, "order"], "그룹 순서가 중복되었습니다");
    orders.add(group.order);
  });
  value.conditionalReview.forEach((item, index) => {
    if (!value.commonInputs.some((field) => field.id === item.when && field.type === "checkbox")) {
      issue(["conditionalReview", index, "when"], "공통 체크박스 입력을 참조해야 합니다");
    }
  });
  value.menus.forEach((item, index) => {
    const base = ["menus", index];
    if (!value.groups.some((group) => group.id === item.group)) issue([...base, "group"], "존재하지 않는 그룹입니다");
    if (item.availability === "active" && activeMenuPhases.get(item.id) !== item.phase) {
      issue([...base, "availability"], "현재 단계에서는 쇼핑숏츠(P1)와 주제별 쇼츠(P2)만 활성화할 수 있습니다");
    }
    if (item.lengthOptions) {
      const length = value.commonInputs.find((field) => field.id === "lengthSec");
      const sorted = item.lengthOptions.every((sec, at) => at === 0 || item.lengthOptions![at - 1] < sec);
      const inRange = item.lengthOptions.every((sec) => (length?.min ?? 0) <= sec && sec <= (length?.max ?? Infinity));
      if (!sorted || !inRange) issue([...base, "lengthOptions"], "길이 선택지는 겹치지 않게 오름차순이고 공통 길이 범위 안이어야 합니다");
      if (!item.lengthOptions.includes(item.defaultLengthSec)) issue([...base, "defaultLengthSec"], "기본 길이는 길이 선택지 중 하나여야 합니다");
    }
    const messageLength = item.inputs.findIndex((field) => field.id === "keyMessageLength");
    if (messageLength >= 0) {
      // 핵심 메시지 글자 수 선택: 숫자 문자열 목록이고, 가장 큰 값이 핵심 메시지의 최대 길이와 같아야 한다.
      const limits = item.inputs[messageLength].options ?? [];
      const message = item.inputs.find((field) => field.id === "keyMessage");
      if (item.inputs[messageLength].type !== "select" || !limits.every((limit) => /^[1-9]\d*$/.test(limit)) ||
        message?.maxLength !== Math.max(...limits.map(Number))) {
        issue([...base, "inputs", messageLength], "핵심 메시지 글자 수 선택지는 숫자이고 가장 큰 값이 핵심 메시지 최대 길이와 같아야 합니다");
      }
    }
    unique(item.inputs, [...base, "inputs"], value.commonInputs.map((field) => field.id));
    unique(item.review, [...base, "review"], [...value.commonReview, ...value.conditionalReview].map((field) => field.id));
    for (const key of ["planSteps", "reviseOptions", "outputs"] as const) unique(item[key], [...base, key]);
    item.inputs.forEach((field, fieldIndex) => {
      if (!value.inputTypes.includes(field.type)) issue([...base, "inputs", fieldIndex, "type"], "등록되지 않은 입력 종류입니다");
    });
  });
  value.commonInputs.forEach((field, index) => {
    if (!value.inputTypes.includes(field.type)) issue(["commonInputs", index, "type"], "등록되지 않은 입력 종류입니다");
  });
});

export type MenuConfig = z.infer<typeof menusSchema>;
export type Menu = MenuConfig["menus"][number];
