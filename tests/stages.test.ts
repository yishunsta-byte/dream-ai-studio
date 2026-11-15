import { describe, expect, it } from "vitest";
import { assertRevision, invalidateContent, nextVersion, projectDisplayState, stageOrder, transitionStage, type StageState } from "@/lib/domain/stages";

const approved=():StageState[]=>stageOrder.map((stage)=>({stage,status:"approved"}));
describe("제작 단계 순수 규칙",()=>{
 it.each(stageOrder)("%s의 열기·시작·실패·재시도를 검증한다",(stage)=>{
   const states=approved();
   expect(transitionStage(stage,"locked","unlock",states,"system")).toBe("todo");
   expect(transitionStage(stage,"todo","start",states,"user")).toBe("in_progress");
   expect(transitionStage(stage,"in_progress","fail",states,"system")).toBe("failed");
   expect(transitionStage(stage,"failed","retry",states,"user")).toBe("in_progress");
   expect(()=>transitionStage(stage,"approved","start",states,"user")).toThrow();
 });
 it.each(stageOrder.slice(1))("%s는 이전 단계 승인 없이는 시작하지 못한다",(stage)=>{
   for(const previous of ["locked","todo","in_progress","needs_approval","failed"] as const){
     const states=approved();states[stageOrder.indexOf(stage)-1].status=previous;
     expect(()=>transitionStage(stage,"todo","start",states,"user")).toThrow();
   }
 });
 it.each(["plan","review"] as const)("%s는 자동 완료·자동 승인을 거부한다",(stage)=>{
   expect(()=>transitionStage(stage,"in_progress","complete",approved(),"system")).toThrow();
   expect(()=>transitionStage(stage,"needs_approval","approve",approved(),"system")).toThrow();
   expect(transitionStage(stage,"in_progress","request_approval",approved(),"user")).toBe("needs_approval");
   expect(transitionStage(stage,"needs_approval","approve",approved(),"user")).toBe("approved");
 });
 it("내용 변경 지점 이후만 무효화하며 입력을 변경하지 않는다",()=>{
   const states=approved();const next=invalidateContent(states,"edit");
   expect(next.slice(0,4).every((state)=>state.status==="approved")).toBe(true);
   expect(next.slice(4).map((state)=>state.status)).toEqual(["in_progress","locked","locked"]);
   expect(states.every((state)=>state.status==="approved")).toBe(true);
 });
 it("동시 변경과 잘못된 버전 번호를 거부한다",()=>{
   expect(()=>assertRevision(1,2)).toThrow();expect(()=>assertRevision(NaN,1)).toThrow();
   expect(nextVersion([])).toBe(1);expect(nextVersion([1,4,2])).toBe(5);expect(()=>nextVersion([1.5])).toThrow();
 });
 it("프로젝트 표시 상태는 단계와 작업에서 계산한다",()=>{
   expect(projectDisplayState(approved(),["failed"])).toBe("warning");
   expect(projectDisplayState(approved(),["running"])).toBe("running");
   expect(projectDisplayState(approved(),[])).toBe("done");
   const states=approved();states[2].status="needs_approval";expect(projectDisplayState(states,[])).toBe("approval");
 });
});
