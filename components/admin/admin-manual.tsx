import { Card } from "@/components/ui/primitives";
import { UPLOAD_SIZE_LIMIT_LABEL, URL_SIZE_LIMIT_LABEL } from "./admin-reference-analysis-model";
import styles from "./admin.module.css";

const programs = [
  {
    id: "admin-style-dna",
    title: "이미지 분석",
    steps: [
      `PNG·JPG·WebP를 ${UPLOAD_SIZE_LIMIT_LABEL} 이내로 올리거나 지원하는 공개 이미지의 직접 URL(${URL_SIZE_LIMIT_LABEL} 이내)을 입력하세요.`,
      "분석 권리와 Gemini 전송 동의를 확인한 뒤 이미지 분석 실행을 누르세요.",
      "스타일 리포트에서 색감·조명·구도와 한영 이미지 생성 프롬프트를 확인하세요.",
    ],
  },
  {
    id: "admin-music-analysis",
    title: "음악 분석",
    steps: [
      `MP3·WAV·M4A를 ${UPLOAD_SIZE_LIMIT_LABEL} 이내로 올리세요.`,
      "음원 전송에 동의하고 음악 의미 분석을 실행하세요.",
      "장르·악기·추정 템포·구간을 확인하고 Suno용 프롬프트를 복사하세요.",
    ],
  },
  {
    id: "admin-shorts-analysis",
    title: "쇼츠 분석",
    steps: [
      "공개 YouTube 쇼츠나 시청 페이지 주소를 붙여넣으세요.",
      "분석 권리와 영상 주소의 Gemini 전송 동의를 확인한 뒤 쇼츠 분석을 실행하세요.",
      "첫 장면과 시간대별 단서를 확인하고 연출 프롬프트를 검토하세요.",
    ],
  },
] as const;

export function AdminManual() {
  return <section id="admin-manual" aria-labelledby="admin-manual-heading" tabIndex={-1} className={`${styles.target} ${styles.section} ${styles.manual}`}>
    <h2 id="admin-manual-heading" tabIndex={-1}>사용매뉴얼</h2>
    <section aria-labelledby="manual-programs">
      <h3 id="manual-programs">분석 프로그램 사용법</h3>
      <div className={styles.manualPrograms}>
        {programs.map(({ id, title, steps }) => <Card key={id} className={styles.manualCard}>
          <h4>{title}</h4>
          <ol>{steps.map(step => <li key={step}>{step}</li>)}</ol>
          <a className={styles.link} href={`#${id}`}>{title} 열기</a>
        </Card>)}
      </div>
    </section>
    <div className={styles.manualDetails}>
      <Card className={styles.manualCard}>
        <h3>Gemini API연동</h3>
        <ol>
          <li>Google AI Studio에서 연동할 프로젝트의 Gemini API 키를 준비하세요.</li>
          <li><a className={styles.link} href="#admin-api-integrations">API키등록·플랫폼연동</a>의 <strong>Gemini 설정</strong>에서 이미지·쇼츠용 키와 음악용 키, 분석기별 모델 ID를 넣고 <strong>저장</strong>을 누르세요.</li>
          <li>저장할 때 Gemini에서 키와 모델 정보를 확인하고, 확인되면 서버에 저장돼요. 실제 분석 결과는 각 분석기에서 실행해 확인하세요.</li>
        </ol>
        <details>
          <summary>서버 키 저장소가 없는 배포의 환경 변수 이름</summary>
          <dl>
            <dt>이미지 분석</dt><dd><code>DREAM_REFERENCE_GEMINI_API_KEY</code><br /><code>DREAM_REFERENCE_GEMINI_MODEL</code></dd>
            <dt>음악 분석</dt><dd><code>DREAM_MUSIC_SEMANTIC_GEMINI_API_KEY</code><br /><code>DREAM_MUSIC_SEMANTIC_GEMINI_MODEL</code></dd>
            <dt>쇼츠 분석</dt><dd><code>DREAM_REFERENCE_GEMINI_API_KEY</code><br /><code>DREAM_REFERENCE_SHORTS_GEMINI_MODEL</code></dd>
          </dl>
        </details>
        <p className={styles.note}>저장한 키는 서버에만 보관되고 화면에 다시 보이지 않아요. 바꿀 때는 <strong>키 교체</strong>로 새 키를 넣어요. 화면에서 저장한 설정이 환경 변수보다 먼저 쓰여요.</p>
        <div className={styles.manualLinks}>
          <a className={styles.link} href="https://ai.google.dev/gemini-api/docs/api-key" target="_blank" rel="noreferrer">Gemini API 키 안내</a>
          <a className={styles.link} href="https://vercel.com/docs/environment-variables/managing-environment-variables" target="_blank" rel="noreferrer">Vercel 환경 변수 안내</a>
        </div>
      </Card>
      <Card className={styles.manualCard}>
        <h3>플랫폼 이용 방법</h3>
        <dl>
          <dt>YouTube</dt><dd>공개 영상 주소를 쇼츠 분석에 입력하세요. 원본은 ‘YouTube에서 원본 열기’로 확인하세요.</dd>
          <dt>Suno</dt><dd>음악 분석의 ‘Suno 프롬프트 복사’를 누른 뒤 Suno에서 직접 붙여넣으세요.</dd>
          <dt>이미지 생성 도구</dt><dd>스타일 리포트의 한국어 또는 영어 프롬프트를 복사해 사용하는 생성 도구에 붙여넣으세요.</dd>
        </dl>
      </Card>
    </div>
    <Card className={styles.manualCard}>
      <h3>분석 결과 공개와 철회</h3>
      <ol>
        <li>분석 결과에서 <strong>공개 준비</strong>를 누르고 제목·요약·생성 프롬프트를 편집하세요. 링크, 파일 경로, 계정 정보, API 키는 지워 주세요.</li>
        <li>웹 공개 미리보기를 확인하세요. 공개할 권리를 확인하고 동의한 뒤 <strong>공개하기</strong>를 누르세요.</li>
        <li>공개를 중단하려면 <a className={styles.link} href="#admin-analysis-results">분석 결과 관리</a>에서 항목의 철회를 확인하세요.</li>
      </ol>
    </Card>
  </section>;
}
