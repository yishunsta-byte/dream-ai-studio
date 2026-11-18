import type { Metadata } from "next";
import { appConfig } from "@/lib/config/app";
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
  // 메뉴 설정 검증과 저장 폴더 시작 점검은 작업실 화면(StudioLayout)에서 한다(T-183, T-241).
  // 루트는 글꼴·알림 provider·본문만 둔다. 공개 메인·로그인 화면에 내부 설정 항목이 나오지 않게 하기 위해서다.
  return <html lang="ko" className={pretendard.variable}><body><ToastProvider>{children}</ToastProvider></body></html>;
}
