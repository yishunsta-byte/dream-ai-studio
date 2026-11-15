# 외부 서비스 조사 기록

- 조사일: **2026-11-15** (플래너 세션, 4개 분야 병렬 조사)
- 표기: **[V]** 공식 페이지에서 확인 · **[S]** 2차 자료만 · **[I]** 추론
- 가격·모델은 월 단위로 바뀐다. **연결 작업 직전에 해당 항목을 다시 확인**하고 이 문서를 갱신한다.

---

## 1. 이미지·영상 생성

### 최근 변경 (계획에 영향)
- OpenAI **Sora 2 API·Videos API 2026-09-24 종료**, 대체 없음 [V] https://developers.openai.com/api/docs/models/sora-2
- Veo 3.1 Preview는 Gemini API에서 제거(2026-10-22 예정). Gemini API의 현재 영상 모델은 **Gemini Omni Flash**, Veo 3.1 GA는 Vertex(기업용) [V] https://aistudio.google.com/docs/video
- fal의 Veo 3.1 시작·끝 프레임 엔드포인트 2026-11-17 종료 예정 [V]

| 제공사 / 모델 | 기능 | 접근·방식 | 대략 가격 | 제한 |
|---|---|---|---|---|
| Gemini Omni 1.2 Flash | T2V, I2V, 시작·끝 프레임, 참조 이미지 최대 6, 편집, 30초까지 연장 | 공개 API, 큰 파일은 URI 폴링 [V] | 720p 약 $0.07/초 [V, Runway 재판매가] | 3~15초, 16:9·9:16, 일부 실존 인물 업로드·편집 불가, 오디오 입력 없음(립싱크 불가), SynthID 워터마크 [V] https://aistudio.google.com/docs/omni |
| Veo 3.1 GA (Vertex) | T2V, I2V, 시작·끝 프레임 | 기업용, 비동기 | fal에서 $0.20~0.60/초 [V] | 4/6/8초, 끝 프레임은 강제가 아닌 가이드 [S] |
| Nano Banana 2.1 (Gemini 이미지) | 다중 참조 이미지 생성·편집 | 공개 API | 1K 이미지 약 $0.0336 [S] | 참조 장수 상한 미확인 |
| Kling 공식 API | T2V, I2V, 시작·끝 프레임, 요소 참조, Motion Control, 립싱크, 아바타 | 공개, 비동기 작업 | $0.042~0.42/초, Motion Control $0.126~0.168/초, 립싱크 5초당 $0.07 [V] https://kling.ai/document-api/pricing/base/video.md | Motion Control은 이미지 입력 필요 [S] |
| Runway API | Gen-4.5, Act-Two(연기 전이), Aleph 2(영상 편집), 다른 회사 모델 재판매 | 공개, 크레딧 $0.01 [V] https://docs.dev.runwayml.com/api/ | Act-Two $0.05/초, Aleph 2 $0.28/초, Gen-4.5 $0.12/초 [V] | 전용 립싱크 없음 |
| sync.so lipsync-2-pro | 주어진 음성으로 립싱크 | 공개 API, fal·Replicate 경유 가능 | $0.067~0.083/초 [V] https://sync.so/docs/billing | |
| Hedra Character-3 | 이미지 + 음성 → 말하는 영상 | 공개 API | $0.025~0.0625/초 [V] | 최대 10분, 9:16 |
| Wan 2.2 Animate | 동작 전이·인물 교체 | Apache-2.0 공개 가중치, fal·Replicate | 약 $0.04~0.08/초 [S] | 자체 설치 가능 |
| Seedance 2.x | T2V, I2V, 다중 참조 | 비동기 | Runway 경유 $0.14~1.50/초 [V] | **실사 얼굴 참조 차단**(인증 절차 예외) [S] |
| MiniMax Hailuo | T2V, I2V, 시작·끝 프레임, 참조 | 공개 | 768p 약 $0.08/초 [S] | |
| FLUX Kontext / FLUX.2 | 참조 기반 이미지 편집 | 공개 | Kontext pro 약 $0.04 [S] | |
| gpt-image-2 | 다중 참조 편집 | 공개 | $0.006~0.06/장 [S] | |
| Midjourney | — | **공식 API 없음** | — | 연결 금지 |

