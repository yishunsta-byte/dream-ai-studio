import {describe,expect,it} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {SettingsOverview} from "@/components/settings-overview";
import type {BackupScreenData,StartupSummary} from "@/components/settings-panel";

const startup:StartupSummary={canStart:true,checkedAt:"2026-11-17T04:00:00Z",checks:[{id:"storage",label:"저장 폴더",status:"pass",message:"저장할 수 있어요."}]};
const row:BackupScreenData["rows"][number]={id:"fixture",kind:"manual",status:"succeeded",jobId:null,jobStatus:"succeeded",createdAt:"2026-11-17T02:00:00Z",finishedAt:"2026-11-17T02:01:00Z",verifiedAt:"2026-11-17T02:01:00Z",interruptedByRestore:false,error:null,fileCount:1,sizeBytes:100,origin:"local",inherited:false,originUnconfirmed:false,available:true,restorable:true};
const empty={rows:[],lastSuccess:null,lastFailure:null,workerOnline:true} as unknown as BackupScreenData;
const html=(data:BackupScreenData=empty,summary=startup,stale=false)=>renderToStaticMarkup(createElement(SettingsOverview,{startup:summary,data,readAt:"2026-11-17T04:01:00Z",stale}));
const text=(markup:string)=>markup.replace(/<[^>]*>/g," ").replace(/\s+/g," ");

describe("T180 A2 truthful management overview",()=>{
 it("keeps fixed card order and uses links instead of duplicate actions",()=>{
  const markup=html({...empty,rows:[row],lastSuccess:row});
  expect([...markup.matchAll(/<h3>(.*?)<\/h3>/g)].map(x=>x[1])).toEqual(["저장 점검","작업 처리기","이 환경의 백업"]);
  expect(markup).not.toContain("먼저 확인할 것");expect(markup).not.toContain("<button");expect(markup).not.toContain("<form");
  for(const href of ["/setup","/jobs","#backup","#restore","#overview"])expect(markup).toContain(`href="${href}"`);
  expect(text(markup)).toContain("모든 기능의 검증 완료를 뜻하지 않아요.");
 });
 it("shows actual startup warning and missing heartbeat/file as separate concerns",()=>{
  const warning:StartupSummary={...startup,checks:[{id:"disk",label:"저장 공간",status:"warning",message:"공간을 확보해 주세요."}]};
  const markup=html({...empty,workerOnline:false,rows:[{...row,available:false}],lastSuccess:{...row,available:false}},warning);
  for(const expected of ["먼저 확인할 것","확인할 항목 있음","공간을 확보해 주세요.","최근 응답 확인 못함","파일 확인 필요","이 PC에 파일 없음"])expect(text(markup)).toContain(expected);
  expect(markup).not.toContain("작업 처리기 꺼짐");expect(markup).not.toContain("전체 시스템 정상");
 });
 it("never promotes inherited or unconfirmed rows into this environment's last success",()=>{
  const markup=html({...empty,rows:[{...row,origin:"inherited",inherited:true},{...row,id:"unknown",origin:"unconfirmed",originUnconfirmed:true}]});
  expect(text(markup)).toContain("이 환경에서 완료한 백업이 아직 없어요.");expect(markup).not.toContain("마지막 성공 검증 이력");
 });
 it("warns about a later failure record without calling historical failure unresolved",()=>{
  const older={...row,id:"failure",status:"failed",finishedAt:"2026-11-17T01:00:00Z"};
  expect(html({...empty,lastSuccess:row,lastFailure:older})).not.toContain("먼저 확인할 것");
  const markup=html({...empty,lastSuccess:row,lastFailure:{...older,finishedAt:"2026-11-17T03:00:00Z"}});
  expect(text(markup)).toContain("최근 백업 실패 기록");expect(markup).not.toContain("미해결 장애");
 });
 it.each(["queued","running"])("shows the actual %s backup state without invented progress",jobStatus=>{
  const markup=html({...empty,rows:[{...row,status:"pending",jobStatus}]});
  expect(text(markup)).toContain(jobStatus==="queued"?"백업 대기 중":"백업 진행 중");expect(markup).not.toContain("%");
 });
 it("marks stale data rather than presenting previous heartbeat as current success",()=>{
  const markup=html({...empty,lastSuccess:row},startup,true);
  expect(text(markup)).toContain("마지막 읽은 상태");expect(markup).toContain('href="#backup-read-error"');
  expect(markup).toContain('dateTime="2026-11-17T04:00:00Z"');expect(markup).toContain('dateTime="2026-11-17T04:01:00Z"');
 });
 it("does not claim startup pass when checks fail or canStart is false",()=>{
  expect(text(html(empty,{...startup,canStart:false}))).toContain("시작 점검 필요");
  expect(text(html(empty,{...startup,checks:[{id:"storage",label:"저장",status:"fail",message:"저장 실패"}]}))).toContain("시작 점검 필요");
 });
});
