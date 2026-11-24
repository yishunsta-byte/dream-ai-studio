import {describe,expect,it} from "vitest";
import {sceneIntervals,subtitleSceneLabel} from "@/lib/edit/subtitle-scenes";

const video=[{sceneId:"a",durationFrames:60},{sceneId:"b",durationFrames:30}];
const titles=new Map([["a","소개"],["b","사용"]]);
const scenes=sceneIntervals(video,titles);

describe("자막의 장면 범위",()=>{
  it.each([
    [0,60,"장면 1 · 소개"],[60,90,"장면 2 · 사용"],
    [59,61,"장면 1 · 소개 ~ 장면 2 · 사용"],
    [89,91,"장면 2 · 사용 ~ 장면 밖"],[90,91,"장면 밖"],
  ])("%i~%i 프레임", (start,end,label)=>{
    expect(subtitleSceneLabel(scenes,{startFrame:Number(start),endFrame:Number(end)})).toBe(label);
  });
  it("초안 장면 순서를 따르고 제목이 없어도 번호를 표시한다",()=>{
    const reordered=sceneIntervals([...video].reverse(),new Map([["a","소개"]]));
    expect(subtitleSceneLabel(reordered,{startFrame:0,endFrame:30})).toBe("장면 1");
    expect(subtitleSceneLabel(reordered,{startFrame:30,endFrame:60})).toBe("장면 2 · 소개");
    expect(sceneIntervals(video,new Map([["a"," 장면 1 "]]))[0].description).toBe("장면 1");
    expect(subtitleSceneLabel([],{startFrame:0,endFrame:30})).toBe("장면 밖");
  });
});
