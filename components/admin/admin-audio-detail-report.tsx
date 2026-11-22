"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/primitives";
import type { DetailedAudioResponse } from "@/lib/reference-analysis/admin-audio-details-contract";
import {
  clockText, interviewMarkdown, markdownName, measurementText, meetingMarkdown, searchSegments, segmentTime, speakerCounts, transcriptText,
  unknownValue, type DetailedMusic, type DetailedSpeech,
} from "./audio-detail-report";
import styles from "./admin-music-semantic.module.css";
import own from "./admin-audio-detail-report.module.css";
import { SunoPrompt } from "./admin-suno-prompt";

// P1-07 상세 오디오 보고서(v2) 화면. A-3에서 원본 v1.15 MusicReportView·SpeechReportView의 읽기 순서로 다시 놓았다.
// - 음악: 핵심 카드 4개(장르·템포·조성·기술 사양) → Suno 역설계 프롬프트 → 음향 포렌식 → 4대 스템 → 곡 구조·채보 → 가사 → 스타일·편곡.
// - 음성: 핵심 카드 4개 → 전체 요약(새 파일 분석) → 탭 두 개[시각 리포트(점유율·화자·질문·실행 과제·키워드·종합 통찰·전사 표본) | 문서(회의록·인터뷰 Markdown)].
// 칸마다 근거를 적는다: 기술 사양·재생 시간은 서버 실측(FFprobe), 나머지는 Gemini 모델 추정. 받지 못한 값은 '확인되지 않음'으로 두고
// 원본의 기본값(120 BPM·C Major·44.1kHz 등)을 지어내지 않는다. B-2 확장 프로필(7e7a264)의 선택 항목(스타일·채보·비트·출처 추정·종합 통찰·
// 화자 전환 분위기)도 모델 추정이며, 없으면 같은 방식으로 비운다. 전사는 받은 표본(최대 80구간)이고 전체 전사가 아니다.
// 검색·복사·Markdown은 이미 받은 결과로만 동작한다(모델 호출 0). 스템은 모델이 쓴 설명이고 분리 파일이 아니며, 음질·출처는 확정하지 않는다.
const kindName = { music: "음악", speech: "음성", undetermined: "판별 불가" } as const;
const modeName = { music: "음악", speech: "음성", auto: "자동 판별" } as const;
const unavailableText = {
  not_configured: "음악 분석 모델이 설정되지 않았어요.",
  provider_error: "모델의 응답을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  invalid_response: "모델의 상세 분석 결과를 확인할 수 없어요.",
  timed_out: "응답 시간이 길어졌어요. 더 짧은 파일로 다시 시도해 주세요.",
  undetermined: "음악인지 음성인지 판별하지 못했어요. 자동으로 다시 보내지 않았어요. ‘음성’ 또는 ‘음악’ 모드를 골라 다시 실행해 주세요.",
} as const;
const notationName = { chord_sheet: "코드 시트", abc: "ABC 악보", text: "텍스트 표기" } as const;
const value = (text: string | null | undefined) => text ?? unknownValue;
const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

type Props = {
  result: DetailedAudioResponse; fileName: string; onReset?: () => void;
  /** A-5 원본 셸: 완료 보고서 제목을 초점 받을 수 있게 둔다. 초점은 입력 칸이 접힌 뒤 스튜디오가 한 번 옮긴다(A-5b). */
  focusOnShow?: boolean;
};

/** A-5: 입력 화면 대신 보여 줄 '정상 완료' 상세 보고서(상세를 만들지 못한 응답은 입력 화면에 남긴다). */
export const completedDetail = (result: DetailedAudioResponse) => result.status !== "unavailable";

