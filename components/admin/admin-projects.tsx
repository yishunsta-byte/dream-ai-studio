import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Callout, Card, StatusPill } from "@/components/ui/primitives";
import { readCloudProjects, type CloudProjectCard } from "@/lib/cloud/project-read-page";
import styles from "./admin.module.css";
import { AdminProjectConsole } from "./admin-project-console";

// T283 내 프로젝트: 지금 로그인한 운영자 자신의 클라우드 프로젝트 목록·상태·상세 이동.
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

// 디자인 명세 docs/design/admin-project-read-help.md: 상태 카드 하나에 제목·안내·다음 행동을 모은다.
// 다시 불러오기는 카드 안 한 곳에만 두고, 불러온 뒤 '내 프로젝트' 영역으로 돌아온다.
// 독립 검수 4d416a6: 같은 /admin에서 '#'만 다른 주소는 브라우저가 문서 안 이동만 해서 다시 조회하지 않았다.
// 그래서 요청마다 서버가 그리는 새 값(reload)을 붙여 매번 현재 주소와 다른 실제 문서 요청이 되게 한다. 값은 표시용 아님.
function Reload({ token }: { token: string }) {
  return <p><a href={`/admin?reload=${token}#admin-project-list`} className={styles.link}>다시 불러오기</a></p>;
}
// 서버 렌더마다 새 값. 같은 밀리초 충돌을 피하려고 난수를 붙인다(비밀 아님).
function newReloadToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
function Help({ children }: { children: string }) {
  return <details className={styles.help}>
    <summary>연결 상태 도움말</summary>
    <p className={styles.note}>{children}</p>
  </details>;
}

export function AdminProjectsSection({ state, reloadToken = newReloadToken() }: { state: AdminProjects; reloadToken?: string }) {
  return <section aria-labelledby="admin-projects" className="stack">
    <div className={styles.sectionHead}>
      <h2 id="admin-projects" tabIndex={-1}>프로젝트 콘솔</h2>
      <div className={styles.projectLinks}>
        <Link className={styles.link} href="/cloud/manage">클라우드 개인 관리 <Icon name="arrow" /></Link>
        <Link className={styles.link} href="/cloud/projects">내 프로젝트 전체 화면 <Icon name="arrow" /></Link>
      </div>
    </div>
    <p className={styles.note}>지금 로그인한 운영자 계정의 클라우드 프로젝트만 보여요. 다른 회원의 프로젝트는 보이지 않아요.</p>
    {state.kind === "unlinked" && <Card>
      <h3 className={styles.unlinkedHead}>프로젝트 목록 <StatusPill status="locked">미연결</StatusPill></h3>
      <p className={styles.note}>이 환경에서 내 프로젝트를 조회하려면 운영 담당자의 연결 확인이 필요해요.</p>
      <Help>운영 담당자에게 ‘관리자 화면의 내 프로젝트 목록 연결을 확인해 주세요’라고 알려 주세요. 이 목록은 현재 로그인한 계정의 프로젝트를 보여줘요.</Help>
    </Card>}
    {state.kind === "failed" && <Callout tone="warning" title="프로젝트 목록을 불러오지 못했어요">
      <p className={styles.note}>잠시 뒤 다시 불러와 주세요.</p>
      <Reload token={reloadToken} />
      <Help>다시 불러와도 같은 문구가 보이면 ‘내 프로젝트’, 오류 문구, 발생 시각을 운영 담당자에게 알려 주세요.</Help>
    </Callout>}
    {state.kind === "empty" && <Card>
      <h3 className={styles.stateHead}>내 프로젝트가 0개예요</h3>
      <p className={styles.note}>현재 로그인한 계정으로 조회한 결과예요. 조회 시각 <Moment iso={state.readAt} /></p>
      <Reload token={reloadToken} />
    </Card>}
    {state.kind === "ok" && <Card>
      <h3 className={styles.stateHead}>내 프로젝트 {state.projects.length}개</h3>
      <p className={styles.note}>조회 시각 <Moment iso={state.readAt} /></p>
      <AdminProjectConsole projects={state.projects} />
      <Reload token={reloadToken} />
    </Card>}
  </section>;
}
