import Link from "next/link";
import { getMenuConfig } from "@/lib/menus/server";
import { readBackups, readBackupConfiguration } from "@/lib/services/backups";
import { readRestoreInformation } from "@/lib/services/history";
import { listJobs } from "@/lib/services/jobs";
import { checkStartup } from "@/lib/services/startup";
import { Badge, Card, Callout, PageHeader } from "@/components/ui/primitives";
import { SettingsPanel } from "@/components/settings-panel";
export const dynamic="force-dynamic";
export default function SettingsPage(){const config=getMenuConfig();if(!checkStartup().canStart)return <><PageHeader title="설정"/><Callout title="시작 점검이 필요해요." tone="warning"><Link href="/setup">시작 점검 확인하기</Link></Callout></>;const data=(()=>{try{return {initial:{...readBackups(),workerOnline:listJobs().workerOnline},directory:readBackupConfiguration().directory,restore:readRestoreInformation()};}catch{return null;}})();if(!data)return <><PageHeader title="설정"/><Callout title="설정을 읽지 못했어요." tone="danger"><Link href="/setup">시작 점검을 확인해 주세요.</Link></Callout></>;return <><PageHeader title="설정" description="백업과 새 폴더 복원을 안전하게 관리해요."/>{data.restore&&<Callout title="검증한 백업에서 복원한 데이터예요."><p>출처 백업: {new Date(data.restore.backupCreatedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})} · 복원: {new Date(data.restore.restoredAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</p><p>아래 성공·실패 시각은 이 복원본에 기록된 백업 작업 기준이에요. 백업 당시 실행 중이던 작업은 복원본에서 이어서 하지 않으며, 출처 백업의 검증 실패나 사용자의 취소를 뜻하지 않아요.</p></Callout>}<SettingsPanel initial={data.initial} directory={data.directory} sampleMode={process.env.MOCK_MODE!=="false"}/><Card><h2>앱 정보</h2>{data.restore&&<p>이 데이터는 {new Date(data.restore.backupCreatedAt).toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"})} 백업에서 복원했어요.</p>}<Badge>앱 0.1.0 · 템플릿 {config.templateVersion}</Badge></Card></>;}
