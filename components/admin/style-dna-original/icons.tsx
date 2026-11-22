// P1-06 Style DNA 원본(v1.39) 화면이 쓰는 lucide-react v1.55.0 아이콘의 도형을 그대로 옮긴 것이에요(의존성 추가 없이 쓰려고).
// 출처: lucide-react v1.55.0 (https://lucide.dev) · ISC License · Copyright (c) 2026 Lucide Icons and Contributors.
// ISC 허용 조건에 따라 위 저작권 고지를 남겨요. 장식용이라 기본으로 화면 읽기에서 숨겨요(aria-hidden).
import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { size?: number };
function base({ size = 24, ...rest }: Props) {
  return { xmlns: "http://www.w3.org/2000/svg", width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false, ...rest };
}

export const Microscope = (props: Props) => <svg {...base(props)}><path d="M6 18h8" /> <path d="M3 22h18" /> <path d="M14 22a7 7 0 1 0 0-14h-1" /> <path d="M9 14h2" /> <path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z" /> <path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3" /></svg>;
export const Upload = (props: Props) => <svg {...base(props)}><path d="M12 3v12" /> <path d="m17 8-5-5-5 5" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></svg>;
export const HelpCircle = (props: Props) => <svg {...base(props)}><circle cx="12" cy="12" r="10" /> <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /> <path d="M12 17h.01" /></svg>;
export const Sliders = (props: Props) => <svg {...base(props)}><path d="M10 8h4" /> <path d="M12 21v-9" /> <path d="M12 8V3" /> <path d="M17 16h4" /> <path d="M19 12V3" /> <path d="M19 21v-5" /> <path d="M3 14h4" /> <path d="M5 10V3" /> <path d="M5 21v-7" /></svg>;
export const Sparkles = (props: Props) => <svg {...base(props)}><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /> <path d="M20 2v4" /> <path d="M22 4h-4" /> <circle cx="4" cy="20" r="2" /></svg>;
export const Sun = (props: Props) => <svg {...base(props)}><circle cx="12" cy="12" r="4" /> <path d="M12 2v2" /> <path d="M12 20v2" /> <path d="m4.93 4.93 1.41 1.41" /> <path d="m17.66 17.66 1.41 1.41" /> <path d="M2 12h2" /> <path d="M20 12h2" /> <path d="m6.34 17.66-1.41 1.41" /> <path d="m19.07 4.93-1.41 1.41" /></svg>;
export const Moon = (props: Props) => <svg {...base(props)}><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" /></svg>;
export const FlaskConical = (props: Props) => <svg {...base(props)}><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" /> <path d="M6.453 15h11.094" /> <path d="M8.5 2h7" /></svg>;
export const Wand2 = (props: Props) => <svg {...base(props)}><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" /> <path d="m14 7 3 3" /> <path d="M5 6v4" /> <path d="M19 14v4" /> <path d="M10 2v2" /> <path d="M7 8H3" /> <path d="M21 16h-4" /> <path d="M11 3H9" /></svg>;
export const Loader2 = (props: Props) => <svg {...base(props)}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>;
export const Trash2 = (props: Props) => <svg {...base(props)}><path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
export const Dna = (props: Props) => <svg {...base(props)}><path d="m10 16 1.5 1.5" /> <path d="m14 8-1.5-1.5" /> <path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993" /> <path d="m16.5 10.5 1 1" /> <path d="m17 6-2.891-2.891" /> <path d="M2 15c6.667-6 13.333 0 20-6" /> <path d="m20 9 .891.891" /> <path d="M3.109 14.109 4 15" /> <path d="m6.5 12.5 1 1" /> <path d="m7 18 2.891 2.891" /> <path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993" /></svg>;
export const AlertCircle = (props: Props) => <svg {...base(props)}><circle cx="12" cy="12" r="10" /> <line x1="12" x2="12" y1="8" y2="12" /> <line x1="12" x2="12.01" y1="16" y2="16" /></svg>;
export const Check = (props: Props) => <svg {...base(props)}><path d="M20 6 9 17l-5-5" /></svg>;
export const Copy = (props: Props) => <svg {...base(props)}><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /> <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>;
export const LayoutDashboard = (props: Props) => <svg {...base(props)}><rect width="7" height="9" x="3" y="3" rx="1" /> <rect width="7" height="5" x="14" y="3" rx="1" /> <rect width="7" height="9" x="14" y="12" rx="1" /> <rect width="7" height="5" x="3" y="16" rx="1" /></svg>;
export const KeyRound = (props: Props) => <svg {...base(props)}><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /> <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" /></svg>;
export const BookOpen = (props: Props) => <svg {...base(props)}><path d="M12 5v16" /> <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" /></svg>;
export const X = (props: Props) => <svg {...base(props)}><path d="M18 6 6 18" /> <path d="m6 6 12 12" /></svg>;
export const Layers = (props: Props) => <svg {...base(props)}><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" /> <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" /> <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" /></svg>;
export const ImageIcon = (props: Props) => <svg {...base(props)}><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /> <circle cx="9" cy="9" r="2" /> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>;
export const CheckCircle2 = (props: Props) => <svg {...base(props)}><circle cx="12" cy="12" r="10" /> <path d="m16 9-5.5 5.5L8 12" /></svg>;
export const Download = (props: Props) => <svg {...base(props)}><path d="M12 15V3" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <path d="m7 10 5 5 5-5" /></svg>;
export const Maximize2 = (props: Props) => <svg {...base(props)}><path d="M15 3h6v6" /> <path d="m21 3-7 7" /> <path d="m3 21 7-7" /> <path d="M9 21H3v-6" /></svg>;
export const Menu = (props: Props) => <svg {...base(props)}><path d="M4 5h16" /> <path d="M4 12h16" /> <path d="M4 19h16" /></svg>;
