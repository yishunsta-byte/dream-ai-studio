"use client";
import { useEffect, useMemo, useState } from "react";
import type { FontRef } from "@/lib/edit/fonts";

// P2-3 fonts in the browser (T-080 5.4, T-082 contract). Pretendard is the next/font face (--font-pretendard); every
// other family is registered once under its spec name from its file, so the CSS name is ours, not the file's internal
// name. States (T-086): "unavailable" = not selectable now (not installed or no license; retrying cannot help),
// "failed" = the file or face failed (retry can help), "timeout" = still loading after 20 s (big files such as
// Noto Serif KR ≈ 24 MB). A timed-out face keeps loading; when it settles the state is updated (ok or failed).
export type FontState="ok"|"unavailable"|"failed"|"timeout";
export const FONT_TIMEOUT_MS=20000;
const faces=new Map<string,Promise<boolean>>();
function register(font:FontRef){
  let face=faces.get(font.family);
  if(!face){
    const weight=font.weights.length>1?`${Math.min(...font.weights)} ${Math.max(...font.weights)}`:String(font.weights[0]??400);
    face=new FontFace(font.family,`url("${font.url}")`,{weight,display:"block"}).load().then(loaded=>{document.fonts.add(loaded);return true;},()=>false);
    faces.set(font.family,face);
    // A failed face is forgotten so "글꼴 다시 불러오기" fetches the file again.
    void face.then(ok=>{if(!ok&&faces.get(font.family)===face)faces.delete(font.family);});
  }
  return face;
}
async function load(family:string,font:FontRef,weights:readonly number[]):Promise<boolean>{
  if(family==="Pretendard"){
    const name=getComputedStyle(document.documentElement).getPropertyValue("--font-pretendard").split(",")[0]?.trim();if(!name)return false;
    const sets=await Promise.all(weights.map(weight=>document.fonts.load(`${weight} 64px ${name}`,"가A1")));
    return sets.every(set=>set.length>0&&set.every(face=>face.status==="loaded"));
  }
  if(!await register(font))return false;
  const sets=await Promise.all(weights.map(weight=>document.fonts.load(`${weight} 64px "${family}"`,"가A1")));
  return sets.every(set=>set.length>0);
}
// Every family the texts use, each with the weights they use. The result comes when each family is ok, failed,
// unavailable or past 20 s; a family that settles after its timeout is reported through onLate (after the result).
export async function loadFonts(uses:ReadonlyMap<string,readonly number[]>,fonts:readonly FontRef[],onLate?:(family:string,state:FontState)=>void):Promise<Record<string,FontState>>{
  const states:Record<string,FontState>={};let reported=false;
  await Promise.all([...uses].map(async([family,weights])=>{
    const font=fonts.find(item=>item.family===family);if(!font&&family!=="Pretendard"){states[family]="unavailable";return;}
    let timer:ReturnType<typeof setTimeout>|undefined;
    const timeout=new Promise<FontState>(resolve=>{timer=setTimeout(()=>resolve("timeout"),FONT_TIMEOUT_MS);});
    const done=load(family,font??{family:"Pretendard",role:"",weights:[],url:""},weights.length?weights:[400]).then(ok=>ok?"ok" as const:"failed" as const,()=>"failed" as const);
    const first=await Promise.race([done,timeout]);clearTimeout(timer);states[family]=first;
    if(first==="timeout")void done.then(state=>{if(reported)onLate?.(family,state);else states[family]=state;});
  }));
  reported=true;return {...states};
}
export function fontUses(texts:readonly {style:{fontFamily:string;fontWeight:number}}[]){
  const uses=new Map<string,number[]>();for(const text of texts){const list=uses.get(text.style.fontFamily)??[];if(!list.includes(text.style.fontWeight))list.push(text.style.fontWeight);uses.set(text.style.fontFamily,list.sort((a,b)=>a-b));}
  return uses;
}
// A stable string for effects: families with their weights, in name order.
export const fontKey=(uses:ReadonlyMap<string,readonly number[]>)=>[...uses].sort(([a],[b])=>a.localeCompare(b)).map(([family,weights])=>`${family}:${weights.join("/")}`).join("|");
const usesOf=(key:string)=>new Map(key?key.split("|").map(part=>{const [family,weights]=part.split(":");return [family,weights.split("/").map(Number)] as const;}):[]);

// "글꼴 다시 불러오기" reaches every hook on the page (the Player and the off-screen measure), edits stay as they are.
const retryListeners=new Set<()=>void>();
export function retryFonts(){for(const listener of retryListeners)listener();}
export type FontResult={key:string;attempt:number;states:Record<string,FontState>};
// Font states for the texts. Only the newest attempt for the newest key may write (an older or cancelled load is
// ignored), and a late face updates the state it timed out in. The previous result stays until the new one comes, so
// the Player is not taken down when a font changes.
export function useFontStates(texts:readonly {style:{fontFamily:string;fontWeight:number}}[],fonts:readonly FontRef[]){
  const key=useMemo(()=>fontKey(fontUses(texts)),[texts]);
  const [attempt,setAttempt]=useState(0),[result,setResult]=useState<FontResult|null>(null);
  useEffect(()=>{const listener=()=>setAttempt(count=>count+1);retryListeners.add(listener);return ()=>{retryListeners.delete(listener);};},[]);
  useEffect(()=>{let live=true;
    void loadFonts(usesOf(key),fonts,(family,state)=>{if(live)setResult(old=>old&&old.key===key&&old.attempt===attempt?{...old,states:{...old.states,[family]:state}}:old);})
      .then(states=>{if(live)setResult({key,attempt,states});});
    return ()=>{live=false;};},[key,fonts,attempt]);
  return {key,result};
}
