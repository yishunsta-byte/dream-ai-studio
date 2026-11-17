import type { Metadata } from "next";
import { appConfig } from "@/lib/config/app";
import { getMenuConfigState } from "@/lib/menus/server";
import localFont from "next/font/local";
import { ToastProvider } from "@/components/ui/interactive";
import "./globals.css";

const pretendard = localFont({ src: "../public/fonts/PretendardVariable.woff2", weight: "45 920", display: "swap", variable: "--font-pretendard" });

export const metadata: Metadata = {
  title: appConfig.name,
  description: "나만의 AI 콘텐츠 작업실",
};

export const runtime = "nodejs";
// 빌드 때 만든 정상 화면이 시작 점검 실패를 우회하지 않도록 요청 시 렌더링한다.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const state = getMenuConfigState();
  if (!state.ok) {
    return (
      <html lang="ko" className={pretendard.variable}><body><main className="content">
        <h1>메뉴 설정을 확인해 주세요</h1>
        <p>설정 오류로 작업실을 시작할 수 없습니다. 아래 항목을 수정한 뒤 서버를 다시 시작해 주세요.</p>
        <ul style={{ overflowWrap: "anywhere" }}>{state.issues.map((issue, index) => <li key={index}><code>{issue.path}</code>: {issue.message}</li>)}</ul>
      </main></body></html>
    );
  }
  // 저장 폴더 시작 점검은 작업실 화면(StudioLayout)에서 한다. 로그인 화면은 저장소가 필요 없어서 점검하지 않는다(T-183).
  return <html lang="ko" className={pretendard.variable}><body><ToastProvider>{children}</ToastProvider></body></html>;
}
