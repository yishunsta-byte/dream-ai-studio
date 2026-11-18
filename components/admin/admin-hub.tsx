import Link from "next/link";
import { Card, PageHeader, StatusPill } from "@/components/ui/primitives";
import styles from "./admin.module.css";

// 관리 허브(T-243). 로그인한 운영자 자신의 범위(기존 개인 관리·내 프로젝트·비밀번호)로만 이어 준다.
// 다른 회원 정보·전체 통계·서비스 상태 수치·삭제/실행 버튼을 만들지 않는다. 연결되지 않은 것은 "미연결"로만 알린다.
const LINKS = [
  { href: "/cloud/manage", title: "개인 관리", text: "클라우드에 표시된 내 프로젝트 목록과 연결 범위를 확인해요." },
  { href: "/cloud/projects", title: "내 프로젝트", text: "내 계정의 프로젝트를 보고 새 프로젝트를 만들어요." },
  { href: "/account/password", title: "비밀번호 바꾸기", text: "지금 로그인한 계정의 비밀번호를 바꿔요." },
] as const;
const UNLINKED = [
  { id: "members", title: "회원 관리", text: "다른 회원의 정보와 권한은 이 화면에서 다루지 않아요. 들어올 수 있는 계정은 운영 설정의 허용 이메일 목록으로 정해져요." },
  { id: "service", title: "서비스 상태", text: "작업 처리기·파일 저장소·백업 상태는 아직 이 화면에 연결되지 않았어요." },
] as const;

export function AdminHub({ email }: { email: string }) {
  return <div className="stack">
    <PageHeader title="관리 화면" description="지금 로그인한 운영자 계정 범위의 관리 메뉴예요." />
    <p className={styles.note}>로그인 계정 <strong>{email}</strong></p>
    <section aria-labelledby="admin-menu" className="stack">
      <h2 id="admin-menu">관리 메뉴</h2>
      <div className={styles.grid}>
        {LINKS.map((item) => <Card key={item.href}>
          <h3 className={styles.unlinkedHead}><Link className={styles.link} href={item.href}>{item.title} →</Link></h3>
          <p className={styles.note}>{item.text}</p>
        </Card>)}
      </div>
    </section>
    <section aria-labelledby="admin-unlinked" className="stack">
      <h2 id="admin-unlinked">연결 범위</h2>
      <div className={styles.grid}>
        {UNLINKED.map((item) => <Card key={item.id}>
          <h3 className={styles.unlinkedHead}>{item.title} <StatusPill status="locked">미연결</StatusPill></h3>
          <p className={styles.note}>{item.text}</p>
        </Card>)}
      </div>
    </section>
  </div>;
}
