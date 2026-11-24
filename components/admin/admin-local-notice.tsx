import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-logo";
import { appConfig } from "@/lib/config/app";
import styles from "@/components/auth/login.module.css";
import admin from "./admin.module.css";

// 이 PC 실행(로그인 꺼짐)에서 관리자 주소를 열었을 때의 안내(T-243). 관리 정보·폼을 그리지 않는다.
export function AdminLocalNotice() {
  return <main id="main-content" className={styles.page}>
    <div className={styles.hero}>
      <BrandMark size={64} />
      <span className={styles.eyebrow}>{appConfig.name} · 관리자</span>
      <h1 className={styles.title}>관리자 로그인은 운영 사이트에서 써요</h1>
      <p className={styles.lead}>이 PC 실행은 로그인을 쓰지 않아서 관리자 확인을 할 수 없어요. 관리자 화면은 로그인 설정(Supabase 주소·공개 키·허용 이메일)이 된 운영 사이트에서 열어 주세요.</p>
    </div>
    <div className={styles.panel}>
      <p className={styles.note}>이 PC에서 작업하려면 작업실을 쓰세요.</p>
      <p><Link className={admin.link} href="/studio">작업실로 가기 →</Link></p>
      <p><a className={admin.link} href="/">공개 메인으로</a></p>
    </div>
  </main>;
}
