"use client";
// "영상 만드는 중이라 기다려요" on other job screens (T-102 13장 R-16). Only from values the jobs API already sends:
// a queued job's `blockedBy` is the kind of the job running now, and the running render row in the same list gives
// the project to link to. No guess: if the server does not say "render", nothing is shown.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { JobsData } from "@/lib/services/jobs";
import styles from "./render-panel.module.css";

type Job=JobsData["jobs"][number];
export type RenderWait={projectId:string|null;projectTitle:string|null};

export function renderWait(jobs:Job[],jobId:string):RenderWait|null{
  const job=jobs.find(item=>item.id===jobId);
  if(!job||job.status!=="queued"||job.kind==="render"||job.blockedBy!=="render")return null;
  const running=jobs.find(item=>item.kind==="render"&&item.status==="running");
  return {projectId:running?.projectId??null,projectTitle:running?running.projectTitle:null};
}

export function RenderWaitNote({wait,currentProjectId}:{wait:RenderWait;currentProjectId?:string}){
  const other=wait.projectId&&currentProjectId&&wait.projectId!==currentProjectId?` (${wait.projectTitle})`:"";
  return <p className={styles.wait}><span>영상 만드는 중이라 기다려요. 영상이 끝나면 이어서 시작해요.</span>{wait.projectId&&<Link className={styles.waitLink} href={`/projects/${wait.projectId}/render`}>영상 만들기 진행 보기{other}</Link>}</p>;
}

// Screens whose data has only job ids read the existing /api/jobs list while one of those jobs is queued (2 s, like
// their own polling). Returns a lookup by job id.
export function useRenderWait(queuedJobIds:string[]){
  const key=queuedJobIds.join(","),[jobs,setJobs]=useState<{key:string;list:Job[]}|null>(null);
  useEffect(()=>{
    if(!key)return;let stopped=false;
    const load=async()=>{try{const response=await fetch("/api/jobs",{cache:"no-store"});if(!response.ok)return;const data:JobsData=await response.json();if(!stopped)setJobs({key,list:data.jobs});}catch{/* the note is optional; the job card still shows its own wait */}};
    void load();const timer=setInterval(()=>void load(),2000);
    return()=>{stopped=true;clearInterval(timer);};
  },[key]);
  return (jobId:string)=>key&&jobs?.key===key?renderWait(jobs.list,jobId):null;
}
