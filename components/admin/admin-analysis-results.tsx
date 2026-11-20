"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Callout } from "@/components/ui/primitives";
import { AnalysisPublicationForm, PublicationList, type PublicationListView } from "./admin-analysis-publication";
import { analysisResultsSection, useAdminSection } from "./admin-navigation";
import {
  createAdminReferenceAnalysisClient, failureMessage, type Failure, type PublicationDraft,
} from "./admin-reference-analysis-model";
import hub from "./admin.module.css";
import styles from "./admin-premiere-programs.module.css";

export type PreparedPublication = { draft: PublicationDraft; revision: number };
const client = createAdminReferenceAnalysisClient();
const loginLink = "/admin/login?next=%2Fadmin%23admin-analysis-results";

export function AdminAnalysisResults({ prepared, selectionMessage, onSendingChange }: {
  prepared?: PreparedPublication;
  selectionMessage?: string;
  onSendingChange: (sending: boolean) => void;
}) {
  const active = useAdminSection() === analysisResultsSection;
  const activeRef = useRef(false);
  const [list, setList] = useState<PublicationListView>({ kind: "loading" });
  const [blocked, setBlocked] = useState<Failure>();
  const listRequest = useRef<AbortController | null>(null);

  useLayoutEffect(() => { activeRef.current = active; }, [active]);

  const block = useCallback((failure: Failure) => {
    if (failure.kind !== "login" && failure.kind !== "forbidden") return false;
    listRequest.current?.abort();
    listRequest.current = null;
    setBlocked(failure);
    return true;
  }, []);

  const loadList = useCallback(() => {
    if (!activeRef.current || listRequest.current) return;
    const controller = new AbortController();
    listRequest.current = controller;
    return client.list(controller.signal).then(outcome => {
      if (controller.signal.aborted) return;
      listRequest.current = null;
      if (outcome.kind === "ok") setList(outcome);
      else if (!block(outcome)) setList({ kind: "failed", message: failureMessage(outcome) });
    });
  }, [block]);

  const refreshAfterWrite = useCallback(async () => {
    listRequest.current?.abort();
    listRequest.current = null;
    if (activeRef.current) setList({ kind: "loading" });
    await loadList();
  }, [loadList]);

  useEffect(() => {
    if (!active || blocked) return;
    void loadList();
    return () => {
      listRequest.current?.abort();
      listRequest.current = null;
    };
  }, [active, blocked, loadList]);

  return <section id={analysisResultsSection} tabIndex={-1} aria-labelledby="admin-analysis-results-title"
    className={`${hub.target} ${hub.section}`}>
    <div className={hub.sectionHead}>
      <h2 id="admin-analysis-results-title" tabIndex={-1}>분석 결과 관리</h2>
      <Link className={hub.link} href="/analysis-results" prefetch={false} target="_blank" rel="noreferrer">웹 공개 결과 보기</Link>
    </div>
    {selectionMessage && !blocked && <p className={styles.note} role="status">{selectionMessage}</p>}
    {blocked ? <Callout tone="danger" title={failureMessage(blocked)}>
      {blocked.kind === "login" && <a href={loginLink}>관리자 로그인</a>}
    </Callout> : <div className={styles.resultsDesk}>
      {prepared && <div className={styles.control}>
        <AnalysisPublicationForm key={prepared.revision} initialDraft={prepared.draft} client={client}
          onBlocked={block} onSendingChange={onSendingChange} onPublished={() => { void refreshAfterWrite(); }} />
      </div>}
      {(active || prepared) && <div className={styles.control}>
        <PublicationList list={list} client={client} onBlocked={block} reload={refreshAfterWrite} />
      </div>}
    </div>}
  </section>;
}
