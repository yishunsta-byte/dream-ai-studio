// P2-4b render failure codes (T-101 2.7, T-102 14장). Pure: read by the worker, the jobs service and the routes.
// Retried automatically only by cause: a browser/child crash or a transient storage error (T-105 decision).
export type RenderErrorCode="RENDER_INPUT_MISSING"|"RENDER_INPUT_CHANGED"|"FONT_MISSING"|"RENDER_BROWSER_MISSING"|"RENDER_BROWSER_CRASHED"|"RENDER_VERIFY_FAILED"|"RENDER_FAILED"|"DISK_FULL"|"STORAGE_FAILED"|"TIMEOUT"|"RENDER_INTERRUPTED"|"RENDER_CANCELED";
// The one Korean sentence per code (T-102 14장 wording is the screen's; this is the stored fallback).
export const RENDER_MESSAGES:Record<RenderErrorCode,string>={
  RENDER_INPUT_MISSING:"영상에 쓸 파일이 없어요. 편집 화면에서 장면 결과를 확인해 주세요.",
  RENDER_INPUT_CHANGED:"요청한 뒤 장면 파일이나 글꼴이 바뀌었어요. 편집 화면에서 다시 만들어 주세요.",
  FONT_MISSING:"글자에 쓴 글꼴 파일을 불러오지 못했어요. 글꼴을 확인해 주세요.",
  RENDER_BROWSER_MISSING:"영상 만들기 도구(렌더용 브라우저)가 없거나 설치본이 달라요. 설치 안내를 확인해 주세요.",
  RENDER_BROWSER_CRASHED:"영상 만들기 도구가 도중에 멈췄어요.",
  RENDER_VERIFY_FAILED:"만든 영상이 확인 기준을 통과하지 못했어요.",
  RENDER_FAILED:"영상을 만들지 못했어요.",
  DISK_FULL:"저장 공간이 부족해요. 공간을 비운 뒤 다시 만들어 주세요.",
  STORAGE_FAILED:"영상 파일을 저장하지 못했어요. 저장 위치를 확인해 주세요.",
  TIMEOUT:"영상 만들기 제한 시간(30분)이 지났어요.",
  RENDER_INTERRUPTED:"작업 처리기가 여러 번 중단돼 영상 만들기를 멈췄어요.",
  RENDER_CANCELED:"영상 만들기를 취소했어요.",
};
export const RENDER_RETRYABLE:readonly RenderErrorCode[]=["RENDER_BROWSER_CRASHED","STORAGE_FAILED"];
export const renderRetryable=(code:string|null|undefined)=>RENDER_RETRYABLE.includes(code as RenderErrorCode);