### 통합 창구
- **fal.ai**: 사용량 과금, 비동기 큐 + `webhook_url` 또는 `request_id` 폴링, 서명된 webhook(`X-Fal-Webhook-Signature`), 재전송 가능하므로 `request_id`로 중복 처리. 약관상 제품에 포함해 제공 가능, 모델별 약관 별도 [V] https://fal.ai/docs/model-apis/webhooks · https://fal.ai/terms
- **Replicate**: 비동기 예측 + webhook, **결과 1시간 후 삭제** [V] https://replicate.com/docs/topics/webhooks
- **MuAPI**: 생성당 과금, 모델 가격 API 있음 [V]. "필터 없음"을 내세움 [S], webhook 문서 없음 → 기본 사용 제외
- **Runway API**: 여러 회사 모델을 하나의 크레딧으로 [V]

### API로 아직 어려운 것 [I]
여러 샷에 걸친 완벽한 얼굴 고정 · 실사 얼굴 참조 · 정확한 끝 프레임 일치 · 클립 일부만 수정 · 15초 넘는 단일 클립(연장·이어붙이기 필요)

---

## 2. 음성·음악·자막

### TTS
| 제공사 | 한국어 | 다화자 | 목소리 복제 | 가격·조건 |
|---|---|---|---|---|
| ElevenLabs | v4·v3·Multilingual v2·Flash v2.5 [V] | Text to Dialogue API, 대사별 voice_id, 요청당 약 2,000자 [V] | 즉시·전문 복제 [I] | 1K자 $0.08 (Flash $0.04), 월 $6~990 [V] https://elevenlabs.io/pricing/api |
| Gemini-TTS | ko-KR GA [V] | 내장(4,000바이트) [V] | 프리뷰만 | 종량제 [V] |
| OpenAI TTS | 지원(영어 최적화) | 문서 없음 | 동의 녹음·승인 필요 | **tts-1 계열 2027-01-06 종료** [V] |
| Azure | ko-KR HD 음성 다수 [V] | 다화자 음성은 en-US만 [V] | 개인 음성은 신청제 [V] | |
| Typecast | 한국어 + 감정 [V] | 줄별 지정 [I] | 5~150초 샘플 빠른 복제 API [V] | 한국 카드만 [S] |
| Supertone | 한국어 강점 [S] | — | API는 등록된 목소리만 [S] | API 페이지 상태 불명 [V] |
| CLOVA Voice | 한국어 [V] | — | 없음 | 문장당 200자 [V] |

### 음악
| 제공사 | 공식 API | 보컬·가사 | 상업 이용 |
|---|---|---|---|
| Suno | **없음**(2026-07 초대제 파트너 프로그램) [S] | 예 | Pro·Premier에서 받은 곡 상업 이용 가능, 2026-09-03부터 월 다운로드 제한(Pro 20, Premier 60) [V] https://suno.com/blog/suno-updates-tos · 비공식 API는 약관 위반 [S] |
| Udio | 없음, 다운로드 중단 [S] | — | 사용 불가 |
| ElevenLabs Music | 유료 플랜 API [V] | 보컬·연주, 구간 편집 [V]. 한국어 목록에 없음 [V] | 스트리밍 배포는 Creator 이상, $0.15/분, 3초~5분 [V] https://elevenlabs.io/music-terms |
| Google Lyria 3.5 | Gemini API [V] | 보컬·시간 맞춘 가사 [V] | SynthID, 상업 조건 미기재 [V] |
| MiniMax Music | 신규 유료 API 중단(2026-08-20) [V] | | |
| Stable Audio 2.5 | API [S] | 연주만 [S] | 연매출 $1M 초과 시 기업 라이선스 [S] |

