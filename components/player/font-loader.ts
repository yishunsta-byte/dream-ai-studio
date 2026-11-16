"use client";
import type { FontRef } from "@/lib/edit/fonts";

// P2-3 fonts in the browser (T-080 5.4, T-082 contract). Pretendard is the next/font face (--font-pretendard); every
// other family is registered once under its spec name from its file, so the CSS name is ours, not the file's internal
// name. Big files (Noto Serif KR ≈ 24 MB) get 20 s; "timeout" is kept apart from "missing" (file or face failed).
export type FontState="ok"|"missing"|"timeout";
const TIMEOUT_MS=20000;
const faces=new Map<string,Promise<boolean>>();
function register(font:FontRef){
  let face=faces.get(font.family);
  if(!face){
    const weight=font.weights.length>1?`${Math.min(...font.weights)} ${Math.max(...font.weights)}`:String(font.weights[0]??400);
    face=new FontFace(font.family,`url("${font.url}")`,{weight,display:"block"}).load().then(loaded=>{document.fonts.add(loaded);return true;},()=>false);
    faces.set(font.family,face);
    // A failed face is forgotten so "미리보기 다시 불러오기" can try the file again.
    void face.then(ok=>{if(!ok)faces.delete(font.family);});
  }
  return face;
}
async function load(family:string,font:FontRef|undefined,weights:readonly number[]):Promise<boolean>{
  if(family==="Pretendard"){
    const name=getComputedStyle(document.documentElement).getPropertyValue("--font-pretendard").split(",")[0]?.trim();if(!name)return false;
    const sets=await Promise.all(weights.map(weight=>document.fonts.load(`${weight} 64px ${name}`,"가A1")));
    return sets.every(set=>set.length>0&&set.every(face=>face.status==="loaded"));
  }
  if(!font||!await register(font))return false;
  const sets=await Promise.all(weights.map(weight=>document.fonts.load(`${weight} 64px "${family}"`,"가A1")));
  return sets.every(set=>set.length>0);
}
// Every family the texts use, each with the weights they use. A family not in `fonts` (not selectable now) is missing.
export async function loadFonts(uses:ReadonlyMap<string,readonly number[]>,fonts:readonly FontRef[]):Promise<Record<string,FontState>>{
  const entries=await Promise.all([...uses].map(async([family,weights])=>{
    const timeout=new Promise<FontState>(resolve=>setTimeout(()=>resolve("timeout"),TIMEOUT_MS));
    const done=load(family,fonts.find(font=>font.family===family),weights.length?weights:[400]).then(ok=>ok?"ok" as const:"missing" as const,()=>"missing" as const);
    return [family,await Promise.race([done,timeout])] as const;
  }));
  return Object.fromEntries(entries);
}
export function fontUses(texts:readonly {style:{fontFamily:string;fontWeight:number}}[]){
  const uses=new Map<string,number[]>();for(const text of texts){const list=uses.get(text.style.fontFamily)??[];if(!list.includes(text.style.fontWeight))list.push(text.style.fontWeight);uses.set(text.style.fontFamily,list.sort((a,b)=>a-b));}
  return uses;
}
// A stable string for effects: families with their weights, in name order.
export const fontKey=(uses:ReadonlyMap<string,readonly number[]>)=>[...uses].sort(([a],[b])=>a.localeCompare(b)).map(([family,weights])=>`${family}:${weights.join("/")}`).join("|");
