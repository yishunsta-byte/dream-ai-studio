import type { Metadata } from "next";
import { appConfig } from "@/lib/config/app";

export const metadata: Metadata = {
  title: appConfig.name,
  description: "나만의 AI 콘텐츠 작업실",
};

export const runtime = "nodejs";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
