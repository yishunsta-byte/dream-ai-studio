import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/menus/server",()=>({getMenuConfig:()=>({templateVersion:"fixture"})}));
vi.mock("@/lib/services/startup",()=>({checkStartup:vi.fn()}));
vi.mock("@/lib/services/backups",()=>({readBackups:vi.fn(),readBackupConfiguration:vi.fn()}));
vi.mock("@/lib/services/jobs",()=>({listJobs:vi.fn()}));
vi.mock("@/lib/services/history",()=>({readRestoreInformation:vi.fn()}));
import SettingsPage from "@/app/(studio)/settings/page";
import { SettingsPanel } from "@/components/settings-panel";
import { checkStartup } from "@/lib/services/startup";
import { readBackups, readBackupConfiguration } from "@/lib/services/backups";
import { listJobs } from "@/lib/services/jobs";
import { readRestoreInformation } from "@/lib/services/history";

function panel(node:unknown):ReactElement<Parameters<typeof SettingsPanel>[0]>|undefined {
 if(Array.isArray(node))return node.map(panel).find(Boolean);
 if(!isValidElement<{children?:unknown}>(node))return;
 if(node.type===SettingsPanel)return node as ReactElement<Parameters<typeof SettingsPanel>[0]>;
 return panel(node.props.children);
}
const checks=[{id:"disk",label:"남은 저장 공간",status:"warning" as const,message:"공간을 확인해 주세요."}];
beforeEach(()=>{
 vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-17T04:00:00Z"));
 vi.mocked(checkStartup).mockImplementation(()=>{vi.setSystemTime(new Date("2026-11-17T04:00:01Z"));return {checks,canStart:true};});
 // The service's inferred array-index type omits the null it returns for an empty list.
 vi.mocked(readBackups).mockReturnValue({rows:[],lastSuccess:null,lastFailure:null} as unknown as ReturnType<typeof readBackups>);
 vi.mocked(listJobs).mockReturnValue({workerOnline:false,jobs:[]});
 vi.mocked(readBackupConfiguration).mockReturnValue({directory:"D:/fixture"});
 vi.mocked(readRestoreInformation).mockImplementation(()=>{vi.setSystemTime(new Date("2026-11-17T04:00:02Z"));return null;});
});
afterEach(()=>{vi.useRealTimers();});

describe("T180 A1 settings read boundary",()=>{
 it("reuses one startup read and keeps independent, serializable observation times",async()=>{
  const element=panel((await SettingsPage()))!;
  expect(checkStartup).toHaveBeenCalledTimes(1);
  expect(element.props.startupSummary).toEqual({checks,canStart:true,checkedAt:"2026-11-17T04:00:01.000Z"});
  expect(element.props.initialReadAt).toBe("2026-11-17T04:00:02.000Z");
  expect(element.props.initial).toEqual({rows:[],lastSuccess:null,lastFailure:null,workerOnline:false});
  expect(JSON.parse(JSON.stringify(element.props))).toEqual(element.props);
 });
 it("does not read DB-dependent settings after startup fails",async()=>{
  vi.mocked(checkStartup).mockReturnValue({canStart:false,checks:[]});
  const tree=(await SettingsPage());expect(panel(tree)).toBeUndefined();
  for(const read of [readBackups,listJobs,readBackupConfiguration,readRestoreInformation])expect(read).not.toHaveBeenCalled();
  expect(renderToStaticMarkup(tree)).toContain("시작 점검이 필요해요.");
 });
 it.each([readBackups,listJobs,readBackupConfiguration,readRestoreInformation])("keeps a read failure separate from empty backup data (%#)",async read=>{
  vi.mocked(read).mockImplementationOnce(()=>{throw Error("fixture read failure");});
  const tree=(await SettingsPage());expect(panel(tree)).toBeUndefined();
  const html=renderToStaticMarkup(tree);expect(html).toContain("설정을 읽지 못했어요.");expect(html).not.toContain("아직 백업이 없어요");
 });
 it("describes warning and missing heartbeat without claiming completion or process exit",async()=>{
  const html=renderToStaticMarkup((await SettingsPage()));
  expect(html).toContain("확인할 항목 있음");expect(html).toContain("최근 응답을 확인하지 못했어요.");
  expect(html).toContain('dateTime="2026-11-17T04:00:01.000Z"');expect(html).toContain('dateTime="2026-11-17T04:00:02.000Z"');
  expect(html).not.toContain("작업 처리기 꺼짐");expect(html).toContain("모든 기능의 검증 완료를 뜻하지 않아요.");
 });
});
