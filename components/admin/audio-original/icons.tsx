// P1-07 Audio Analyzer 원본(v1.15) 화면이 쓰는 lucide-react v1.55.0 아이콘의 도형을 그대로 옮긴 것이에요(의존성 추가 없이 쓰려고).
// 출처: lucide-react v1.55.0 (https://lucide.dev) · ISC License · Copyright (c) 2026 Lucide Icons and Contributors.
// ISC 허용 조건에 따라 위 저작권 고지를 남겨요. 장식용이라 기본으로 화면 읽기에서 숨겨요(aria-hidden).
// Sparkles·Trash2·Loader2·KeyRound는 이미지 원본 아이콘 파일(같은 판)에 이미 있어 그대로 다시 내보내요.
import type { SVGProps } from "react";

export { KeyRound, Loader2, Sparkles, Trash2 } from "../style-dna-original/icons";

type Props = SVGProps<SVGSVGElement> & { size?: number };
function base({ size = 24, ...rest }: Props) {
  return { xmlns: "http://www.w3.org/2000/svg", width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false, ...rest };
}

export const Activity = (props: Props) => <svg {...base(props)}><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" /></svg>;
export const Mic = (props: Props) => <svg {...base(props)}><path d="M12 19v3" /> <path d="M19 10v2a7 7 0 0 1-14 0v-2" /> <rect x="9" y="2" width="6" height="13" rx="3" /></svg>;
export const Music = (props: Props) => <svg {...base(props)}><path d="M9 18V5l12-2v13" /> <circle cx="6" cy="18" r="3" /> <circle cx="18" cy="16" r="3" /></svg>;
export const Cpu = (props: Props) => <svg {...base(props)}><path d="M12 20v2" /> <path d="M12 2v2" /> <path d="M17 20v2" /> <path d="M17 2v2" /> <path d="M2 12h2" /> <path d="M2 17h2" /> <path d="M2 7h2" /> <path d="M20 12h2" /> <path d="M20 17h2" /> <path d="M20 7h2" /> <path d="M7 20v2" /> <path d="M7 2v2" /> <rect x="4" y="4" width="16" height="16" rx="2" /> <rect x="8" y="8" width="8" height="8" rx="1" /></svg>;
export const UploadCloud = (props: Props) => <svg {...base(props)}><path d="M12 13v8" /> <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /> <path d="m8 17 4-4 4 4" /></svg>;
export const FileAudio = (props: Props) => <svg {...base(props)}><path d="M4 6.835V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-.343" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" /> <path d="M2 19a2 2 0 0 1 4 0v1a2 2 0 0 1-4 0v-4a6 6 0 0 1 12 0v4a2 2 0 0 1-4 0v-1a2 2 0 0 1 4 0" /></svg>;
// A-4 좁은 폭 메뉴 단추(원본 Sidebar.tsx 모바일 머리 바의 Menu·X, lucide v1.55.0 같은 도형).
export const Menu = (props: Props) => <svg {...base(props)}><path d="M4 5h16" /> <path d="M4 12h16" /> <path d="M4 19h16" /></svg>;
export const X = (props: Props) => <svg {...base(props)}><path d="M18 6 6 18" /> <path d="m6 6 12 12" /></svg>;
export const ArrowRight = (props: Props) => <svg {...base(props)}><path d="M5 12h14" /> <path d="m12 5 7 7-7 7" /></svg>;
