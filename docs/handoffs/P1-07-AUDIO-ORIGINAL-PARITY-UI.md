# P1-07-AUDIO-ORIGINAL-PARITY-UI 오디오 원본 이용 가이드 창·바로 분석 진행 안내

- 담당: Claude(Front)(term_a0a6f98c) · 주인님 직접 지시 → Master `msg_56468acb205b`(시도 audio-original-parity-ui-1, 배정 1, 플랜 plan-20261122-2228)
- 기준 `f26ec1875f35ac7e66806e6e2e7356b3cd6fb75b` · 사본 `D:\starwork\claude-front-scratch\p185-audio-original` · 커밋 없음
- 근거
  - 차이 문서 `docs/handoffs/P1-07-AUDIO-ORIGINAL-PARITY-GAP.md`의 G1·G2
  - 원본 `Audio_Analyzer_Kit_v1.01/ai-audio-analyzer`의 `GuideModal.tsx`, `Sidebar.tsx`, `AudioAnalyzerApp.tsx`
- 바꾸지 않은 것
  - 보호 업로드, 파일·보고서 부품, 공통 관리자, 쇼츠, 서버 계약, 키·인증·DB

## 바꾼 것
| 파일 | 내용 |
|---|---|
| `components/admin/audio-original/audio-guide.tsx`(신규) | 이용 가이드 창(아래에 적었어요) |
| `components/admin/audio-original/audio-studio.tsx` | 가이드 단추 세 곳과 초점 처리(아래에 적었어요) |
| `components/admin/audio-original/audio-studio.module.css` | 아래에 적었어요 |
| `components/admin/audio-original/icons.tsx` | 이미지 원본 아이콘의 BookOpen·CheckCircle2·HelpCircle을 다시 내보내요. Zap·ShieldCheck 도형을 더했어요(lucide-react 1.6.0 dist에서 옮김). |
| `components/admin/admin-music-semantic.tsx` | G2(아래에 적었어요) |
| `tests/admin/admin-audio-analysis-entry.test.ts` | G1 시험 3개(아래에 적었어요) |
| `tests/admin/admin-music-semantic.test.ts` | G2 시험 2개(아래에 적었어요) |

`audio-guide.tsx`(신규)
- 원본 `GuideModal`을 `<dialog>` 하나로 옮겼어요.
  - 구성: 'AI Audio분석 자동화 이용 가이드', Version v1.15, 소개, 음성 4항목, 음악/Suno 4항목, 키 안내, '확인 및 닫기'
  - 이름은 `aria-labelledby`로 제목을 가리키고, 설명은 소개 문단이에요.
- 열면 `showModal`로 바깥이 가려지고, 초점은 '이용 가이드 닫기'로 가요.
- Tab·Shift+Tab은 창 안에서만 돌아요: 닫기 → 본문 영역(스크롤용 `tabindex=0` 영역) → 설정 링크 → 확인 및 닫기.
- Esc, 닫기, 확인 및 닫기를 누르면 `onClose`예요. 설정 링크를 누르면 `onNavigate`로 창을 닫되 초점은 돌리지 않아요.
- 키 안내 '관리자 키 연동 원칙'
  - API키등록·플랫폼연동에 등록하고 서버가 암호화해 보관해요.
  - 실행마다 따로 전송 동의를 받아요.
  - 4 MiB보다 크거나 컨텍스트·요청이 있으면 서버 비공개 저장소에 올려요.
  - 원본의 회원 본인 키(Rule 00)·Google AI Studio 문구는 없어요.
- 지금 화면과 다른 원본 문장만 고쳐 썼어요. 나머지는 원본 문구 그대로예요.
  - 전문 전사 → 최대 80구간 표본
  - 고주파 Cut-off 감지·뻥튀기 → 모델 추정, 확정 아님
  - 똑같은 재현 → 비슷한 느낌, 프롬프트 제안
  - 스템 → 파일로 나누지 않음
  - 조성·코드·채보 → 상세 보고서

`audio-studio.tsx`
- 원본 위치 세 곳에 가이드 단추를 두었어요. 모두 `aria-haspopup="dialog"`이고 같은 창을 열어요.
  - 사이드바 GUIDE & SETTINGS의 '📖 연동 & 사용 매뉴얼'(GUIDE 배지)
  - 상단 바 '📖 사용 매뉴얼'(칸 640px 미만에서는 원본처럼 숨김)
  - 히어로 '📖 사용 매뉴얼 보기'(Gemini API 설정 옆)
- 좁은 칸 메뉴에서 열면 메뉴가 닫혀요.
- 창이 닫히면 연 단추로 초점이 돌아와요. 그 단추가 숨어 있으면 보이는 메뉴 단추, 그것도 없으면 사이드바 가이드 단추로 가요.

`audio-studio.module.css`
- 단추 모양: 호박색 사이드바 아이콘·GUIDE 배지, 상단 바·히어로 호박색 단추, 호박색 초점 테두리
- 창 모양: 원본 흰 창 42rem·85vh·16px 모서리·검은 40% 흐림, 768px 이상 화면에서 2열
- 창 안 작은 글자는 slate-600으로 올렸어요.
- 창 안에서는 스튜디오의 청록 초점 값(`--line-focus`)과 초점 그림자를 남색 #4f46e5로 되돌렸어요. 흰 바탕에서 청록은 대비가 부족해요.

`admin-music-semantic.tsx`
- G2: `analyzingStatus(mode)`를 내보내요.
  - 기존 모드별 진행 문장 뒤에 '파일 길이에 따라 수십 초 걸릴 수 있어요.'를 붙였어요.
  - 경로 한도(음악 75초, 자동·음성 90초)를 넘는 '몇 분'은 쓰지 않아요.
