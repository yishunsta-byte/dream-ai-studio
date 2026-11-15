"use client";
import Image from "next/image";
import { useState } from "react";
import { SampleBadge } from "./ui/primitives";
import styles from "./production-panel.module.css";
type ResultAsset={id:string;title:string;kind:string;isMock:boolean;available:boolean};
export function ResultPreview({asset}:{asset:ResultAsset|null}){const [failed,setFailed]=useState(false);if(!asset)return <div className={styles.placeholder}>결과를 기다리고 있어요.</div>;if(!asset.available||failed)return <div className={styles.placeholder} role="status">결과 파일을 읽지 못했어요. 저장 위치를 확인해 주세요.</div>;const src=`/api/assets/${asset.id}`;return <div className={styles.preview}>{asset.isMock&&<SampleBadge/>}{asset.kind==="image"?<Image unoptimized src={src} alt={asset.title} width={320} height={568} className={styles.image} onError={()=>setFailed(true)}/>:asset.kind==="video"?<video controls preload="metadata" aria-label={asset.title} src={src} onError={()=>setFailed(true)}/>:<audio controls preload="metadata" aria-label={asset.title} src={src} onError={()=>setFailed(true)}/>}</div>;}
