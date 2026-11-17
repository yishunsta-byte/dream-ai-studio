import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Callout, Card, PageHeader, StatusPill } from "@/components/ui/primitives";
import { CloudReadLocal, CloudReadOnlyNote } from "@/components/cloud/project-list-readonly";
import { loginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";
import { readCloudProjects, type CloudProjectCard } from "@/lib/cloud/project-read-page";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "개인 관리 · Dream AI Studio" };

// 클라우드 개인 관리(T-229, 계획 T-180의 클라우드 읽기 전용 판).
// - 인증을 먼저 판정한다(이 주소로 돌아오도록 next=/cloud/manage). 그 뒤에만 기존 owner 목록 읽기(readCloudProjects)를 1번 한다.
// - 숫자는 "이번에 실제로 불러온 목록"에서만 센다. 전체 총수·DB/처리기 상태로 부풀리지 않는다.
// - Storage·작업 처리기·백업은 클라우드에 아직 연결하지 않았다고 그대로 알린다(가짜 수치·성공 배지 없음).
// - 쓰기·복원·재시작·결제 버튼, 폼, 자동 새로고침이 없다. 다시 불러오기는 이 주소로 가는 링크다.
const ORDER: readonly CloudProjectCard["status"][] = ["warning", "running", "approval", "queued", "done"];
const time = (iso: string) => new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(iso));
// T-230 요구: 연결하지 않은 항목은 "미연결·확인할 수 없음"으로만 알린다(0·정상·재시작·복원 행동 없음).
const READY = [
  { id: "storage", title: "자료 파일 보관", text: "사진·영상 같은 자료 파일을 클라우드에 올리는 기능은 아직 연결하지 않아 상태를 확인할 수 없어요." },
  { id: "worker", title: "작업 처리기", text: "클라우드 작업 처리기는 아직 연결하지 않아 실행 여부를 확인할 수 없어요. 작업은 내 PC 작업실에서 처리해요." },
  { id: "backup", title: "백업", text: "클라우드 백업은 아직 연결하지 않아 백업 상태를 확인할 수 없어요. 백업과 복원은 내 PC 작업실에서 해요." },
] as const;

export default async function CloudManagePage() {
  const auth = await getRenderAuth();
  if (auth.kind === "denied") {
    if (auth.status === 401) redirect(loginPath({ next: "/cloud/manage" }));
    redirect(loginPath({ error: auth.status === 403 ? "forbidden" : "unavailable" }));
  }
  if (auth.kind === "local") return <CloudReadLocal title="개인 관리" />;
  const result = await readCloudProjects();
  if (result.kind === "local") return <CloudReadLocal title="개인 관리" />;
  const observedAt = new Date().toISOString();
  const projects = result.kind === "ok" ? result.data : null;
  const latest = projects?.reduce<string | null>((max, project) => (!max || project.updatedAt > max ? project.updatedAt : max), null) ?? null;
  return <>
    <PageHeader title="개인 관리" description={<CloudReadOnlyNote />} actions={<Link href="/cloud/manage">다시 불러오기</Link>} />
    <p className={styles.meta}>자동으로 새로 고치지 않아요. 최신 내용은 "다시 불러오기"를 눌러 확인해 주세요.</p>
    <div className={styles.grid}>
      <Card>
        <section aria-labelledby="manage-projects" className="stack">
          <h2 id="manage-projects">내 프로젝트</h2>
          {!projects
            ? <Callout tone="warning" title="프로젝트 상태를 불러오지 못했어요">잠시 뒤 다시 시도해 주세요. <Link href="/cloud/manage">다시 불러오기</Link></Callout>
            : !projects.length
              ? <p>아직 클라우드에 옮긴 프로젝트가 없어요. 지금까지 만든 작품은 내 PC 작업실에 있어요.</p>
              : <>
                <p>표시 목록 <strong className={styles.number}>{projects.length}개</strong> <span className="muted">(이번에 불러온 목록 기준)</span></p>
                <p className={styles.meta}>목록을 불러온 시각 <time dateTime={observedAt}>{time(observedAt)}</time></p>
                <p className={styles.meta}>기록된 프로젝트 상태 기준이에요. 실제 처리기 연결이나 지금 실행 중인지는 확인하지 않아요.</p>
                <ul className={styles.counts} aria-label="상태별 프로젝트 수">
                  {ORDER.map((status) => <li key={status}><StatusPill status={status} /><span className={styles.number}>{projects.filter((project) => project.status === status).length}개</span></li>)}
                </ul>
                {latest && <p className={styles.meta}>프로젝트 마지막 수정(가장 최근) <time dateTime={latest}>{time(latest)}</time></p>}
              </>}
          <p><Link href="/cloud/projects">내 프로젝트 보기 →</Link></p>
        </section>
      </Card>
      <Card>
        <section aria-labelledby="manage-ready" className="stack">
          <h2 id="manage-ready">클라우드 연결 준비 상태</h2>
          <ul className={styles.ready}>
            {READY.map((item) => <li key={item.id}>
              <span className={styles.readyHead}><strong>{item.title}</strong><StatusPill status="locked">미연결 · 확인할 수 없음</StatusPill></span>
              <span className="muted">{item.text}</span>
            </li>)}
          </ul>
        </section>
      </Card>
    </div>
  </>;
}