export function DetailedAudioReport({ result, fileName, onReset, focusOnShow }: Props) {
  const auto = result.requestedMode === "auto";
  const focusable = !!focusOnShow && completedDetail(result);
  if (result.status === "unavailable") {
    const message = unavailableText[result.reason];
    return <div className={styles.report}>
      <h4>상세 보고서</h4>
      {auto && <p>자동 판별 결과 · {kindName[result.kind]}</p>}
      <p role="status">{auto && result.kind !== "undetermined" && result.reason !== "undetermined"
        ? `${kindName[result.kind]}으로 판별했지만 상세 보고서를 만들지 못했어요. ${message}` : message}</p>
    </div>;
  }
  return <div className={styles.report}>
    <div className={own.head}>
      <div className={own.headRow}>
        <h4 tabIndex={focusable ? -1 : undefined} data-report-heading={focusable || undefined}>{result.kind === "speech" ? "상세 음성 보고서" : "상세 음악 보고서"}</h4>
        {onReset && <Button type="button" variant="secondary" size="sm" onClick={onReset}>새 파일 분석</Button>}
      </div>
      <p>{fileName} · 요청 모드 {modeName[result.requestedMode]}{auto ? ` · 자동 판별 결과 ${kindName[result.kind]}` : ""}</p>
      <p className={own.measure}>{measurementText(result.measurement)}</p>
      <p className={styles.hint}>Gemini 모델 추정 · {result.status === "partial" ? "일부 항목만 확인" : "제공된 파일 기준"} ·
        {" "}‘{unknownValue}’은 음원에서 확인하지 못한 항목이에요.</p>
    </div>
    {result.kind === "speech" ? <SpeechDetail result={result} fileName={fileName} /> : <MusicDetail result={result} />}
  </div>;
}

function Facts({ label, items, className }: { label: string; items: readonly [string, ReactNode][]; className?: string }) {
  return <dl className={className ?? own.facts} aria-label={label}>
    {items.map(([name, content]) => <div key={name}><dt>{name}</dt><dd>{content}</dd></div>)}
  </dl>;
}
/** 칸 근거 표시: 서버 실측 또는 모델 추정. */
function Source({ probe }: { probe?: boolean }) {
  return <span className={probe ? own.probe : own.estimate}>{probe ? "서버 실측" : "모델 추정"}</span>;
}
function Card({ title, probe, children, wide }: { title: string; probe?: boolean; children: ReactNode; wide?: boolean }) {
  const id = useId();
  return <section className={wide ? `${own.card} ${own.wide}` : own.card} aria-labelledby={id}>
    <h5 id={id} className={own.cardTitle}><span>{title}</span>{probe !== undefined && <Source probe={probe} />}</h5>
    {children}
  </section>;
}
function Kpi({ label, probe, main, sub }: { label: string; probe?: boolean; main: ReactNode; sub?: ReactNode }) {
  return <li className={own.kpi}>
    <span className={own.kpiLabel}>{label} <Source probe={probe} /></span>
    <strong className={own.kpiMain}>{main}</strong>
    {sub !== undefined && <div className={own.kpiSub}>{sub}</div>}
  </li>;
}
function useCopy() {
  const [message, setMessage] = useState("");
  async function copy(text: string, done: string, fallback?: HTMLElement | null) {
    try { await navigator.clipboard.writeText(text); setMessage(done); }
    catch { fallback?.focus(); setMessage("복사하지 못했어요. 내용을 선택해 직접 복사해 주세요."); }
  }
  return [message, copy] as const;
}

