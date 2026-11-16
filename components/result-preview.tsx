"use client";
import Image from "next/image";
import { useState } from "react";
import { SampleBadge } from "./ui/primitives";
import { Icon } from "./ui/Icon";
import styles from "./production-panel.module.css";
type ResultAsset={id:string;title:string;kind:string;isMock:boolean;available:boolean};
// What the empty slot says depends on the job state (T-013 3.3). "기다리는" wording is only for queued/running.
export type PlaceholderState={status:"none"|"queued"|"running"|"failed"|"canceled";queuePosition?:number|null;elapsedSec?:number|null};
export function placeholderText(state:PlaceholderState){
 if(state.status==="queued")return state.queuePosition?`대기 중 · 작업 대기열 ${state.queuePosition}번째`:"대기 중 · 결과를 기다리고 있어요.";
 if(state.status==="running")return state.elapsedSec!=null?`만드는 중 · ${state.elapsedSec}초 지남`:"만드는 중 · 결과를 기다리고 있어요.";
 if(state.status==="failed")return "만들지 못했어요.";
 if(state.status==="canceled")return "취소했어요.";
 return "아직 만들지 않았어요.";
}
const icons={none:"folder",queued:"clock",running:"spinner",failed:"warning",canceled:"close"} as const;
export function ResultPreview({asset,state={status:"none"}}:{asset:ResultAsset|null;state?:PlaceholderState}){const [failed,setFailed]=useState(false);if(!asset)return <div className={`${styles.placeholder} ${state.status==="failed"?styles.placeholderDanger:""}`} role={state.status==="queued"||state.status==="running"?"status":undefined}><Icon name={icons[state.status]} className={`${styles.icon} ${state.status==="running"?styles.spin:""}`} aria-hidden="true"/><span>{placeholderText(state)}</span></div>;if(!asset.available||failed)return <div className={styles.placeholder} role="status"><Icon name="warning" className={styles.icon} aria-hidden="true"/><span>결과 파일을 읽지 못했어요. 저장 위치를 확인해 주세요.</span></div>;const src=`/api/assets/${asset.id}`;return <div className={styles.preview}>{asset.isMock&&<SampleBadge/>}{asset.kind==="image"?<Image unoptimized src={src} alt={asset.title} width={320} height={568} className={styles.image} onError={()=>setFailed(true)}/>:asset.kind==="video"?<video controls preload="metadata" aria-label={asset.title} src={src} onError={()=>setFailed(true)}/>:<audio controls preload="metadata" aria-label={asset.title} src={src} onError={()=>setFailed(true)}/>}</div>;}
