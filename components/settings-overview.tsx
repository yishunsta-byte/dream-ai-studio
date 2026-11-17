import Link from "next/link";
import { Card, Callout, StatusPill } from "./ui/primitives";
import type { BackupScreenData, StartupSummary } from "./settings-panel";
import styles from "./settings-overview.module.css";

const date=(value:string)=>new Date(value).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"});

export function SettingsOverview({startup,data,readAt,stale=false}:{startup:StartupSummary;data:BackupScreenData;readAt:string;stale?:boolean}) {
 const concerns=startup.checks.filter(check=>check.status!=="pass");
 const startupFailed=!startup.canStart||concerns.some(check=>check.status==="fail");
 const success=data.lastSuccess,failure=data.lastFailure;
 const missing=success?.available===false;
 const active=data.rows.find(row=>row.origin==="local"&&!row.interruptedByRestore&&["queued","running"].includes(row.jobStatus??""));
 const recentFailure=!!failure&&(!success||(failure.finishedAt??failure.createdAt)>(success.verifiedAt??success.createdAt));
 const issues=[
  ...(startupFailed?[{text:"시작 점검을 확인해 주세요.",href:"/setup"}]:concerns.length?[{text:"저장 점검에 확인할 항목이 있어요.",href:"/setup"}]:[]),
  ...(stale?[{text:"새 상태를 읽지 못했어요. 마지막 자료를 보여 드려요.",href:"#backup-read-error"}]:!data.workerOnline?[{text:"처리기의 최근 응답을 확인해 주세요.",href:"/jobs"}]:[]),
  ...(missing?[{text:"마지막 성공 백업의 파일 위치를 확인해 주세요.",href:"#backup"}]:recentFailure?[{text:"최근 백업 실패 기록을 확인해 주세요.",href:"#backup"}]:[]),
 ];
 return <div className={styles.overview}>
  {issues.length>0&&<Callout title="먼저 확인할 것" tone="warning"><ul className={styles.issues}>{issues.map(issue=><li key={issue.href}><Link href={issue.href}>{issue.text}</Link></li>)}</ul></Callout>}
  <nav className={styles.navigation} aria-label="개인 관리 안에서 이동"><a href="#overview">한눈에 보기</a><a href="#backup">백업</a><a href="#restore">새 폴더 복원</a></nav>
  <section id="overview" aria-labelledby="overview-title" tabIndex={-1}>
   <h2 id="overview-title">한눈에 보기</h2>
   <div className={styles.cards}>
    <Card className={styles.card}><h3>저장 점검</h3><StatusPill status={startupFailed?"failed":concerns.length?"warning":"done"}>{startupFailed?"시작 점검 필요":concerns.length?"확인할 항목 있음":"통과"}</StatusPill>
     <p>{startupFailed?"시작 점검에서 진행 조건을 확인해 주세요.":"저장 폴더·데이터 등 시작 조건을 읽은 결과예요."}</p>
     {concerns.length>0&&<ul className={styles.checks}>{concerns.map(check=><li key={check.id}><strong>{check.label}</strong><span>{check.message}</span></li>)}</ul>}
     <p className={styles.note}>모든 기능의 검증 완료를 뜻하지 않아요.</p>
     <p className={styles.note}>점검 읽은 시각<br/><time dateTime={startup.checkedAt}>{date(startup.checkedAt)}</time></p><Link className={styles.detail} href="/setup">시작 점검 보기 →</Link>
    </Card>
    <Card className={styles.card}><h3>작업 처리기</h3><StatusPill status={stale||!data.workerOnline?"warning":"done"}>{stale?"마지막 읽은 상태":data.workerOnline?"최근 응답 있음":"최근 응답 확인 못함"}</StatusPill>
     <p>{data.workerOnline?"마지막으로 읽었을 때 최근 응답이 있었어요.":"마지막으로 읽었을 때 최근 응답을 확인하지 못했어요."}</p>
     <p className={styles.note}>응답 여부만으로 처리기의 종료나 작업 성공을 판단하지 않아요.</p>
     <p className={styles.note}>백업·처리기 상태 읽은 시각<br/><time dateTime={readAt}>{date(readAt)}</time></p><Link className={styles.detail} href="/jobs">작업 대기열 보기 →</Link>
    </Card>
    <Card className={styles.card}><h3>이 환경의 백업</h3><StatusPill status={stale||missing||recentFailure?"warning":active?.jobStatus==="running"?"running":active?"queued":success?"done":"locked"}>{stale?"마지막 읽은 상태":missing?"파일 확인 필요":active?.jobStatus==="running"?"백업 진행 중":active?"백업 대기 중":recentFailure?"실패 기록 있음":success?"마지막 성공 기록 있음":"완료한 백업 없음"}</StatusPill>
     {success?<p>{success.verifiedAt?<>마지막 성공 검증 이력<br/><time dateTime={success.verifiedAt}>{date(success.verifiedAt)}</time></>:"성공 기록은 있으나 검증 시각 정보가 없어요."}{missing&&<><br/>이 PC에 파일 없음</>}</p>:<p>이 환경에서 완료한 백업이 아직 없어요.</p>}
     {failure&&<p className={styles.note}>마지막 실패 기록<br/><time dateTime={failure.finishedAt??failure.createdAt}>{date(failure.finishedAt??failure.createdAt)}</time></p>}
     <p className={styles.note}>이전 환경·출처 미확인 기록은 이 환경의 성공·실패에 포함하지 않아요. 성공 이력과 현재 파일 존재는 별개예요.</p>
     <Link className={styles.detail} href="#backup">백업 관리로 →</Link>
    </Card>
   </div>
  </section>
 </div>;
}
