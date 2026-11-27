"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Download, FlaskConical, ImageIcon, Loader2, Maximize2, Sparkles, X } from "./icons";
import r from "./studio-refine.module.css";
import t from "./studio-test.module.css";

// P1-06 3단계 원본(v1.39 app/(dashboard)/test/page.tsx) '결과 테스트 및 이미지 합성' 화면. 화면만 맡고 요청·기록은 작업실이 맡는다.
// 원본 구성: 단계 머리 → 왼쪽 380px '추론 및 생성 설정'(직접 편집 전환, 피사체 또는 대상 프롬프트, 참조 이미지 위젯, 이미지 생성 모델, 공정 시작, 유료 안내)
// → 오른쪽 원본 레퍼런스·DNA 합성 미리보기 두 카드(결과가 나오면 접고 '개별 이미지 보기'), '원본 ↔ 생성 비교', 색감 일치율·확대·다운로드, 확대 창.
// 제품 차이: 시험할 프롬프트 버전 고르기, 화면 비율, 따로 동의 없이 단추 옆에 Gemini로 보낼 내용 안내(CMD-044), 시험 결과가 보관함에 남아 '시험 기록'에서 다시 볼 수 있음,
// 일치율은 서버가 저장된 원본·결과에서 잰 5색 비교(원본은 브라우저 히스토그램), 참조 이미지는 PNG·JPG·WebP 4MB까지.
type Model = { id: string; label: string; size: string };
type TestItem = { id: string; revision: number; model: string; createdAt: string; image: { href: string; width: number; height: number };
  basis?: { promptMode: "revision" | "edited"; reference: { kind: "none" | "original" | "upload" } }; generation?: unknown };
type Props = {
  id: string; original: { href: string; width: number; height: number }; aspect: string | null;
  revisions: { revision: number; feedback?: string | null }[]; revision: number | null; onRevision: (revision: number) => void;
  editing: boolean; onEditing: (editing: boolean) => void;
  subject: string; subjectLimit: number; subjectNeeded: boolean; onSubject: (value: string) => void;
  prompt: string; promptLimit: number; onPrompt: (value: string) => void; promptNotice?: ReactNode;
  attach: boolean; onAttach: (attach: boolean) => void; reference: { href: string; name: string } | null;
  referenceAccept: string; onReference: (file: File | undefined) => void; onReferenceClear: () => void;
  models: Model[]; model: string; onModel: (model: string) => void; ratio: string; ratios: readonly string[]; onRatio: (ratio: string) => void;
  /** sendNote: 단추 옆 전송 안내(CMD-044, 따로 동의 체크 없음). */
  sendNote: string;
  /** P2-02 생성 공급자 모델: ratioFixed면 화면비를 그 값으로 고정, estimate는 단추 앞 예상 금액 줄, paidNote는 유료 안내, missingNote는 키 없음 안내. */
  ratioFixed?: string; estimate?: ReactNode; paidNote: string; missingNote: string;
  /** 결과 카드의 생성 출처(공급자·모델·견적·과금 미확정)와 시험 기록 줄 뒤 짧은 표시. */
  sourceText: (item: TestItem) => string; recordNote: (item: TestItem) => string;
  busy: boolean; running: boolean; canRun: boolean; onSubmit: (event: FormEvent) => void; missing: boolean;
  startBlock?: string | null; startRecovery?: ReactNode;
  tests: TestItem[]; shown: string | null; onShow: (id: string) => void; modelLabel: (model: string) => string;
  proximity: number | null; when: (iso: string) => string; compare: ReactNode;
};

const referenceText = (item: TestItem) => !item.basis ? "" : [item.basis.promptMode === "edited" ? "직접 편집" : "",
  { none: "참조 없음", original: "원본 참조", upload: "바꾼 참조" }[item.basis.reference.kind]].filter(Boolean).join(" · ");

