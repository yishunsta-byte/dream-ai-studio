import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Callout, Card, PageHeader, StatusPill } from "@/components/ui/primitives";
import { CloudReadLocal } from "@/components/cloud/project-list-readonly";
import { loginPath } from "@/lib/auth/config";
import { getRenderAuth } from "@/lib/auth/render";
import { readCloudProjects, type CloudProjectCard } from "@/lib/cloud/project-read-page";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "개인 관리 · Dream AI Studio" };

// 클라우드 개인 관리(T-229, UX 명세 T-230).
// - 인증을 먼저 판정한다(로그인 뒤 이 주소로 돌아오도록 next=/cloud/manage). 그 뒤에만 기존 owner 목록 읽기(readCloudProjects)를 1번 한다.
// - 건수·분포는 이번에 성공적으로 받은 같은 배열에서만 센다(합계 = 표시 건수). 전체 총수·처리기·DB 상태로 부풀리지 않는다.
// - 조회 시각은 목록 읽기에 성공한 뒤의 서버 시각이다. 읽기 실패에는 0·조회 시각을 만들지 않는다.
// - 작업 처리기·파일 저장소·백업은 "미연결"로만 알린다(가짜 수치·정상/실패 배지·실행 버튼 없음).
// - 폼·버튼·쓰기·자동 새로고침이 없다. 다시 불러오기는 같은 주소로 가는 일반 링크(새 문서 요청 = 새 서버 읽기)다.
const ORDER: readonly CloudProjectCard["status"][] = ["warning", "running", "approval", "done", "queued"];
const KST = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });
function Moment({ iso }: { iso: string }) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return <>확인 불가</>;
  return <time dateTime={at.toISOString()}>{KST.format(at)} (한국시간)</time>;
}
const UNLINKED = [
  { id: "worker", title: "작업 처리기", text: "이 화면에서는 최근 응답과 실행 상태를 확인할 수 없어요." },
  { id: "storage", title: "파일 저장소", text: "사용량과 파일 보관 상태는 아직 확인할 수 없어요." },
  { id: "backup", title: "백업", text: "백업 이력과 복구 가능 여부는 아직 확인할 수 없어요." },
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
  const projects = result.kind === "ok" ? result.data : null;
  const readAt = projects ? new Date().toISOString() : null; // 성공한 읽기 뒤에만
  return <>
    <nav aria-label="클라우드 보기" className={styles.nav}>
      <Link href="/cloud/projects" className={styles.link}>내 프로젝트</Link>
      <span aria-current="page" className={styles.current}>개인 관리(현재)</span>
    </nav>
    <PageHeader title="개인 관리" description="클라우드에 표시된 내 프로젝트와 연결 범위를 확인해요. 지금은 보기만 할 수 있어요."
      actions={<a href="/cloud/manage" className={styles.link}>다시 불러오기</a>} />
    <Card>
      <section aria-labelledby="manage-projects" className="stack">
        <h2 id="manage-projects">표시 목록</h2>
        {!projects
          ? <Callout tone="warning" title="관리 정보를 불러오지 못했어요">잠시 뒤 다시 불러와 주세요. <a href="/cloud/manage" className={styles.link}>다시 불러오기</a></Callout>
          : <>
            <p className={styles.lead}>표시 목록 <strong className={styles.number}>{projects.length}개</strong></p>
            <p className={styles.note}>이번에 불러온 프로젝트 목록 기준이에요.</p>
            <p className={styles.note}>목록 조회 시각 <Moment iso={readAt!} /></p>
            {!projects.length
              ? <p className={styles.note}>이번에 불러온 목록에 프로젝트가 없어요.</p>
              : <>
                <h3 id="manage-dist">기록된 상태 분포</h3>
                <dl className={styles.counts} aria-labelledby="manage-dist">
                  {ORDER.map((status) => <div key={status}><dt><StatusPill status={status} /></dt><dd className={styles.number}>{projects.filter((project) => project.status === status).length}개</dd></div>)}
                </dl>
                <p className={styles.note}>기록된 프로젝트 상태 기준이며, 처리기의 현재 실행 여부를 뜻하지 않아요.</p>
              </>}
          </>}
        <p><Link href="/cloud/projects" className={styles.link}>내 프로젝트 보기 →</Link></p>
      </section>
    </Card>
    <section aria-labelledby="manage-unlinked" className="stack">
      <h2 id="manage-unlinked">연결 범위</h2>
      <div className={styles.grid}>
        {UNLINKED.map((item) => <Card key={item.id}>
          <h3 className={styles.unlinkedHead}>{item.title} <StatusPill status="locked">미연결</StatusPill></h3>
          <p className={styles.note}>{item.text}</p>
        </Card>)}
      </div>
    </section>
  </>;
}