- 분석 중에만 `role="status"` 한 줄이 나와요. 끝나거나, 오류가 나거나, 모드·보고서 종류를 바꾸거나(요청 끊김), 파일을 바꾸면 사라져요. 동작은 원래 흐름 그대로예요.

시험
- `tests/admin/admin-audio-analysis-entry.test.ts`(G1 3개)
  - 창 구성·이름·항목 8개·닫기·설정 링크·본문 영역
  - 금지 문구 없음: 회원, Rule 00, Google AI Studio, 평문, localStorage, 똑같은, 전문을 기록, Cut-off를 감지, 뻥튀기
  - 스튜디오 정적 그리기: 단추 3개·창 1개, 초점 복귀 코드
- `tests/admin/admin-music-semantic.test.ts`(G2 2개)
  - 세 모드 문장, '분' 없음
  - status 한 곳, 단추는 aria-busy만

## 검증(작성자 자체, 독립 검수 아님)
- `tsc --noEmit` 0, eslint 0(바뀐 7파일, 신규 포함)
- 공백 검사
  - 기준 blob과 비교한 `git diff --no-index --check` 오류 0
  - 신규 파일은 `/dev/null`과 비교해 0
  - 모든 파일이 CRLF이고, 혼자 있는 CR·LF·제어 문자는 0
- 집중 시험
  - `admin-music-semantic` + `admin-audio-analysis-entry`: 19/19(새 5개)
  - 오디오 시험 6파일(analysis-entry·detail·upload·waveform·music-program·music-semantic): 44/44(최종 파일 기준)
- 넓은 시험 `tests/admin` + `tests/reference-analysis`: 660/661
  - 실패 1개는 기준선이에요(`admin-reference-upload` '음악·영상 역시 실제 로컬 분석기로 처리한다', ffmpeg 없음).
  - 이 실행은 시험 파일의 형식 표시 `as never` 한 곳과 창 초점 색 CSS를 고치기 전이었어요. 두 수정은 실행 동작에 영향이 없고, 최종 파일로는 위 오디오 6파일을 다시 돌렸어요.
- `next build --webpack`(합성 환경) 0, `scripts/verify-build.mjs` 0(최종 CSS 기준)
- 브라우저
  - 실제 Next 생산 빌드(합성 Supabase Auth 64836, Next 64837, 루프백, DB 없음)의 `/admin/audio-analysis`를 1440·390에서 키보드로 확인했어요.
  - 스크립트: `D:\starwork\claude-front-scratch\p163-tools\real-next-p185-audio-guide.ego.mjs`
  - 덮개는 같은 출처 `/api/admin/music-semantic`(설정 GET·분석 POST 지연·실패·끊김 기록)만 대신했어요.
  - 종료 코드 0, 로그 `D:\starwork\claude-front-scratch\p185-audio-out\run.log`
  1. 히어로 '사용 매뉴얼 보기'로 열기
     - `:modal`이고 이름은 'AI Audio분석 자동화 이용 가이드'예요.
     - 초점은 '이용 가이드 닫기'예요. 창 넓이는 1440에서 672px, 390에서 358px이고 넘침은 0이에요.
     - Tab 4번: 이용 가이드 내용 → API키등록·플랫폼연동 열기 → 확인 및 닫기 → 이용 가이드 닫기(순환)
     - 네 곳 모두 계산된 초점 테두리는 rgb(79, 70, 229) 2px예요.
     - Shift+Tab은 거꾸로 순환해요.
     - Esc를 누르면 닫히고 초점은 히어로 단추로 돌아와요.
  2. 1440
     - 상단 바 '사용 매뉴얼' → '확인 및 닫기' → 상단 바 단추로 초점 복귀
     - 사이드바 '📖 연동 & 사용 매뉴얼' → 닫기 → 사이드바 단추로 초점 복귀
     - 창 안 설정 링크 → `/admin#admin-api-integrations`
  3. 390
     - 상단 바 가이드 단추는 숨어 있어요.
     - 메뉴 단추(펼침 true) → 사이드바 가이드 단추를 누르면 메뉴가 닫히고(false) 창이 열려요.
     - Esc → 초점이 '오디오 스튜디오 메뉴'로 가요.
  4. G2(두 폭): 음악·기본 보고서, 합성 WAV(0.02 MB)
     - 분석 중 status는 정확히 1개예요: "장르, 악기, 템포와 구간 구조를 분석하는 중이에요. 파일 길이에 따라 수십 초 걸릴 수 있어요."
     - 끝나면 0개예요. 502 오류면 0개이고 안내(alert)가 나와요.
     - 분석 중 모드를 '음성'으로 바꾸면 0개이고 요청이 끊겨요(aborted).
     - 분석 중 '파일 교체'를 누르면 0개이고 요청이 끊겨요. POST 4번은 모두 동의 머리글 true였어요.
  - 가로 넘침 0, 외부 요청 0
  - 사진: `D:\starwork\claude-front-scratch\p185-audio-out\screens\{guide-open,analyzing}-{1440,390}.png`
- 관측하지 못한 것
  - 화면 읽기 프로그램에서 들리는 창 이름·안내
  - 실제 Gemini 응답 시간
  - 운영 배포 화면(이 작업 범위 밖)
- 남은 차이(GAP 문서 4장)
  - S1 음성 언어·전체 분위기: Backend 계약 필요
  - S2 전체 전사
  - S3 업무 워크스페이스로 보내기: 주인님 결정 필요
