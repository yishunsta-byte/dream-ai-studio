import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));
const read = vi.mocked(readFileSync);

beforeEach(() => {
  vi.resetModules();
  read.mockReset();
});

describe("메뉴 시작 점검", () => {
  it("정상 설정은 한 번 읽고 호출자에게 독립된 복사본을 제공한다", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    read.mockReturnValue(actual.readFileSync(new URL("../docs/spec/menus.json", import.meta.url), "utf8"));
    const { getMenuConfig } = await import("@/lib/menus/server");
    const first = getMenuConfig();
    const original = first.menus[0].label;
    first.menus[0].label = "변경";
    expect(getMenuConfig().menus[0].label).toBe(original);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("읽기 실패는 내부 경로를 노출하지 않고 작업 접근을 차단한다", async () => {
    read.mockImplementation(() => { throw new Error("secret absolute path"); });
    const { getMenuConfigState, getMenuConfig } = await import("@/lib/menus/server");
    expect(getMenuConfigState()).toMatchObject({ ok: false });
    expect(JSON.stringify(getMenuConfigState())).not.toContain("secret absolute path");
    expect(() => getMenuConfig()).toThrow("메뉴 설정 오류");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("오류 설정을 정상 값으로 대신하지 않고 재시작 전까지 실패를 유지한다", async () => {
    read.mockReturnValue('{"schemaVersion":99}');
    const { getMenuConfigState, getMenuConfig } = await import("@/lib/menus/server");
    expect(getMenuConfigState()).toMatchObject({ ok: false });
    expect(() => getMenuConfig()).toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