function SpeechDetail({ result, fileName }: { result: DetailedSpeech; fileName: string }) {
  const id = useId();
  const [tab, setTab] = useState<"visual" | "document">("visual");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const { summary, speakers, delivery, acousticQuality } = result.report;
  const probe = result.measurement.source === "server_probe" ? result.measurement : undefined;
  const order = ["visual", "document"] as const;
  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    const at = order.indexOf(tab);
    const next = event.key === "ArrowRight" ? (at + 1) % order.length : event.key === "ArrowLeft" ? (at + order.length - 1) % order.length
      : event.key === "Home" ? 0 : event.key === "End" ? order.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(order[next]);
    tabs.current[next]?.focus();
  }
  return <>
    <ul className={own.kpis} aria-label="핵심 음성 정보">
      <Kpi label="총 화자 수" main={speakers ? `${speakers.length}명` : unknownValue} sub={speakers ? speakers.map(({ name }) => name).join(", ") : undefined} />
      <Kpi label="재생 시간" probe main={probe ? clockText(probe.durationSeconds) : unknownValue} sub={probe ? undefined : "서버 실측을 하지 못했어요"} />
      <Kpi label="감정 및 톤" main={value(delivery?.tone)} />
      <Kpi label="음질 선명도" main={value(acousticQuality?.clarity)} sub={`배경 ${value(acousticQuality?.background)}`} />
    </ul>
    <Card title="전체 대화 핵심 요약" probe={false} wide><p>{value(summary)}</p></Card>
    <div role="tablist" aria-label="음성 보고서 보기" className={own.tabs}>
      {order.map((item, index) => <button key={item} ref={node => { tabs.current[index] = node; }} type="button" role="tab" id={`${id}-${item}`}
        aria-selected={tab === item} aria-controls={`${id}-${item}-panel`} tabIndex={tab === item ? 0 : -1} className={own.tab}
        onClick={() => setTab(item)} onKeyDown={onKey}>
        {item === "visual" ? "시각적 인텔리전스 리포트" : "비즈니스 문서 생성 (회의록·인터뷰)"}
      </button>)}
    </div>
    <div role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}`} className={own.panel}>
      {tab === "visual" ? <SpeechVisual result={result} /> : <MarkdownDocs result={result} fileName={fileName} />}
    </div>
  </>;
}

function SpeechVisual({ result }: { result: DetailedSpeech }) {
  const { topicsAndKeywords, actionItems, speakers, questions, delivery, acousticQuality, transcription } = result.report;
  const extra = result.report.additionalFindings ?? undefined;
  const segments = transcription.status === "sampled" ? transcription.segments : [];
  const counts = speakerCounts(segments);
  return <>
    <div className={own.grid}>
      <Card title="화자별 발언 점유율" probe={false}>
        {counts.length > 0 ? <>
          <p className={styles.hint}>발화 건수는 받은 전사 표본 {segments.length}구간 기준이에요(말한 시간이 아니에요).</p>
          <ul className={own.bars} aria-label="화자별 발화 건수">{counts.map(({ name, count }) => {
            const percent = Math.round(count / segments.length * 100);
            return <li key={name}>
              <span>{name}</span><span className={own.bar} aria-hidden="true"><span style={{ inlineSize: `${percent}%` }} /></span>
              <span>{count}건 ({percent}%)</span>
            </li>;
          })}</ul>
        </> : <p>{unknownValue}</p>}
      </Card>
      <Card title="화자별 심층 프로파일링" probe={false}>
        {speakers ? <ul className={own.cards}>{speakers.map((speaker, index) => <li key={index}>
          <strong>{speaker.name}</strong>
          <Facts label={`${speaker.name} 분석`} items={[["역할", value(speaker.role)], ["화법", value(speaker.manner)], ["기여", value(speaker.contribution)]]} />
        </li>)}</ul> : <p>{unknownValue}</p>}
      </Card>
    </div>
    <div className={own.grid}>
      <Card title={`주요 질문 및 논점 (${questions?.length ?? 0}건)`} probe={false}>
        {questions ? <ol className={own.questions}>{questions.map((question, index) => <li key={index}>
          <strong>Q{index + 1}. {question.text}</strong>
          <p className={styles.hint}>질문자 {value(question.speaker)} · 맥락 {value(question.context)}</p>
        </li>)}</ol> : <p>{unknownValue}</p>}
      </Card>
      <Card title={`결정 사항 & 실행 과제 (${actionItems?.length ?? 0}건)`} probe={false}>
        {actionItems ? <ol className={styles.structure}>{actionItems.map(({ task, assignee, dueDate }, index) => <li key={index}>
          <span className={styles.step}>{index + 1}</span>
          <div><strong>{task}</strong><p className={styles.hint}>담당 {value(assignee)} · 기한 {value(dueDate)}</p></div>
        </li>)}</ol> : <p>{unknownValue}</p>}
      </Card>
    </div>
    <Card title="주요 주제 및 키워드" probe={false} wide>
      {topicsAndKeywords ? <ul className={styles.topics}>{topicsAndKeywords.map(({ topic, keywords }, index) => <li key={index}>
        <strong>{topic}</strong>
        {keywords ? <ul className={styles.chips} aria-label={`${topic} 키워드`}>{keywords.map((keyword, at) => <li key={at}>#{keyword}</li>)}</ul>
          : <span className={styles.hint}>키워드 {unknownValue}</span>}
      </li>)}</ul> : <p>{unknownValue}</p>}
    </Card>
    <Card title="종합 통찰 · 대화 흐름" probe={false} wide>
      <Facts label="종합 통찰" items={[["종합 통찰", value(extra?.overallInsights)], ["화자 전환 분위기", value(extra?.speakerTransitionTone)]]} />
      <h6 className={own.sub}>말하기 속도와 침묵</h6>
      {delivery ? <Facts label="말하기 속도와 침묵" items={[["톤", value(delivery.tone)], ["속도", value(delivery.pace)], ["멈춤", value(delivery.pauses)], ["추임새", value(delivery.fillers)]]} />
        : <p>{unknownValue}</p>}
      <h6 className={own.sub}>음질·배경음</h6>
      {acousticQuality ? <Facts label="음질·배경음" items={[["명료도", value(acousticQuality.clarity)], ["배경", value(acousticQuality.background)], ["문제", value(acousticQuality.issues)]]} />
        : <p>{unknownValue}</p>}
    </Card>
    <Transcript result={result} />
  </>;
}

function Transcript({ result }: { result: DetailedSpeech }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [message, copy] = useCopy();
  const list = useRef<HTMLOListElement>(null);
  const transcript = result.report.transcription;
  if (transcript.status === "unavailable") return <Card title="타임라인별 전사 표본" probe={false} wide>
    <p role="status">전사 구간을 받지 못했어요. 검색할 내용이 없어요.</p>
  </Card>;
  const found = searchSegments(transcript.segments, query);
  return <Card title={`타임라인별 전사 표본 (${transcript.segments.length}구간)`} probe={false} wide>
    <p className={styles.hint}>
      {transcript.reason === "segment_limit" ? "최대 80구간까지만 담았어요." : "모델이 고른 표본이에요."} 전체 전사가 아니에요.
      {" "}{transcript.range ? `시각 범위 ${segmentTime({ startSec: transcript.range.fromSec, endSec: transcript.range.throughSec })}` : "시각 범위 미확인"} ·
      {" "}시각은 음원 시작 기준 추정값이고, 확인되지 않은 시각은 비워 뒀어요.</p>
    <div className={own.searchRow}>
      <label className={own.search} htmlFor={`${id}-search`}>전사 검색</label>
      <input id={`${id}-search`} className={own.searchInput} type="search" value={query} placeholder="내용이나 화자 이름"
        aria-describedby={`${id}-count`} onChange={event => setQuery(event.target.value)} />
      <Button type="button" variant="secondary" size="sm" onClick={() => copy(transcriptText(result), "전사 표본을 복사했어요.", list.current)}>전사 표본 복사</Button>
    </div>
    <p id={`${id}-count`} role="status">{query.trim() ? `${transcript.segments.length}구간 중 ${found.length}구간이 맞아요.` : `${transcript.segments.length}구간`}</p>
    <p role="status" className={styles.hint}>{message}</p>
    {found.length ? <ol ref={list} tabIndex={-1} className={`${styles.transcript} ${own.scroll}`} aria-label="전사 표본 목록">{found.map(({ segment, index }) => <li key={index}>
      <p className={styles.speaker}><strong>{segment.speaker ?? "화자 미확인"}</strong> · <span>{segmentTime(segment)}</span></p>
      <p>{segment.text}</p>
    </li>)}</ol> : <p>검색어와 맞는 구간이 없어요.</p>}
  </Card>;
}

function MarkdownDocs({ result, fileName }: { result: DetailedSpeech; fileName: string }) {
  const id = useId();
  const [kind, setKind] = useState<"meeting" | "interview">("meeting");
  const [message, setMessage] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const name = kind === "meeting" ? "회의록" : "인터뷰 기록";
  const markdown = (kind === "meeting" ? meetingMarkdown : interviewMarkdown)(result, fileName, localDate());
  async function copy() {
    try { await navigator.clipboard.writeText(markdown); setMessage(`${name} Markdown을 복사했어요.`); }
    catch { area.current?.focus(); area.current?.select(); setMessage("선택된 Markdown을 직접 복사해 주세요."); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = markdownName(fileName, kind);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`${link.download} 내려받기를 시작했어요.`);
  }
  return <section className={own.docs} aria-labelledby={`${id}-title`}>
    <h5 id={`${id}-title`}>자동 생성된 Markdown 비즈니스 문서</h5>
    <p className={styles.hint}>받은 보고서로만 만들어요. 모델을 다시 부르지 않아요. 문서 날짜는 만든 날이고, 실제 회의 일시는 음원에서 확인하지 않았어요.
      {" "}종합 통찰·화자 전환 분위기는 모델 추정이고, 전사는 받은 표본만 담아요.</p>
    <div role="radiogroup" aria-label="문서 형식" className={own.kinds}>
      {(["meeting", "interview"] as const).map(item => <label key={item}>
        <input type="radio" name={`${id}-kind`} value={item} checked={kind === item} onChange={() => { setKind(item); setMessage(""); }} />
        {item === "meeting" ? "회의록" : "인터뷰 기록"}
      </label>)}
    </div>
    <textarea ref={area} className={own.markdown} readOnly value={markdown} aria-label={`${name} Markdown 미리보기`} />
    <div className={styles.actions}>
      <Button type="button" variant="secondary" onClick={copy}>Markdown 복사</Button>
      <Button type="button" variant="secondary" onClick={download}>Markdown 내려받기</Button>
    </div>
    <p role="status">{message}</p>
  </section>;
}

function MusicDetail({ result }: { result: DetailedMusic }) {
  const { genre, instruments, tempoBpm, mood, rhythm, harmony, lyrics, stems, qualityEstimates, structure, sunoPrompt } = result.report;
  const extra = result.report.additionalFindings ?? undefined;
  const style = extra?.style ?? undefined;
  const notation = extra?.composition?.notation ?? undefined;
  const source = extra?.suspectedSource ?? undefined;
  const probe = result.measurement.source === "server_probe" ? result.measurement : undefined;
  const upscale = qualityEstimates?.suspectedUpscale;
  const lyricBox = useRef<HTMLParagraphElement>(null);
  const [lyricMessage, copy] = useCopy();
  return <>
    <ul className={own.kpis} aria-label="핵심 음악 정보">
      <Kpi label="장르 & 스타일" main={value(genre)} sub={<>분위기 {value(mood)}
        {instruments ? <ul className={styles.chips} aria-label="악기">{instruments.map((item, index) => <li key={index}>{item}</li>)}</ul> : <> · 악기 {unknownValue}</>}</>} />
      <Kpi label="BPM & 템포" main={tempoBpm === null ? unknownValue : <>{tempoBpm} <small>BPM</small></>} sub={`박자 ${value(rhythm?.timeSignature)}`} />
      <Kpi label="Key & Scale (조성)" main={harmony?.key || harmony?.scale ? [harmony.key, harmony.scale].filter(Boolean).join(" ") : unknownValue}
        sub={<Facts label="조성·음계·코드" className={own.inline} items={[["조성", value(harmony?.key)], ["음계", value(harmony?.scale)], ["코드 진행", value(harmony?.chordProgression)]]} />} />
      <Kpi label="기술 사양" probe main={probe ? clockText(probe.durationSeconds) : unknownValue}
        sub={probe ? measurementText(result.measurement).replace(/^서버 실측 · 길이 [^·]+ · /, "") : "서버 실측을 하지 못했어요"} />
    </ul>
    <section className={own.suno} aria-labelledby={`${result.requestedMode}-suno`}>
      <h5 id={`${result.requestedMode}-suno`} className={own.cardTitle}><span>Suno AI v6 역설계 프롬프트</span><span className={own.badge}>REVERSE PROMPT</span><Source /></h5>
      <p className={styles.hint}>모델이 들은 악기·편곡·질감으로 만든 제안이에요. 같은 소리를 보장하지 않아요.</p>
      {sunoPrompt ? <SunoPrompt original={sunoPrompt} /> : <p>{unknownValue}</p>}
    </section>
    <Card title="음향 포렌식 & 품질 추정" probe={false} wide>
      <p className={own.verdict} data-tone={upscale === true ? "warn" : upscale === false ? "ok" : undefined}>
        {upscale === null || upscale === undefined ? `업스케일 ${unknownValue}` : upscale ? "가짜 고음질(업스케일)이 의심돼요" : "업스케일 흔적을 찾지 못했어요"}</p>
      <p className={styles.hint}>모델 추정이에요. 위변조나 업스케일을 확정하지 않아요.</p>
      {qualityEstimates ? <Facts label="음질·편집 흔적 추정" className={own.cells} items={[
        ["추정 소스 품질", value(qualityEstimates.compression)],
        ["의심 원본 소스", source ? <>{source.description}<span className={own.basis}>근거 {source.basis}</span></> : unknownValue],
        ["편집 흔적", value(qualityEstimates.editTraces)], ["근거", qualityEstimates.basis]]} />
        : <Facts label="음질·편집 흔적 추정" className={own.cells} items={[["의심 원본 소스", source ? <>{source.description}<span className={own.basis}>근거 {source.basis}</span></> : unknownValue]]} />}
    </Card>
    <Card title="4대 스템(Stem) 소리 설명" probe={false} wide>
      <p className={styles.hint}>모델이 들은 소리를 글로 설명한 거예요. 실제로 분리한 스템 파일은 없어요.</p>
      {stems ? <Facts label="스템 설명" className={own.cells} items={[["🎤 보컬", value(stems.vocals)], ["🎸 베이스", value(stems.bass)], ["🥁 드럼", value(stems.drums)], ["🎹 기타 악기", value(stems.others)]]} />
        : <p>{unknownValue}</p>}
    </Card>
    <div className={own.grid}>
      <Card title="곡 구조 분석" probe={false}>
        {structure ? <ol className={styles.structure}>{structure.map(({ label, description }, index) => <li key={index}>
          <span className={styles.step}>{index + 1}</span><div><strong>{label}</strong><p>{description}</p></div>
        </li>)}</ol> : <p>{unknownValue}</p>}
      </Card>
      <Card title="작곡 및 채보 데이터" probe={false}>
        {notation ? <>
          <p className={styles.hint}>{notationName[notation.format]} · 모델이 들은 대로 적은 표기라 정확한 악보가 아니에요.</p>
          <pre className={own.notation} aria-label={`채보 ${notationName[notation.format]}`}>{notation.text}</pre>
        </> : <p>채보 {unknownValue}</p>}
        <Facts label="박자·리듬" items={[["박자", value(rhythm?.timeSignature)], ["리듬감", value(rhythm?.feel)], ["비트 그리드", value(extra?.composition?.beatGrid)]]} />
      </Card>
    </div>
    <Card title="가사 전사" probe={false} wide>
      {lyrics.status === "heard" ? <>
        <div className={own.cardActions}>
          <p className={styles.hint}>들린 가사(모델 받아쓰기, 정확하지 않을 수 있어요)</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => copy(lyrics.text ?? "", "가사를 복사했어요.", lyricBox.current)}>가사 복사</Button>
        </div>
        <p ref={lyricBox} tabIndex={-1} className={own.lyrics}>{lyrics.text}</p>
        <p role="status" className={styles.hint}>{lyricMessage}</p>
      </> : <p>{lyrics.status === "instrumental" ? "가사 없는 연주곡으로 추정했어요." : "가사가 있는지 판별하지 못했어요."}</p>}
    </Card>
    <Card title="스타일 및 편곡 사운드 심층 분석" probe={false} wide>
      <Facts label="스타일·편곡" className={own.cells} items={[["보컬 스타일", value(style?.vocalStyle)], ["악기 연주 기법", value(style?.instrumentalTechniques)],
        ["사운드 질감", value(style?.soundTexture)], ["편곡 디테일", value(style?.arrangementDetails)]]} />
    </Card>
  </>;
}
