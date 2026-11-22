import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminStudioReturn, studioContext, studioReturnHref, verifiedScene } from "@/components/admin/admin-studio-return";

const project = "0190f000-0000-7000-8000-00000000a001";
const scene = "0190f000-0000-7000-8000-00000000c001";

describe("P1-06 작업실 → 이미지 분석 문맥", () => {
  it("project·scene이 하나씩이고 UUIDv7일 때만 문맥으로 본다", () => {
    expect(studioContext(`?project=${project}&scene=${scene}`)).toEqual({ projectId: project, sceneId: scene });
    expect(studioContext("")).toBeUndefined();
    expect(studioContext(`?project=${project}`)).toBeUndefined();
    expect(studioContext(`?project=${project}&scene=../../admin`)).toBeUndefined();
    expect(studioContext(`?project=${project}&scene=${scene}&scene=${scene}`)).toBeUndefined();
    expect(studioContext(`?project=${project.toUpperCase()}&scene=${scene}`)).toBeUndefined();
    expect(studioContext(`?project=0190f000-0000-4000-8000-00000000a001&scene=${scene}`)).toBeUndefined();
  });

  it("소유자 제작 응답에 그 장면이 있을 때만 이름을 쓰고, 복귀 주소는 고정 작업실 경로로 만든다", () => {
    const production = { scenes: [{ id: scene, position: 1, title: "제품 정면" }, { id: "x", position: 2, title: "다른" }] };
    const found = verifiedScene({ projectId: project, sceneId: scene }, production);
    expect(found).toEqual({ projectId: project, sceneId: scene, position: 1, title: "제품 정면" });
    expect(studioReturnHref(found!)).toBe(`/cloud/projects/${project}/produce?scene=${scene}`);
    expect(verifiedScene({ projectId: project, sceneId: "0190f000-0000-7000-8000-00000000c009" }, production)).toBeUndefined();
    expect(verifiedScene({ projectId: project, sceneId: scene }, { scenes: [{ id: scene, position: "1", title: "x" }] })).toBeUndefined();
    expect(verifiedScene({ projectId: project, sceneId: scene }, { error: "not_found" })).toBeUndefined();
    expect(verifiedScene({ projectId: project, sceneId: scene }, null)).toBeUndefined();
  });

  it("서버 렌더에서는 아무것도 그리지 않는다(주소 값만으로 이름을 보이지 않음)", () => {
    expect(renderToStaticMarkup(createElement(AdminStudioReturn))).toBe("");
  });
});
