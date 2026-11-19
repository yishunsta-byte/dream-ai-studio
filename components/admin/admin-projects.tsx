import Link from "next/link";
import { Callout, Card, StatusPill } from "@/components/ui/primitives";
import { readCloudProjects, type CloudProjectCard } from "@/lib/cloud/project-read-page";
import styles from "./admin.module.css";

// T283 관리자 개요의 첫 실제 기능: 지금 로그인한 운영자 자신의 클라우드 프로젝트 목록·상태·상세 이동.
// - 읽기는 기존 /cloud/manage·/cloud/projects와 같은 owner 목록 읽기(readCloudProjects) 1번뿐이다.
//   owner는 서버가 확인한 계정 UUID이며, 다른 회원 조회·서비스 역할·쓰기는 없다.
// - 상태를 넷으로 나눈다: 미연결(이 환경에 클라우드 프로젝트 읽기가 설정되지 않음) / 실패(설정됐지만 읽지 못함) /
//   결과 없음(읽기 성공, 0건) / 목록. 기존 읽기는 미연결과 실패를 같은 503으로 돌려주므로,
//   설정 여부는 같은 읽기 선택 규칙의 시작 조건(DREAM_PROJECT_READ_BACKEND=postgres)으로만 먼저 가른다. 값·주소는 보이지 않는다.
// - 호출하는 쪽(app/admin/page.tsx)이 관리자 인증을 판정한 뒤에만 부른다.
export type AdminProjects =
  | { kind: "unlinked" }
  | { kind: "failed" }
  | { kind: "empty"; readAt: string }
  | { kind: "ok"; readAt: string; projects: readonly CloudProjectCard[] };

export async function loadAdminProjects(env: Readonly<Record<string, string | undefined>> = process.env): Promise<AdminProjects> {
  if (env.DREAM_PROJECT_READ_BACKEND !== "postgres") return { kind: "unlinked" };
  const result = await readCloudProjects();
  if (result.kind !== "ok") return { kind: "failed" };
  const readAt = new Date().toISOString(); // 성공한 읽기 뒤에만
  return result.data.length ? { kind: "ok", readAt, projects: result.data } : { kind: "empty", readAt };
}

const KST = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" });
function Moment({ iso }: { iso: string }) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return <>확인 불가</>;
  return <time dateTime={at.toISOString()}>{KST.format(at)} (한국시간)</time>;
}

export function AdminProjectsSection({ state }: { state: AdminProjects }) {
  return <section aria-labelledby="admin-projects" className="stack">
    <div className={styles.sectionHead}>
      <h2 id="admin-projects">내 프로젝트</h2>
      {state.kind !== "unlinked" && <a href="/admin" className={styles.link}>다시 불러오기</a>}
    </div>
    <p className={styles.note}>지금 로그인한 운영자 계정의 클라우드 프로젝트만 보여요. 다른 회원의 프로젝트는 보이지 않아요.</p>
    {state.kind === "unlinked" && <Card>
      <h3 className={styles.unlinkedHead}>프로젝트 목록 <StatusPill status="locked">미연결</StatusPill></h3>
      <p className={styles.note}>이 환경에는 클라우드 프로젝트 읽기가 연결되어 있지 않아요. 연결되면 여기에 내 프로젝트가 표시돼요.</p>
    </Card>}
    {state.kind === "failed" && <Callout tone="warning" title="프로젝트 목록을 불러오지 못했어요">
      연결은 설정되어 있지만 이번 읽기에 실패했어요. 잠시 뒤 <a href="/admin" className={styles.link}>다시 불러오기</a>를 눌러 주세요.
    </Callout>}
    {(state.kind === "empty" || state.kind === "ok") && <Card>
      <p className={styles.lead}>표시 목록 <strong>{state.kind === "ok" ? state.projects.length : 0}개</strong> · 조회 시각 <Moment iso={state.readAt} /></p>
      {state.kind === "empty"
        ? <p className={styles.note}>이번에 불러온 목록에 프로젝트가 없어요.</p>
        : <ul className={styles.projects}>
          {state.projects.map((project) => <li key={project.id} className={styles.project}>
            <h3 className={styles.projectTitle}><Link className={styles.link} href={`/cloud/projects/${project.id}`}>{project.title}<span className="sr-only"> 상세 보기</span> →</Link></h3>
            <p className={styles.meta}><StatusPill status={project.status} /> <span>다음 단계 {project.nextStageLabel}</span></p>
            <p className={styles.note}>{project.menuLabel} · {project.aspect} · {project.lengthSec}초 · 수정 <Moment iso={project.updatedAt} /></p>
          </li>)}
        </ul>}
      <p className={styles.note}>기록된 프로젝트 상태 기준이며, 작업 처리기의 현재 실행 여부를 뜻하지 않아요.</p>
      <p><Link href="/cloud/projects" className={styles.link}>내 프로젝트 전체 화면 →</Link></p>
    </Card>}
  </section>;
}