### 자막·가사 시간 (STT)
| 옵션 | 한국어 | 단어 시간 | 메모 |
|---|---|---|---|
| ElevenLabs Scribe v3 | 예 [V] | 예 [V] | 시간당 $0.20, 5GB, 화자 32 [V] |
| OpenAI | 예 | `whisper-1`만 [V] | 25MB |
| Deepgram Nova-3 | 예 [V] | 예 [I] | language 명시 필요 |
| faster-whisper (PC) | large-v3 [V] | `word_timestamps=True` [V] | CUDA 12 + cuDNN 9(NVIDIA GPU) [V] https://github.com/SYSTRAN/faster-whisper |

### 오디오 처리
ffmpeg `loudnorm`(2단계, 유튜브 약 -14 LUFS [I]), `acrossfade`, `afade`, `afftdn` [V] https://ffmpeg.org/ffmpeg-filters.html · RNNoise(`arnndn`)는 말소리 학습이라 노래에 손상 가능 [I] · 음원 분리는 Demucs 포크 `adefossez/demucs` [S]

YouTube는 AI 음악을 금지하지 않지만 반복·대량 업로드는 "진정성 없는 콘텐츠"로 제재 대상 [S] → 플레이리스트는 사람의 선곡·구성이 드러나게.

---

## 3. 영상 조립·서버

- **Remotion**: 개인·3인 이하 회사 무료(상업·자동화 포함). 4인 이상은 Creator $25/석/월 또는 Automator 렌더당 $0.01(월 최소 $100) [V] https://www.remotion.dev/docs/license/pricing.md · Player·렌더 서비스 모두 "자동화" 해당, Player 미리보기는 렌더 수에 안 셈 [V] https://www.remotion.dev/docs/license/faq.md
- `renderMediaOnWeb()` 브라우저 렌더: 안정판 표기와 실험 표기가 혼재 [V] → 사용하지 않음(PC 렌더)
- `@remotion/vercel`: 실험적, CPU만 [V]
- **fluent-ffmpeg 지원 중단** [V] https://npmjs.com/package/fluent-ffmpeg → ffmpeg 직접 호출
- Shotstack·Creatomate·JSON2Video: 1080p 분당 약 $0.10~0.30 [S]
- **CapCut × Codex**: ChatGPT 데스크톱 앱 플러그인. 공개 API·개발 문서·프로젝트 형식 없음 [V] https://www.capcut.com/tools/capcut-x-codex · 최신 CapCut은 `draft_content.json` 암호화 [S] → 연동하지 않음
- 작업 큐: pg-boss(Postgres, Node 22.12+) [V] https://github.com/timgit/pg-boss/releases · Supabase Queues(pgmq) [V] · Inngest 로컬 dev 서버 [V] · Trigger.dev 자체 설치는 다중 컨테이너 [V] → P1~P6 자체 jobs 테이블, P7 pg-boss
- Supabase: Drizzle는 postgres-js, 트랜잭션 풀러는 `prepare:false` [V] https://orm.drizzle.team/docs/connect-supabase · RLS `pgPolicy` [V] https://orm.drizzle.team/docs/rls · **무료 파일당 50MB**, Pro는 최대 500GB [V] https://supabase.com/docs/guides/storage/uploads/file-limits · 6MB 이상 TUS 권장 [V]
- Vercel 함수 최대: Hobby 300초, Pro 800초 [V] https://vercel.com/docs/functions/limitations → 렌더는 Vercel에서 하지 않음
- 글꼴: Pretendard OFL 1.1 [V], Noto Sans CJK OFL 1.1 [V], OFL 글꼴은 영상에 써도 표기 의무 없음, 파일 재배포 시만 조건 [V] https://openfontlicense.org/how-to-use-ofl-fonts/

---

## 4. 게시·광고 표기·브랜드커넥트·공모전