export function StudioTest(p: Props) {
  const [singles, setSingles] = useState(false);
  const [zoom, setZoom] = useState(false);
  const zoomOpener = useRef<HTMLElement | null>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const zoomBox = useRef<HTMLDivElement>(null);
  const test = p.tests.find(item => item.id === p.shown) ?? null;
  const index = test ? p.tests.indexOf(test) + 1 : 0;
  const openZoom = (event: { currentTarget: HTMLElement }) => { zoomOpener.current = event.currentTarget; setZoom(true); };
  const closeZoom = () => { setZoom(false); zoomOpener.current?.focus(); };
  useEffect(() => { if (zoom) closer.current?.focus(); }, [zoom]);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setZoom(false); zoomOpener.current?.focus(); return; }
      // aria-modal 확대 창 안에서만 Tab·Shift+Tab이 돈다(components/ui/interactive.tsx 확인 창과 같은 처음↔끝 감싸기, 창 밖 초점은 창 안으로 되돌림)
      if (event.key !== "Tab" || !zoomBox.current) return;
      const items = [...zoomBox.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")];
      const first = items[0], last = items.at(-1);
      if (!first || !last) return;
      const inside = zoomBox.current.contains(document.activeElement);
      if (!inside) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  const download = test ? `style-dna-test-${index}-v${test.revision}.webp` : "";

  return <section className={r.page} aria-label="결과 테스트">
    <header className={r.stepHead}>
      <div className={r.stepTitle}><span className={r.stepNo} aria-hidden>3</span><h4>결과 테스트 및 이미지 합성</h4></div>
      <p>마스터 프롬프트로 실제 이미지를 한 장 만들어 원본과 나란히 비교합니다. 대상 프롬프트를 자유롭게 수정하거나 참조 이미지를 연결할 수 있습니다.</p>
    </header>

    <div className={t.grid}>
      <form className={r.card} onSubmit={p.onSubmit} aria-label="추론 및 생성 설정" aria-busy={p.busy || undefined}>
        <div className={t.panelHead}>
          <span>추론 및 생성 설정</span>
          <button type="button" className={t.textButton} aria-pressed={p.editing} disabled={p.busy} onClick={() => p.onEditing(!p.editing)}>
            {p.editing ? "기본 프롬프트 모드로" : "프롬프트 직접 편집"}</button>
        </div>

        <label className={t.field}><span>시험할 프롬프트 버전</span>
          <select value={p.revision ?? ""} disabled={p.busy} onChange={event => p.onRevision(Number(event.target.value))}>
            {p.revisions.map(item => <option key={item.revision} value={item.revision}>
              버전 {item.revision}{item.feedback ? ` · ${[...item.feedback].slice(0, 30).join("")}` : " · 처음 분석"}</option>)}</select></label>

        {!p.editing ? <label className={t.field}>
          <span>{p.subjectNeeded ? "피사체 대입 (필수)" : "피사체 대입 (선택)"}<span className={t.count}>{[...p.subject].length} / {p.subjectLimit}</span></span>
          <textarea className={t.mono} rows={3} maxLength={p.subjectLimit} value={p.subject} aria-invalid={p.subjectNeeded && !p.subject.trim() || undefined}
            placeholder="a young Korean woman in modern hanbok, cinematic lighting" onChange={event => p.onSubject(event.target.value)} />
          <small>{p.subjectNeeded ? "프롬프트의 [INSERT SUBJECT HERE] 자리에 들어갑니다. 예: a cybernetic cat sitting on a neon rooftop"
            : "현재 프롬프트에 자리표시자가 없으므로 피사체 없이 생성되거나 직접 편집할 수 있습니다."}</small>
        </label> : <label className={t.field}>
          <span>대상 프롬프트 직접 편집 (Target Prompt)<span className={t.count}>{[...p.prompt].length} / {p.promptLimit}</span></span>
          {p.promptNotice}
          <textarea className={`${t.mono} ${t.tall}`} rows={7} maxLength={p.promptLimit} value={p.prompt} lang="en" aria-invalid={!p.prompt.trim() || undefined}
            placeholder="Enter complete prompt..." onChange={event => p.onPrompt(event.target.value)} />
          <small>[주제 입력] 부분을 원하는 피사체로 바꾸거나 자유롭게 편집하세요.</small>
        </label>}

        <div className={t.reference} role="group" aria-label="참조 이미지 (Visual DNA Anchor)">
          <div className={t.referenceHead}>
            <span><ImageIcon size={14} aria-hidden />참조 이미지 (Visual DNA Anchor)</span>
            <button type="button" className={p.attach ? t.attached : t.detached} aria-pressed={p.attach} disabled={p.busy} onClick={() => p.onAttach(!p.attach)}>
              {p.attach ? "참조 이미지 연결됨" : "참조 이미지 없음"}</button>
          </div>
          <p>이미지를 첨부하면 생성 모델이 원본의 색감과 시각적 DNA를 직접 참고하여 완성도를 높입니다.</p>
          {p.attach && <div className={t.referenceRow}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.reference?.href ?? p.original.href} alt={p.reference ? `바꾼 참조 이미지 ${p.reference.name}` : "참조 이미지(원본)"} />
            <label className={t.referencePick}><span>참조 이미지 변경</span>
              <input type="file" accept={p.referenceAccept} disabled={p.busy} onChange={event => { p.onReference(event.target.files?.[0]); event.target.value = ""; }} /></label>
            {p.reference && <button type="button" className={t.reset} disabled={p.busy} onClick={p.onReferenceClear}>초기화</button>}
          </div>}
        </div>

        <div className={t.pair}>
          <label className={t.field}><span>이미지 생성 모델</span>
            <select value={p.model} disabled={p.busy} onChange={event => p.onModel(event.target.value)}>
              {p.models.map(model => <option key={model.id} value={model.id}>{model.label} · {model.size}</option>)}</select></label>
          <label className={t.field}><span>화면 비율</span>
            {p.ratioFixed ? <select value="fixed" disabled aria-describedby={`${p.id}-ratio-fixed`}><option value="fixed">{p.ratioFixed}</option></select>
              : <select value={p.ratio} disabled={p.busy} onChange={event => p.onRatio(event.target.value)}>
                <option value="">자동(원본에 가까운 {p.aspect ?? "비율"})</option>
                {p.ratios.map(value => <option key={value} value={value}>{value}</option>)}</select>}
            {p.ratioFixed && <small id={`${p.id}-ratio-fixed`}>이 모델은 크기가 고정이라 화면 비율을 고를 수 없어요.</small>}</label>
        </div>

        {p.estimate && <p className={t.paid} aria-label="예상 금액">{p.estimate}</p>}
        <p className={r.consent}>{p.sendNote}</p>
        <button type="submit" className={r.primary} disabled={!p.canRun} aria-describedby={p.startBlock ? `${p.id}-start-block` : undefined}>
          {p.running ? <Loader2 size={16} className={r.spin} aria-hidden /> : <FlaskConical size={16} aria-hidden />}
          {p.running ? "DNA 합성 시뮬레이션 중…" : "공정 시작 (이미지 1장 합성)"}</button>
        {p.startBlock && <>
          <p id={`${p.id}-start-block`} className={r.consent} role="status">{p.startBlock}</p>
          {p.startRecovery}
        </>}
        {p.missing && <p className={t.error} role="note">{p.missingNote}</p>}
        <p className={t.paid}>{p.paidNote}</p>
      </form>

      <div className={t.results}>
        <div className={t.singles} hidden={!!test && !singles}>
          <section className={r.card} aria-label="원본 레퍼런스">
            <div className={t.cardHead}><h5>원본 레퍼런스</h5><span className={t.ratio}>{p.aspect ?? `${p.original.width}×${p.original.height}`}</span></div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={t.shot} src={p.original.href} alt="원본 이미지" width={p.original.width} height={p.original.height} />
          </section>
          <section className={r.card} aria-label="DNA 합성 미리보기">
            <div className={t.cardHead}><h5>DNA 합성 미리보기</h5>
              {test && <button type="button" className={t.icon} title="확대 보기" aria-label="결과 확대 보기" onClick={openZoom}><Maximize2 size={16} /></button>}</div>
            {test ? <button type="button" className={t.shotButton} aria-label="결과 확대 보기" onClick={openZoom}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={t.shot} src={test.image.href} alt="생성된 이미지" width={test.image.width} height={test.image.height} /></button>
              : <div className={t.placeholder}><Sparkles size={24} aria-hidden />
                <span>{p.running ? "DNA 합성 시뮬레이션 중…" : "왼쪽에서 피사체를 입력하고 공정 시작을 눌러주세요."}</span></div>}
          </section>
        </div>

        {test && <section className={r.card} aria-label="원본 ↔ 생성 비교">
          <div className={t.cardHead}><h5>원본 ↔ 생성 비교</h5>
            <button type="button" className={t.textButton} aria-expanded={singles} onClick={() => setSingles(value => !value)}>
              {singles ? "개별 이미지 접기 ▴" : "개별 이미지 보기 ▾"}</button></div>
          {p.compare}
        </section>}

        {test && <section className={`${r.card} ${t.match}`} aria-label="색감 일치율">
          <div>
            <p className={t.matchLabel}>색감 일치율 (서버 실측 5색 비교)</p>
            <p className={t.matchValue}>{p.proximity === null ? "—" : `${p.proximity}%`}</p>
            <p className={t.matchNote}>원본과 결과 이미지에서 서버가 잰 주요 5색 분포를 비교한 값이에요(모델의 스타일 일치 추정 아님).</p>
            <p className={t.matchNote} aria-label="생성 출처">{p.sourceText(test)}</p>
          </div>
          <div className={t.matchActions}>
            <button type="button" className={r.ghost} onClick={openZoom}><Maximize2 size={14} aria-hidden />확대 보기</button>
            <a className={t.download} href={test.image.href} download={download}><Download size={14} aria-hidden />이미지 다운로드</a>
          </div>
        </section>}

        {p.tests.length > 0 && <section className={r.card} aria-label="시험 기록">
          <h5>시험 기록 ({p.tests.length})</h5>
          <ul className={t.tests}>
            {p.tests.map((item, n) => <li key={item.id}><label>
              <input type="radio" name={`${p.id}-test`} checked={p.shown === item.id} onChange={() => p.onShow(item.id)} />
              <span>{n + 1}번 · 버전 {item.revision} · {p.modelLabel(item.model)}{referenceText(item) && ` · ${referenceText(item)}`}{p.recordNote(item)}</span>
              <time dateTime={item.createdAt}>{p.when(item.createdAt)}</time></label></li>)}
          </ul>
        </section>}
      </div>
    </div>

    {zoom && test && <div className={t.overlay} onClick={closeZoom}>
      <div ref={zoomBox} className={t.zoom} role="dialog" aria-modal="true" aria-label="결과 확대 보기" onClick={event => event.stopPropagation()}>
        <button ref={closer} type="button" className={t.close} aria-label="닫기" onClick={closeZoom}><X size={24} /></button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={test.image.href} alt={`확대한 시험 결과 ${index}번`} width={test.image.width} height={test.image.height} />
        <a className={t.zoomDownload} href={test.image.href} download={download}><Download size={16} aria-hidden />고해상도 다운로드</a>
      </div>
    </div>}
  </section>;
}
