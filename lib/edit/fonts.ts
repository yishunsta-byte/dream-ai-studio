import specFonts from "@/docs/spec/fonts.json";

// P2-3 (T-079 2.1.1, Master msg_56dc1c430102): two lists.
// - READABLE_FONT_FAMILIES: every family a stored timeline may name. Append only — a family taken out of the spec
//   later must still be readable, so saved versions never stop parsing (tests check it covers the spec list).
// - Selectable fonts (spec ∩ installed ∩ license check) come from the server registry (lib/fonts/registry.ts).
export const READABLE_FONT_FAMILIES=["Pretendard","Noto Sans KR","Noto Serif KR","Black Han Sans","Do Hyeon","Jua","Gowun Dodum","Nanum Pen Script"] as const;
export type FontFamily=typeof READABLE_FONT_FAMILIES[number];
export type SpecFont={family:string;folder:string;weights:number[];role:string;license:string};
export const SPEC_FONTS:readonly SpecFont[]=(specFonts as {fonts:SpecFont[]}).fonts;
// A font the screen and the preview can use (server registry result; url is served from public/fonts).
export type FontRef={family:FontFamily;role:string;weights:number[];url:string};
// Pretendard comes from next/font (--font-pretendard); every other family is registered from its file by name.
export const fontStack=(family:string)=>family==="Pretendard"?"var(--font-pretendard), system-ui, sans-serif":`"${family}", var(--font-pretendard), system-ui, sans-serif`;