### 채널 API
| 채널 | API | 계정 조건 | 한도 | 심사 | 규격 |
|---|---|---|---|---|---|
| YouTube·Shorts | Data API v3 `videos.insert` | 채널 | 업로드 전용 하루 100건(2026-06-01 변경) [V] | 2026-11-02부터 미검증 앱도 비공개 고정 해제 [V], OAuth 민감 범위 검증은 별도 [I] | 3분 이하 세로·정사각 → 자동 Shorts, API 플래그 없음 [V]. `status.containsSyntheticMedia` [V] https://developers.google.com/youtube/v3/docs/videos/insert |
| Instagram 릴스 | Graph API `media_type=REELS` | 프로페셔널 계정 | 24시간 100건(`content_publishing_limit`로 확인) [V] | 본인 계정이면 앱 심사 불필요 [I] | 3초~15분, 300MB, 캡션 2,200자, 해시태그 30, 공개 URL 필요 [V] |
| Threads | Threads API `VIDEO` | Threads 프로필 | 24시간 250건 [V] | Meta 권한 | 5분, 1GB, **500자, 주제 태그 1개** [V] |
| TikTok | Content Posting API (직접 게시 / 보관함 업로드) | 모든 계정 | 토큰당 분당 6회, 보관함 24시간 5건 [V] | **심사 전 직접 게시는 나만 보기** [V] | 캡션 2,200자, `is_aigc`, `brand_content_toggle` [V] |
| Facebook 릴스 | `/{page_id}/video_reels` | **페이지만** | 24시간 30건 [V] | 페이지 권한 3종 | **3~90초**, 1080×1920, 29일 예약 [V] |

공통 마스터: 9:16, 90초 이하, H.264/AAC, 1080×1920, 30fps [I]

### 표기 규정
- YouTube: 실사형 합성·변조 콘텐츠 공개 의무, 비실사·애니·자막·본인 목소리 더빙 등은 예외 [V] https://support.google.com/youtube/answer/14328491
- TikTok: 실사형 AI 라벨 필수, C2PA 자동 라벨 [V], API `is_aigc=true`
- Meta: 실사형 AI 영상·음성 공개 기대, C2PA 자동 라벨 [S]
- 공정위 추천·보증 심사지침(법률 기사 기준 [S]): 영상은 제목 또는 시작에 "유료 광고 포함"/[광고], 시작·끝·상품 언급 시 반복. 설명란·고정 댓글만으로는 부족. 인스타는 첫 이미지·첫 줄·첫 해시태그. 한글 표기 필수("AD", "Sponsored", "체험단" 단독 불가)
- **2026 개정: 추천·보증에 쓰인 AI 가상인물은 등장 중 "가상인물" 표기, 2026-06-01 시행 보도** [S, 원문 확인 필요]

### 네이버 브랜드커넥트 / 쇼핑커넥트
공개 API 없음 [S]. 쇼핑커넥트 2025-07-23 출시, 공동구매 베타 2026-01 [S]. 본인 링크 구매는 실적 제외 [S] → 수동 트래커

### 공모전 사이트
씽굿·링커리어·위비티·콘테스트코리아 API·RSS 없음 [S]. robots.txt는 대체로 허용 [V]이나 이용약관 미확인 → 대량 수집 금지, 업로드·주소 붙여넣기 방식

### 예약 게시 서비스
Typefully(인스타·틱톡·유튜브·페북 미지원) · Buffer(개인 키 API, 무료 1키) · Zernio(구 Late, 계정당 월 약 $19) · Ayrshare(월 $149) [S]

---

## 5. Claude API
- 기획·대본 기본 모델 `claude-sonnet-5-5`, 복잡한 기획·긴 대본 `claude-opus-5-5`, 대량 분류·검사 `claude-haiku-5-5` (플래너 세션 환경 정보 기준). P3-2 착수 전 Anthropic 문서에서 최신 모델·가격·입력 한도를 재확인.
