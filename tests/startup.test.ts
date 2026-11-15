import { describe, expect, it } from "vitest";
import { canStart } from "@/lib/domain/startup";

describe("시작 점검 게이트", () => {
  it("쓰기 실패가 하나라도 있거나 점검 결과가 없으면 차단한다", () => {
    expect(canStart([])).toBe(false);
    expect(canStart([{ id:"data",label:"저장",status:"pass",message:"가능" },{id:"storage",label:"자료",status:"fail",message:"권한 없음"}])).toBe(false);
  });
  it("디스크 경고는 작업 시작을 막지 않는다", () => {
    expect(canStart([{id:"data",label:"저장",status:"pass",message:"가능"},{id:"disk",label:"용량",status:"warning",message:"공간 확보 필요"}])).toBe(true);
  });
});
