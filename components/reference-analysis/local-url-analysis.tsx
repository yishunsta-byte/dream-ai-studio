"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { inspectUrl } from "@/app/(studio)/studio/reference-analysis/actions";
import { readLocalUrlDrafts, readLocalUrlVersions, saveLocalUrlDraft, saveLocalUrlVersion, type LocalUrlVersion } from "@/lib/reference-analysis/local-url-history";
import { RegisteredAnalysisResults } from "./studio-registered-analysis";
import styles from "./studio-registered-analysis.module.css";

const savedAt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "medium" });
function versionLabel(version: LocalUrlVersion, number: number) {
  const source = new URL(version.url);
  const file = source.pathname.split("/").at(-1) || source.hostname;
  return `버전 ${number} · ${savedAt.format(new Date(version.createdAt))} · ${file}`;
}

export function LocalUrlAnalysis() {
  const form = useRef<HTMLFormElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const [url, setUrl] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState<LocalUrlVersion>();
  const [history, setHistory] = useState<LocalUrlVersion[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [pendingDraftsByVersion, setPendingDraftsByVersion] = useState<Partial<Record<string, Record<number, string>>>>({});
  const [storageError, setStorageError] = useState("");
  const [saved, setSaved] = useState(false);
  const pendingDrafts = version ? pendingDraftsByVersion[version.id] : undefined;

  useLayoutEffect(() => {
    function readHistory() {
      try { setHistory(readLocalUrlVersions(window.localStorage)); }
      catch { setStorageError("이 브라우저의 저장된 분석을 열지 못했어요."); }
    }
    readHistory();
    window.addEventListener("storage", readHistory);
    return () => window.removeEventListener("storage", readHistory);
  }, []);

  useLayoutEffect(() => {
    const heading = resultHeading.current;
    if (!version || !heading) return;
    const active = document.activeElement;
    // 실행 버튼이 비활성화되면 초점이 본문으로 돌아갈 수 있다. 다른 조작으로 옮긴 초점은 유지한다.
    if (active !== document.body && !form.current?.contains(active)) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "center", inline: "nearest" });
  }, [version]);

  function reset() {
    setError("");
    setVersion(undefined);
    setDrafts({});
    setSaved(false);
    setStorageError("");
  }

  function openVersion(id: string) {
    const stored = history.find(item => item.id === id);
    if (!stored) { reset(); return; }
    setUrl(stored.url);
    setAuthorized(false);
    setError("");
    setStorageError("");
    setVersion(stored);
    setSaved(true);
    try { setDrafts(readLocalUrlDrafts(window.localStorage, stored)); }
    catch {
      setDrafts({});
      setStorageError("저장된 수정본을 열지 못했어요.");
    }
  }

  return <section className={styles.panel} aria-labelledby="local-url-heading">
    <h2 id="local-url-heading">공개 URL 분석</h2>
    <p className={styles.muted}>MDN과 Tone.js의 공개 이미지·음악·영상 파일을 이 PC에서 분석해요. 음악은 24초, 영상은 20초·240프레임까지 지원해요.</p>
    <form ref={form} className={styles.analysis} onSubmit={async event => {
      event.preventDefault();
      if (running || !authorized) return;
      reset(); setRunning(true);
      try {
        const response = await inspectUrl(url.trim(), authorized);
        if (response.result) {
          const current = { id: crypto.randomUUID(), url: url.trim(), createdAt: new Date().toISOString(), result: response.result };
          setVersion(current);
          try {
            saveLocalUrlVersion(window.localStorage, current);
            setSaved(true);
            setHistory(readLocalUrlVersions(window.localStorage));
          } catch { setStorageError("분석 결과를 이 브라우저에 저장하지 못했어요."); }
        } else setError(response.error);
      } catch { setError("분석 결과를 받지 못했어요. 다시 시도해 주세요."); }
      finally { setRunning(false); }
    }}>
      <label htmlFor="local-media-url">미디어 파일 URL</label>
      <input className={styles.field} id="local-media-url" type="url" value={url} required disabled={running}
        onChange={event => { setUrl(event.target.value); setAuthorized(false); reset(); }} />
      <label><input type="checkbox" checked={authorized} disabled={running} onChange={event => { setAuthorized(event.target.checked); reset(); }} /> 이 자료를 분석할 권리가 있어요.</label>
      <button className={styles.button} type="submit" disabled={running || !authorized || !url.trim()}>{running ? "분석 중…" : "URL 분석 실행"}</button>
    </form>
    {history.length > 0 && <div>
      <label className={styles.label} htmlFor="local-url-version">저장된 분석 버전</label>
      <select className={styles.field} id="local-url-version" value={saved ? version?.id ?? "" : ""} disabled={running}
        onChange={event => openVersion(event.target.value)}>
        <option value="">분석 버전 선택</option>
        {history.map((item, index) => <option key={item.id} value={item.id}>{versionLabel(item, history.length - index)}</option>)}
      </select>
      <p className={styles.muted}>분석 결과와 수정본은 이 브라우저에 저장돼요.</p>
    </div>}
    {storageError && <p className={styles.notice} role="status">{storageError}</p>}
    {pendingDrafts && <p className={styles.notice} role="status">수정본을 이 브라우저에 저장하지 못했어요.</p>}
    {error && <div className={styles.notice} role="alert"><p>{error}</p><p>표시할 관찰 근거와 비교할 프롬프트가 없어요.</p></div>}
    {version && <section className={styles.panel} aria-labelledby="local-url-result-heading">
      <h3 id="local-url-result-heading" ref={resultHeading} tabIndex={-1}>분석 결과</h3>
      <RegisteredAnalysisResults key={version.id} result={version.result} sourceUrl={version.url} savedDrafts={{ values: { ...drafts, ...pendingDrafts }, onEdit: (index, prompt) => {
        if (!saved) {
          setDrafts(previous => ({ ...previous, [index]: prompt }));
          return;
        }
        try {
          saveLocalUrlDraft(window.localStorage, version, index, prompt);
          setDrafts(previous => ({ ...previous, [index]: prompt }));
          setPendingDraftsByVersion(previous => {
            const pending = previous[version.id];
            if (pending?.[index] === undefined) return previous;
            const remaining = { ...pending };
            delete remaining[index];
            const next = { ...previous };
            if (Object.keys(remaining).length) next[version.id] = remaining;
            else delete next[version.id];
            return next;
          });
        } catch {
          setPendingDraftsByVersion(previous => ({
            ...previous,
            [version.id]: { ...previous[version.id], [index]: prompt },
          }));
        }
      } }} />
    </section>}
  </section>;
}
