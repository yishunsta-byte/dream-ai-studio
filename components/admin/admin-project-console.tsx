"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/ui/primitives";
import { statusDisplay } from "@/lib/ui/status";
import type { CloudProjectCard } from "@/lib/cloud/project-read-page";
import styles from "./admin.module.css";

const states = ["queued", "running", "approval", "done", "warning"] as const;

export function AdminProjectConsole({ projects }: { projects: readonly CloudProjectCard[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const query = search.trim().toLocaleLowerCase("ko-KR");
  const visible = projects.filter(project =>
    project.title.toLocaleLowerCase("ko-KR").includes(query) && (!status || project.status === status));

  return <>
    <div className={styles.filters}>
      <label>
        <span>프로젝트 이름 검색</span>
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      <label>
        <span>작업 상태</span>
        <select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">전체 상태</option>
          {states.map(state => <option key={state} value={state}>{statusDisplay[state].label}</option>)}
        </select>
      </label>
      <p className={styles.note} role="status">{visible.length}개 표시</p>
    </div>
    {visible.length === 0 ? <p className={styles.noMatches}>검색 조건에 맞는 프로젝트가 없어요.</p> : <>
      <div className={styles.columnHead} aria-hidden="true">
        <span>프로젝트</span><span>현재 상태</span><span>내용 버전</span><span>출력 파일</span><span>다음 단계</span>
      </div>
      <ul className={styles.projects}>
        {visible.map(project => <li key={project.id} className={styles.project}>
          <div className={styles.projectIdentity}>
            <h4 className={styles.projectTitle}>
              <Link className={styles.link} href={`/cloud/projects/${project.id}#admin-project-heading`}>
                {project.title}<span className="sr-only"> 상세 보기</span>
              </Link>
            </h4>
            <p className={styles.note}>{project.menuLabel} · {project.aspect} · {project.lengthSec}초</p>
          </div>
          <div className={styles.projectStatus}><StatusPill status={project.status} /></div>
          <p className={`${styles.missingValue} ${styles.revision}`}><span>내용 버전</span> 확인 불가</p>
          <p className={`${styles.missingValue} ${styles.output}`}><span>출력 파일</span> 확인 불가</p>
          <p className={styles.nextStage}>다음 단계 {project.nextStageLabel}</p>
        </li>)}
      </ul>
    </>}
  </>;
}
