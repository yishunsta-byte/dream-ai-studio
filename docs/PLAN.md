# Dream AI Studio — 개발 기준 문서 (v2.4)

| 항목 | 내용 |
|---|---|
| 문서 지위 | **이 프로젝트의 최상위 개발 기준.** 다른 문서·코드·대화 지시와 충돌하면 이 문서가 우선한다. 사용자의 새 지시가 있으면 이 문서를 먼저 고친 뒤 따른다 |
| 버전 / 기준일 | v2.4 / 2026-11-15 |
| 근거 | `D:\starwork\(이은영)드림 AI바이브.xlsx` 13개 시트, 외부 서비스 조사(`docs/REFERENCES.md`), 구현 담당 검토 의견(v2.1 8장, 이 판에 통합) |
| 보기용 HTML | `docs/plan.html` (이 문서를 그대로 렌더링), `docs/dev-plan.html` (로드맵 요약) |
| 역할 | **플랜·디자인**: 플래너(Claude) / **검수·테스트**: 검수 담당(Codex) / **코딩**: 구현 담당 에이전트(코더) / **최종 결정**: 은영님 |
| 변경 규칙 | 이 문서는 플래너가 고친다. 코더는 바꿔야 할 이유를 `docs/QUESTIONS.md`에 적고 해당 부분을 멈춘다. 변경 시 맨 아래 "변경 이력"에 기록 |

### 관련 문서

| 파일 | 내용 | 작성 |
|---|---|---|
| `docs/PLAN.md` | 이 문서. 범위·구조·규칙·단계·완료 기준 | 플래너 |
| `docs/spec/menus.json` | 분야별 템플릿 설정 (입력 항목, 기획 순서, 수정 메뉴, 검수 항목, 결과물, 단계) | 플래너 |
| `docs/REFERENCES.md` | 외부 서비스 조사 결과와 출처·확인 날짜 | 플래너 |
| `docs/DESIGN.md`, `docs/design/tokens.css`, `docs/design/prototype.html` | 제품 디자인 시스템과 화면 시안 (P0-1) | 플래너 |
| `docs/PROGRESS.md` | 마일스톤별 진행 기록 | 코더 |
| `docs/REVIEW.md` | 마일스톤별 검수 결과 | 검수 담당(Codex). R-000~R-002는 역할 변경 전 플래너 작성 |
| `docs/QUESTIONS.md` | 기준과 다르게 해야 할 때의 질문·결정 | 코더·검수 담당 작성, 플래너 답변 |
| `CLAUDE.md` | 코더가 매 세션 먼저 읽는 작업 규칙 | 플래너 |

> `dev-plan.html`의 CSS는 문서용이다. **제품 화면의 디자인 기준이 아니다.** 제품 디자인은 `docs/design/`만 따른다.

---

## 1. 제품 정의

**한 줄 정의**: 자료를 올리면 **등록 → 요구 확인 → 기획 → 장면 제작 → 수정·조립 → 검수 → 내보내기**까지 한곳에서 관리하는 은영님 전용 AI 콘텐츠 작업실.

**사용자**: P0~P6은 은영님 한 명(로그인 없음, 내 PC). P7부터 협업자·수강생·방문자. 전문 업무 사용자는 P8 별도 프로젝트.

**성공 기준 (기획서)**: 실제 자료 1건으로 쇼핑숏츠 1편을 기획 → 수정 → 내보내기까지 완료. 기존 작업 시간과 비교 기록, 수정 누락 0건, 내보낸 파일 재생 성공.

### 1.1 불변 원칙

어느 단계에서도 어기면 안 된다. 검수에서 하나라도 위반이면 그 마일스톤은 불합격이다.

| # | 원칙 | 구현상 의미 |
|---|---|---|
| R1 | **원본은 덮어쓰지 않는다** | 파일은 한 번 저장되면 불변. 수정 = 새 파일 + 새 버전 행 |
| R2 | **모든 수정은 되돌릴 수 있다** | 기획·장면·타임라인은 버전으로 관리. 복원은 선택 포인터만 옮긴다(삭제 없음) |
| R3 | **부분 수정이 기본** | 장면 하나·대사 하나·글자 레이어 하나만 다시 만들 수 있다. 전체 재생성은 사용자가 명시적으로 고를 때만 |
| R4 | **샷 1개 = 클립 1개** | AI 영상은 샷 단위로 만들고 타임라인에서 이어 붙인다. 클립 내부 부분 편집에 의존하지 않는다 |
| R5 | **실패는 실패로 보인다** | 실제 파일이 없거나 생성이 실패한 것을 "완료"로 표시하지 않는다. 샘플(mock) 결과를 완성품으로 표시하지 않는다 |
| R6 | **승인 게이트는 서버가 지킨다** | 기획 승인 전 장면 생성 불가, 검수 통과 전 최종 내보내기 불가, 승인 없이 외부 게시·제출 불가. 버튼 비활성화만으로는 부족하고 **서비스 계층에서 거부**해야 한다 |
| R7 | **분야별 화면 복제 금지** | 모든 분야는 같은 화면·흐름을 쓰고, 차이는 `menus.json`으로만 표현 |
| R8 | **지어내지 않는다** | 확인 안 된 사실·후기·수치·원본 특징(예: 박대리 방식)을 만들어 넣지 않는다. 미확인은 "미확인"으로 표시 |
| R9 | **기록이 남는다** | 생성마다 제공사·모델·입력 스냅샷·비용·일시 저장. 사용자 변경은 활동 기록에 남는다 |
| R10 | **비밀과 개인정보 보호** | API 키는 `.env.local`에만. 화면·로그·DB·백업·manifest에 키 원문과 PC 절대경로 금지. 테스트는 가상 데이터만 |

---

## 2. 결정 현황

### 2.1 확정 (2026-11-15, 은영님)

| 항목 | 결정 |
|---|---|
| 첫 버전 범위 | 전체 메뉴 뼈대 + 공통 흐름. 흐름 검증은 쇼핑숏츠 템플릿으로 |
| AI 생성 | 화면·흐름을 샘플 결과(mock)로 먼저 완성, 실제 도구는 P3부터 하나씩 |
| 저장 | 내 PC 로컬(SQLite + 폴더) → P7에서 Supabase |
| 전문 업무 | 콘텐츠와 완전 분리, P8 별도 프로젝트 |
| 역할 | 플랜·디자인은 플래너, 검수·테스트는 검수 담당(Codex), 코딩은 코더 (v2.3, 은영님 지정) |

### 2.2 현재 구현 범위

**P0~P1만.** P2(MP4 합성·움직이는 글자·재생 가능한 타임라인)부터는 P1 검수 통과 후 시작한다. AI 실제 연결, 게시, 클라우드 이전은 이후 단계다.

### 2.3 미정 (해당 단계 시작 전까지 결정)

| 결정 | 필요 시점 | 플래너 추천 | 미정일 때 기본 동작 |
|---|---|---|---|
| 서비스 이름 | P0 | 가칭 "Dream AI Studio" | 가칭 사용, 이름은 설정값 하나로 관리 |
| AI 월 예산 | P3 | 시험 기간 월 $30~50 | 예산 미설정 시 실제 제공자 실행 차단 |
| API 계정 | P3 | Anthropic → fal.ai → Kling → Google AI → ElevenLabs | mock만 사용 |
| 첫 실제 상품 | P3 완료 | 권리가 확실한 상품 1개 | — |
| 박대리 원본 링크 | P4 | 원본 확인 전 "미확정" | 일반 여행숏츠 템플릿만 제공 |
| Suno 플랜·곡 권리 | P4 | Pro 이상에서 받은 곡만 | 권리 메모 없는 곡은 최종 내보내기 차단 |
| 채널 계정 종류 | P5 | 인스타 프로페셔널, 페이스북 페이지 | 수동 패키지만 |
| 도메인·공개 범위 | P5/P7 | 홈페이지 만들 때 | 비공개 |
| 협업 인원 | P7 | 4명 이상이면 Remotion 유료 | 단일 사용자 |
| 전문 업무 책임자 | P8 | 분야별 검토 책임자 | P8 시작 안 함 |

---

## 3. 기술 구성

| 영역 | 선택 | 메모 |
|---|---|---|
| 웹 | **Next.js (App Router) + TypeScript strict** | 모든 DB·파일 접근 라우트는 **Node 런타임**(Edge 금지) |
| UI | `docs/design/tokens.css` CSS 변수 + CSS Modules (Tailwind 쓰면 토큰 연결) | 임의 색상값 금지 |
| 글꼴 | Pretendard(OFL) 기본, Noto Sans KR(OFL) 보조, 로컬 번들 | |
| DB | **SQLite + Drizzle ORM (`better-sqlite3`)**, foreign_keys ON, WAL | P7에서 Postgres. ORM만으로 이식이 보장되지 않으므로 이전 시 스키마·데이터·파일 검증과 롤백 필요 |
| 검증 | zod | JSON 칼럼, 외부 입력, 제공자 응답, menus.json |
| 작업 처리 | **자체 `jobs` 테이블 + 별도 워커 프로세스(동시 실행 1)** | P7에서 pg-boss |
| 영상 조립 (P2) | Remotion (`@remotion/player`, PC에서 `renderMedia`) | 개인·3인 이하 무료 |
| 미디어 보조 | ffmpeg·ffprobe 바이너리를 `child_process`로 직접 호출 | `fluent-ffmpeg` 사용 금지(지원 중단) |
| 테스트 | Vitest | 화면 검수는 검수 담당이 실제 브라우저로 1280·390px 확인 |
| 런타임 | Node 22 LTS 이상 (현재 PC Node 26) | P0에서 의존성 버전을 공식 문서로 확인 후 **고정**, lockfile 커밋 |

### 3.1 실행 구성 (P0~P6)

```
[브라우저] ⇄ [Next.js 웹 · 127.0.0.1:3000] ⇄ [SQLite · data/app.db]
                          │                         ▲
                          ▼                         │
                 [워커 · npm run worker] ───────────┘
                     │            │
                     ▼            ▼
              [AI 제공사 API]  [storage/ 파일]
```

- 로그인이 없으므로 웹 서버는 **127.0.0.1에만 바인딩**한다.
- 시작 시 점검: 마이그레이션 적용 여부, `storage/`·`data/`·`backups/` 쓰기 가능, 남은 디스크 용량(기본 5GB 미만이면 경고). 실패 시 화면에 원인 표시.

### 3.2 npm 스크립트 (P0에서 모두 정의, README에 사용법)

| 스크립트 | 하는 일 |
|---|---|
| `dev` | 웹 개발 서버 |
| `worker` | 작업 워커 |
| `dev:all` | 웹 + 워커 동시 실행 |
| `build` / `start` | 빌드 / 실행 |
| `lint` / `typecheck` / `test` | 검사 |
| `db:migrate` | 마이그레이션 적용 |
| `db:seed` | 가상 데이터 넣기. **기존 사용자 데이터를 덮어쓰지 않는다** (빈 DB에서만, 또는 `seed-` 접두 ID만) |

---

## 4. 폴더 구조와 계층

```
dream-ai-studio/
├─ CLAUDE.md
├─ docs/
├─ app/                      # 화면. DB·제공자·파일을 직접 부르지 않는다
│  ├─ (studio)/
│  │  ├─ page.tsx            # 작업실
│  │  ├─ menus/[menuId]/     # 분야 소개 + 분야별 프로젝트
│  │  ├─ projects/new/
│  │  ├─ projects/[id]/      # 단계 탭: brief/plan/produce/edit/review/export
│  │  ├─ library/            # 자료·캐릭터 보관함
│  │  ├─ jobs/               # 작업 대기열
│  │  └─ settings/
│  └─ (workspace)/           # 전문 업무공간 자리 ("준비 중")
├─ components/               # 디자인 시스템 부품
├─ lib/
│  ├─ menus/                 # menus.json 로더 + zod
│  ├─ domain/                # 순수 규칙 (단계 전이, 게이트, 버전, 비용) — 아무것도 import 안 함
│  ├─ services/              # 업무 로직. repo·jobs·storage·providers를 조합. 게이트 검사 위치
│  ├─ repo/                  # Drizzle 쿼리만. 제공자·파일 호출 금지
│  ├─ db/                    # 스키마, 마이그레이션, 시드
│  ├─ jobs/                  # enqueue, claim, retry, recover
│  ├─ providers/             # mock, anthropic, fal, kling, gemini, elevenlabs …
│  ├─ media/                 # ffmpeg·ffprobe, MIME 판별, 해시
│  ├─ render/                # (P2) Remotion
│  ├─ export/                # ZIP·manifest·SRT
│  ├─ backup/                # 백업·복원
│  └─ storage/               # 파일 저장 (P7에서 Supabase Storage로 교체되는 지점)
├─ worker/
├─ data/  storage/  backups/ # git 제외
└─ tests/
```

**의존 방향**: `app → services → (domain, repo, jobs, storage, providers)`. `repo`는 제공자를 부르지 않는다. `providers`는 DB를 모른다. DB·파일·비밀은 서버 전용 모듈(`server-only`)에서만.

---

## 5. 핵심 도메인 규칙

### 5.1 제작 단계

| 키 | 이름 | 하는 일 | 다음으로 가는 조건 |
|---|---|---|---|
| `intake` | 등록 | 분야·공통 입력·분야별 입력, 자료 연결 | 필수 입력 충족 (자동) |
| `brief` | 요구 확인 | 조건·규격 정리, 누락·불명확 항목 표시 | 사용자 "확인 완료" |
| `plan` | 기획 | `planSteps` 순서, 대본, 장면표 | **사용자 승인 (게이트)** |
| `produce` | 장면 제작 | 장면별 생성, 버전 선택 | 모든 활성 장면에 선택된 완료 버전 |
| `edit` | 수정·조립 | P1: 정적 글자 설정·순서 확인 / P2: 타임라인·렌더 | P1: 확인 완료 / P2: 렌더 성공 파일 |
| `review` | 검수 | 공통 + 분야별 + 조건부 체크리스트 | **필수 항목 통과 + 사용자 승인 (게이트)** |
| `export` | 내보내기 | ZIP 생성 | 내보내기 성공 기록 |

### 5.2 단계 상태와 전이

상태: `locked` · `todo` · `in_progress` · `needs_approval` · `approved` · `failed`

| 규칙 | 내용 |
|---|---|
| S1 | 단계 N은 N-1이 `approved`일 때만 열린다 |
| S2 | 게이트(`plan`, `review`)는 사용자 행동으로만 `approved`. 자동 승인 금지 |
| S3 | **특정 기획 버전 + 그 시점 장면표 스냅샷**을 승인한다. 승인 후 수정하면 새 draft가 생기고, 그 draft로는 승인 전까지 생성 불가. 승인된 원본은 보존. 이미 만든 장면은 지우지 않고 "기획 변경 후 확인 필요" 표시 |
| S4 | 선택 결과·장면·대사·글자·규격이 바뀌면 `projects.content_revision`을 1 올린다 |
| S5 | 검수는 **하나의 content_revision에만** 유효. revision이 바뀌면 검수와 내보내기 자격이 무효화된다. 이미 만든 내보내기와 manifest는 바뀌지 않는다 |
| S6 | 프로젝트 표시 상태는 단계·작업 상태에서 계산한다(실패 작업 있으면 "확인 필요" 등). 손으로 바꾸지 않는다 |
| S7 | 모든 전이는 `lib/domain/stages.ts` 순수 함수 + 서비스 계층 검사. 승인·버전 할당·선택은 **트랜잭션** 안에서 활동 기록과 함께 쓴다 |

### 5.3 버전 규칙

| 대상 | 저장 | 선택·복원 |
|---|---|---|
| 기획 `plans` | `(project_id, version)` 유일. 승인 버전은 수정 불가, 승인 시 장면표 스냅샷 저장 | `projects.approved_plan_id` |
| 장면 결과 `scene_versions` | 생성마다 새 행, 결과 파일 불변, 생성 당시 입력 스냅샷 보관 | `scenes.selected_version_id`가 **유일한 선택 기준**. 같은 장면의 `succeeded` + 파일 존재 버전만 선택 가능 |
| 타임라인 (P2) | 저장마다 스냅샷 행 | `projects.current_timeline_rev_id` |
| 파일 `assets` | 불변. 역할만 변경 | — |

삭제는 `archived_at`으로만 한다. 실제 파일 정리는 설정의 "정리" 기능에서 확인 후, 원본(original)이 아니고 어디서도 참조되지 않는 것만.

동시 선택 충돌: 두 요청이 같은 장면을 동시에 선택하면 하나만 이긴다(트랜잭션 + 버전 비교). 진 쪽은 "다른 선택이 먼저 저장됨" 안내.

---

## 6. 분야 템플릿 (`docs/spec/menus.json`)

### 6.1 규칙

| 규칙 | 내용 |
|---|---|
| M-1 | 시작 시 zod로 검증. 실패하면 앱이 어떤 항목이 틀렸는지 표시하고 멈춘다 |
| M-2 | 구조: `schemaVersion`, `templateVersion`, `stages`, `commonInputs`, `commonReview`, `conditionalReview`, `groups`, `menus[]`, `workspaces[]` |
| M-3 | 메뉴 항목: `id`(고유·불변), `label`, `group`, `phase`, `availability`(`active`/`skeleton`/`planned`), `description`, `source`, `defaultAspect`, `defaultLengthSec`, `inputs[]`(id·label·type·required·검증), `planSteps[]`, `reviseOptions[]`, `review[]`(고유·불변 id), `outputs[]`, `unconfirmed[]` |
| M-4 | 프로젝트 생성 시 해당 메뉴의 **템플릿 버전·스냅샷·입력값을 프로젝트에 저장**한다. 나중에 menus.json이 바뀌어도 기존 프로젝트의 요구사항은 그대로 |
| M-5 | `availability`가 `skeleton`/`planned`인 메뉴는 소개 화면과 "준비 단계 Pn" 표시만. 프로젝트 생성은 `active`만 (P1에서는 쇼핑숏츠만 `active`) |

### 6.2 기획서 대조 (메뉴 수 확정)

9번 시트는 15행(콘텐츠 13 + 업무 2)이다. 7번·3번·10번 시트를 반영해 **콘텐츠 16개 + 업무공간 2개**로 정한다.

| menus.json id | 이름 | 기획서 근거 | 처리 |
|---|---|---|---|
| `shopping-shorts` | 쇼핑숏츠·제품 광고 | 9번 "쇼핑숏츠 / 제품 광고", 6번 1순위 | 그대로 |
| `travel-shorts` | 여행숏츠 | 9번 "여행숏츠 / 여행 쇼핑숏츠" | 7번이 "별도 유형"이라 하여 둘로 분리 |
| `travel-shopping-shorts` | 여행 쇼핑숏츠 | 7번 "여행 쇼핑숏츠" | 분리 |
| `brand-connect` | 네이버 브랜드커넥트 | 9번 | 그대로 |
| `playlist` | 플레이리스트 | 9번, 7번(LP·이퀄라이저 레이어 포함) | 그대로 |
| `music-video` | 뮤직비디오·춤 | 9번, 7번 "캐릭터 춤 전이" | 그대로 |
| `ai-drama` | AI 드라마 | 9번 | 그대로 |
| `ai-film` | AI 영화 | 9번 (별도 메뉴 요구) | 그대로 |
| `yadam-longform` | 야담 롱폼 | 9번 | 그대로 |
| `animation-gif` | 애니메이션·GIF | 9번, 7번 "GIF" | 그대로 |
| `caption-motion` | 자막 모션 | 9번, 11번 | 그대로 |
| `motion-graphics-2d` | 2D 모션그래픽 V3.1 | 9번 | 그대로 |
| `product-transform` | 제품 변환·3D 글자·FOOH | 7번 "모션: 제품 변환·3D·FOOH", 10번 | 9번에는 쇼핑숏츠 기법으로만 있으나 별도 제작 규칙이 커서 메뉴로 분리 |
| `contest` | 공모전 | 9번, 7번 | 그대로 |
| `sns-channels` | SNS 5채널 패키지 | 9번 "5개 SNS 채널 / 홍보 홈페이지" | 3번 화면 목록이 별개라 둘로 분리 |
| `promo-site` | 홍보 홈페이지 | 위 | 분리 |
| 업무 `legal-tax` | 법무·부동산·세무 | 9번 | P8 별도 프로젝트 |
| 업무 `home-care` | 재가센터 | 9번 | P8 별도 프로젝트 |

7번 시트의 "모션: 카메라·전환·사운드"는 메뉴가 아니라 **공통 편집 기능**(P2 타임라인의 전환·효과음·카메라 메모)으로 반영한다.

---

## 7. 데이터 스키마

공통: ID는 문자열 UUID v7, 시각은 UTC ISO 저장·화면은 Asia/Seoul, JSON 칼럼은 `text` + zod, **금액은 정수 마이크로 단위 + 통화 칼럼**(부동소수 합계 금지), foreign key와 상태 칼럼 인덱스.

### 7.1 P1 테이블

| 테이블 | 칼럼 | 제약 |
|---|---|---|
| `projects` | id, menu_id, template_version, template_snapshot_json, inputs_json, title, goal, target, aspect(`9:16`/`16:9`/`1:1`), length_sec, approved_plan_id, content_revision, current_timeline_rev_id(P2), archived_at, created_at, updated_at | |
| `stage_states` | project_id, stage, status, approved_plan_id, approved_revision, approved_at, note | unique(project_id, stage) |
| `assets` | id, kind(`image/video/audio/text/doc/link`), title, source_url, rights_note, role(`original/intermediate/selected/final`), file_path(link면 null), mime(실제 판별값), size_bytes, sha256, width, height, duration_ms, origin(`upload/link/generated/render/import`), generation_id, is_mock, archived_at, created_at | link와 file 상호 배타 검증 |
| `project_assets` | project_id, asset_id, purpose | unique(project_id, asset_id, purpose) |
| `characters` | id, name, description, locked_json(`face/outfit/hair/accessories/body/voice` 각 잠금 여부+메모), ref_asset_ids_json, voice_profile_json, status(`confirmed/unconfirmed`), archived_at, created_at | |
| `project_characters` | project_id, character_id | unique |
| `plans` | id, project_id, version, steps_json, script, status(`draft/approved`), approved_scene_snapshot_json, approved_at, created_at | unique(project_id, version) |
| `scenes` | id, project_id, position, title, description, dialogue_json, character_ids_json, duration_sec, needs_recheck, selected_version_id, archived_at | |
| `scene_versions` | id, scene_id, version, plan_id, kind(`image/video/speech`), input_snapshot_json, job_id, generation_id, result_asset_id, status(`queued/running/succeeded/failed/canceled`), created_at | unique(scene_id, version) |
| `jobs` | id, kind, payload_version, input_snapshot_json, status, project_id, ref_type, ref_id, provider, provider_job_id, idempotency_key, attempts, max_attempts, next_run_at, lease_until, heartbeat_at, cancel_requested_at, error_code, error_message, created_at, updated_at, finished_at | unique(idempotency_key) |
| `generations` | id, job_id, provider, model, params_json, reference_snapshot_json, seed, cost_estimate_micros, cost_actual_micros, currency, settlement(`none/reserved/settled/refunded`), started_at, finished_at | |
| `review_items` | id, project_id, content_revision, template_item_id, label, source(`common/menu/conditional/custom`), required, status(`unchecked/pass/hold`), note, checked_at | unique(project_id, content_revision, template_item_id) |
| `exports` | id, project_id, content_revision, status(`running/succeeded/failed`), file_path, manifest_version, manifest_json, sha256, error, created_at, completed_at | |
| `activity_log` | id, project_id, actor, action, detail_json, created_at | |
| `settings` | key, value_json | 키 원문 저장 금지 |
| `backups` | id, kind(`auto/manual`), path, db_sha256, file_inventory_sha256, status, error, created_at | |

### 7.2 이후 단계 테이블

| 단계 | 테이블 | 내용 |
|---|---|---|
| P2 | `timeline_revisions`, `text_presets` | 타임라인 스냅샷, 글자 프리셋 |
| P3 | `budgets`, `budget_reservations` | 월 한도, 작업별 예약·정산 |
| P4 | `campaigns`, `contests` | 수동 캠페인, 공고 조건표(`ai_allowed`: yes/no/unclear, 마감 시각+시간대) |
| P5 | `channel_packages`, `posts` | 채널별 문구·파일, 게시 기록 |
| P7 | `users`, `project_members` | 역할(owner/collaborator/student), RLS |

**P1 정적 글자 설정 저장 (T-002, 2026-11-15):** P1에는 전용 테이블을 만들지 않고 `settings`에 `project.<id>.edit.<UUID>`(스냅샷: 글자·순서, `schema_version`, `content_revision`, `created_at`)를 **새 행으로만** 추가하고 `project.<id>.edit.current` 포인터만 바꾼다. 스냅샷 행은 고치거나 지우지 않는다. 포인터 변경은 revision 증가·검수/내보내기 자격 무효화와 같은 트랜잭션. 설정 화면 목록에는 보이지 않게 한다. P2에서 `timeline_revisions`를 만들 때 현재 스냅샷을 첫 버전으로 옮기고 settings 행은 읽기 전용으로 남긴다.

---

## 8. AI 제공자 어댑터

### 8.1 인터페이스 (`lib/providers/types.ts`)

```ts
type Capability = 'text' | 'image' | 'video' | 'speech' | 'dialogue' | 'music' | 'transcribe' | 'lipsync' | 'motion';

interface GenerationRequest {
  capability: Capability;
  model: string;                       // 설정값. 코드에 하드코딩 금지
  prompt?: string;
  refAssets?: { assetId: string; role: 'character' | 'start_frame' | 'end_frame' | 'style' | 'audio' | 'motion' }[];
  params: Record<string, unknown>;     // capability별 zod 스키마로 검증 (aspect, durationSec, voiceId …)
}

type ProviderOutput =
  | { type: 'structured'; data: unknown; usage?: Usage }              // 기획·대본 등 (zod로 재검증)
  | { type: 'media'; files: { url?: string; bytes?: Uint8Array; mime: string }[]; usage?: Usage };

interface Usage { costMicros?: number; currency?: string }

interface ProviderError {
  code: 'CONTENT_REJECTED' | 'INVALID_INPUT' | 'RATE_LIMITED' | 'PROVIDER_DOWN' | 'TIMEOUT' | 'AUTH' | 'BUDGET_EXCEEDED' | 'UNKNOWN';
  message: string;
  retryable: boolean;
}

interface Provider {
  id: string;
  capabilities: Capability[];
  estimateCost(req: GenerationRequest): { micros: number; currency: string };
  submit(req: GenerationRequest, idempotencyKey: string): Promise<{ providerJobId?: string; output?: ProviderOutput }>;
  poll(providerJobId: string): Promise<{ state: 'pending' | 'succeeded' | 'failed' | 'canceled'; output?: ProviderOutput; error?: ProviderError }>;
  cancel?(providerJobId: string): Promise<void>;
}
```

### 8.2 규칙

| 규칙 | 내용 |
|---|---|
| A-1 | 결과는 **임시 위치로 내려받기 → 형식·크기·해시 검증 → 원자적으로 확정 → 그다음에 성공 처리**. 외부 URL은 영구 자산이 아니다 (Replicate 1시간 삭제, fal 모델 수시 종료) |
| A-2 | 저장 실패(`STORAGE_FAILED`)는 제공자 생성 실패와 구분해 표시. 결과를 다시 받을 수 있으면 재시도 |
| A-3 | 모델 ID·가격표는 `config/providers.json`. 코드 수정 없이 교체 |
| A-4 | `CONTENT_REJECTED`(실사 얼굴·유명인 등)는 재시도하지 않고 사유를 장면 카드에 표시 |
| A-5 | 응답은 zod 검증. 형식이 다르면 `UNKNOWN` 실패, 키를 뺀 원문 일부를 로그에 |
| A-6 | 캐릭터 일관성은 "보장"이라 쓰지 않는다. 화면 문구: "참조 이미지로 최대한 유지 · 검수 필요" |

### 8.3 mock 제공자 (P1~P2 기본)

| 항목 | 동작 |
|---|---|
| 기본 | **항상 성공, 결정적**(같은 입력 → 같은 결과). 0.5~1.5초 지연 |
| 시나리오 | 입력 또는 설정으로 `fail:CONTENT_REJECTED`, `fail:PROVIDER_DOWN`(재시도 후 성공), `delay:10s`, `cancel-late`(취소 후 늦게 결과 도착) 등을 지정 → 테스트에서 반복 재현 |
| 수동 QA 모드 | 설정에서 켜면 무작위 실패율(기본 0.1). 기본값은 꺼짐 |
| text | 해당 메뉴 `planSteps` 라벨에 맞춘 한국어 샘플 |
| image | 지정 비율 PNG, 장면 제목·버전 번호·"샘플" 워터마크 |
| video | ffmpeg가 있으면 3~5초 무음 MP4(단색+글자+"샘플"), 없으면 이미지로 대체하고 그렇게 표시 |
| speech | 길이에 맞는 무음 WAV |
| 표시 | 모든 mock 결과는 `assets.is_mock = 1`, 화면과 manifest에 "샘플" 표시. **완성 영상으로 표시 금지** |

### 8.4 실제 제공자 매핑 (P3 이후 · 후보 · 연결 직전 공식 문서 재확인)

| capability | 1순위 후보 | 대안 | 단계 |
|---|---|---|---|
| text | Anthropic Claude API (기본 Sonnet 5.5, 복잡한 기획 Opus 5.5) | — | P3 |
| image | Gemini Nano Banana 2.1 | FLUX Kontext(fal), gpt-image-2 | P3 |
| video | Kling 공식 API | Gemini Omni Flash, fal 경유 | P3 |
| speech·dialogue | ElevenLabs v4 | Gemini TTS | P3 |
| transcribe | ElevenLabs Scribe v3 | faster-whisper(PC, NVIDIA GPU) | P4 |
| music | 수동 가져오기(Suno) | ElevenLabs Music, Lyria 3.5 (한국어 보컬 시험 후) | P4 |
| lipsync | sync.so | Kling, Hedra | P6 |
| motion | Kling Motion Control | Runway Act-Two, Wan Animate | P6 |
| 통합 창구 | fal.ai | Runway API | P3 |
| 제외 | Sora(2026-09 API 종료), Midjourney(공식 API 없음), MuAPI 기본 사용(정책 위험) | | |

연결 전에 각 제공자의 **공식 문서 URL, 확인 날짜, 계정 사용 가능 여부**를 `REFERENCES.md`에 기록한다. 기록 없는 제공자는 연결하지 않는다.

---

## 9. 작업 큐 (`jobs`)

| 항목 | 규칙 |
|---|---|
| 종류 | `generate`, `render`(P2), `media`, `export`, `backup` |
| 생성 | 서비스가 게이트를 검사한 뒤 생성. **입력 스냅샷**(승인된 기획 버전, 참조 자료, 잠긴 캐릭터 설정)을 함께 저장 |
| 중복 방지 | `idempotency_key` = 대상 + 입력 스냅샷 해시. 같은 키의 진행 중 작업이 있으면 새로 만들지 않고 기존 작업을 보여준다 |
| 집기 | 워커(동시 1)가 트랜잭션으로 `queued AND next_run_at<=now` 하나를 `running`, `lease_until=now+60s`. 처리 중 20초마다 `heartbeat_at`·lease 연장 |
| 비동기 제공자 | submit 후 `provider_job_id` 저장. PC에서는 **폴링이 기본**(5초 → 10초 → 최대 30초) |
| 재시도 | `retryable` 오류만, 최대 3회, 30초 × 2^(n-1). 재시도 불가: `CONTENT_REJECTED`, `INVALID_INPUT`, `AUTH`, `BUDGET_EXCEEDED` |
| 시간 초과 | generate 15분, render 30분, export 10분 |
| 재시작 복구 | lease 지난 `running` → `provider_job_id`가 있으면 **재제출 없이 poll부터**, 없으면 `queued` |
| 취소 | 로컬 취소(`cancel_requested_at`) → 제공자 취소 지원 시 요청 → 결과. **취소 후 늦게 온 결과는 저장은 하되 자동 선택하지 않는다.** 실제 과금 여부는 따로 기록 |
| 화면 | 2초 폴링(또는 SSE). 완료·실패 토스트. 작업 대기열 화면에서 전체 조회·재시도·취소 |

---

## 10. 파일 저장

```
storage/
├─ library/{assetId}.{ext}                    # 공용 자료·캐릭터 참조
├─ projects/{projectId}/assets/{assetId}.{ext}
├─ projects/{projectId}/renders/{renderId}.mp4  (P2)
├─ projects/{projectId}/exports/{exportId}.zip
└─ tmp/                                       # 다운로드·작성 중 임시 (확정 시 이동)
```

| 규칙 | 내용 |
|---|---|
| F-1 | 파일명은 서버가 만든 UUID. 사용자 파일명은 `title`에만 |
| F-2 | 경로는 정규화한 상대경로로 저장하고, 사용할 때 **실제 경로가 storage 루트 안인지 확인** (경로 조작 차단) |
| F-3 | 허용 형식: 이미지 png·jpg·webp, 영상 mp4·mov·webm, 오디오 mp3·wav·m4a, 문서 pdf·txt·md. **확장자가 아니라 실제 내용(매직 바이트)으로 MIME 판별**. 그 외는 "지원하지 않는 형식"으로 거절 |
| F-4 | 크기 한도 기본 2GB/파일(설정 가능). 디스크 부족은 명확한 오류로 |
| F-5 | 업로드 파일을 정적 웹 폴더(`public/`)에 두지 않는다. 내려받기·미리보기는 라우트 핸들러가 검증 후 스트리밍, `Content-Disposition`·`X-Content-Type-Options: nosniff` 설정 |
| F-6 | 저장 시 sha256·크기·해상도·길이 측정(ffprobe) |
| F-7 | P1의 링크 등록은 **메타데이터만 저장**한다. 원격 파일을 서버가 받아오는 기능은 별도 설계 후 |

---

## 11. 타임라인과 글자 레이어

### 11.1 P1 범위
- 글자는 **정적 오버레이 설정**(문구·글꼴·크기·색·위치·시작/끝 시간)만 저장하고, 정지 화면 위에 미리보기한다.
- SRT는 사용자가 입력한 시간으로만 만든다(자동 음성 정렬 아님). UTF-8, 시간 형식 검증.

### 11.2 P2 타임라인 JSON (`timeline_revisions.timeline_json`)

```jsonc
{
  "schemaVersion": 1,
  "fps": 30,                         // 모든 시간은 정수 프레임으로 환산해 계산
  "aspect": "9:16",                  // 1080x1920 | 16:9 1920x1080 | 1:1 1080x1080
  "video": [ { "id": "clip_1", "sceneId": "...", "sceneVersionId": "...", "assetId": "...",
               "trimInFrames": 0, "trimOutFrames": 0,
               "transition": { "type": "cut", "durationFrames": 0 } } ],
  "audio": [ { "id": "a_1", "assetId": "...", "role": "voice", "startFrame": 0,
               "gainDb": 0, "fadeInFrames": 0, "fadeOutFrames": 0, "duckUnderVoice": true } ],
  "text":  [ /* TextLayer[] */ ]
}
```

### 11.3 글자 레이어 (11번 시트 반영)

```jsonc
{
  "id": "t_1",
  "kind": "subtitle | hook | emphasis | title | ending | lyric | brand | disclosure",
  "content": "문구",
  "speakerCharacterId": null,
  "style": { "fontFamily": "Pretendard", "fontSize": 64, "fontWeight": 700, "color": "#FFFFFF",
             "stroke": { "color": "#000000", "width": 6 }, "shadow": null, "background": null,
             "align": "center", "letterSpacing": 0, "lineHeight": 1.3, "maxLines": 2 },
  "box":   { "x": 0.5, "y": 0.82, "anchor": "center", "widthRatio": 0.86, "rotation": 0 },
  "timing": { "startFrame": 0, "endFrame": 60 },
  "animation": { "in": "none | fade | pop | slide-up | typewriter", "out": "none | fade | slide-down",
                 "emphasis": "none | bounce | shake | scale", "durationFrames": 8, "easing": "ease-out" },
  "locked": false
}
```

| 규칙 | 내용 |
|---|---|
| T-1 | 글자는 영상에 미리 굽지 않는다. 렌더 시 합성 → 문구 수정에 영상 재생성 없음 |
| T-2 | 비율 전환 시 안전영역 안으로 재배치 후 확인 표시 |
| T-3 | 9:16 안전영역: 위 12%, 아래 20%, 오른쪽 12% → 침범 시 경고 |
| T-4 | `disclosure` 레이어(광고·AI·가상인물 표기)는 검수와 연결, 삭제 시 경고 |
| T-5 | 상업 이용이 확인된 글꼴만 목록에. ZIP에 글꼴 동봉 시 라이선스 파일 포함 |

### 11.4 렌더·오디오 (P2)
H.264 + AAC, 30fps. 최종 음량 약 -14 LUFS(`loudnorm` 2단계), 음성 구간 음악 자동 낮춤, 곡 전환 `acrossfade`. 렌더 결과는 ffprobe로 길이·해상도·오디오 트랙을 확인한 뒤에만 성공.

---

## 12. 검수 체크리스트

`review` 단계에 들어가면 현재 `content_revision` 기준으로 공통 + 분야별 + 조건부 항목을 만든다. 항목 ID는 menus.json의 고유 ID.

| ID | 항목 | 필수 | 자동 확인 |
|---|---|---|---|
| `c.files-exist` | 결과 파일이 실제로 존재하고 열린다 | ✔ | ffprobe·해시 |
| `c.spec-match` | 비율·해상도·길이가 규격과 맞다 | ✔ | ffprobe |
| `c.no-mock-final` | 샘플(mock) 결과가 최종본으로 표시되지 않았다 | ✔ | `is_mock` 검사 |
| `c.typos` | 자막·대사 오탈자·글자 잘림 없음 | ✔ | — |
| `c.sync` | 음성과 자막 시간이 맞다 | ✔ | — |
| `c.rights` | 사용한 원본·음원에 출처·권리 메모가 있다 | ✔ | DB 검사 |
| `c.no-personal-data` | 실제 개인정보 없음 | ✔ | — |
| `c.no-fabrication` | 확인 안 된 사실·후기·수치 없음 | ✔ | — |
| `x.ad-disclosure` | (광고·협찬) 제목 또는 시작에 한글 "광고"/"유료 광고 포함", 시작·끝·상품 언급 시 표기 | ✔ | disclosure 레이어 |
| `x.ai-label` | (실사형 AI) 채널 AI 표시 항목 켜기 | ✔ | P5 패키지 |
| `x.virtual-human` | (AI 가상인물 추천·보증) 등장 중 "가상인물" 표기 — 공정위 원문 확인 필요 | ✔ | disclosure 레이어 |
| `x.music-rights` | (음악 사용) 곡별 플랜·생성일·라이선스 기록 | ✔ | DB 검사 |

필수 항목이 모두 `pass`여야 검수 승인 버튼이 열리고, 서버도 같은 조건을 다시 확인한다. `hold`는 사유 필수.

---

## 13. 내보내기 ZIP

서버는 내보내기 직전에 **승인된 기획 버전, 현재 revision의 검수 승인, 선택된 결과, 파일 존재**를 다시 확인한다.

```
{slug}_{YYYYMMDD-HHmm}/
├─ final/        {slug}_9x16.mp4                 ← P2부터. P1에는 없음
├─ scenes/       01_{장면}.{ext} …               ← 선택된 장면 결과 (mock은 파일명에 _SAMPLE)
├─ script/       script.txt, plan.md
├─ subtitles/    {slug}.srt                      ← P1: 수동 시간 / P2: 타임라인 기준
├─ edit/         text_overlays.json (P1) · timeline.json (P2)
├─ captions/     채널별 문구 (P5)
├─ provenance/   generations.json, rights.md
├─ review/       checklist.md
├─ LICENSES/     (글꼴 동봉 시)
└─ manifest.json
```

| 규칙 | 내용 |
|---|---|
| E-1 | **P1 내보내기는 "편집용 묶음"이다.** 완성 영상이라고 부르지 않는다 |
| E-2 | `manifest.json`: manifestVersion, project, menu, templateVersion, contentRevision, exportedAt, isMock, files[{path(상대), sha256, sizeBytes, mime, sceneId?, versionId?, durationMs?, width?, height?, rights?}]. **비밀·PC 절대경로 금지** |
| E-3 | 큰 ZIP은 스트리밍으로 `tmp/`에 작성 → 다시 열어 manifest 전 파일 존재·해시 확인 → 원자적 이동 → 그다음 성공 |
| E-4 | 디스크·저장 오류는 실패로 기록하고 화면에 표시 |
| E-5 | 만들어진 내보내기와 manifest는 이후 바뀌지 않는다 |

---

## 14. 백업·복원

| 규칙 | 내용 |
|---|---|
| K-1 | SQLite는 파일 복사가 아니라 **일관된 스냅샷**(백업 API 또는 `VACUUM INTO`) |
| K-2 | 백업 = DB 스냅샷 + storage 파일 목록·해시(인벤토리) + 파일. API 키·`.env` 제외 |
| K-3 | 앱·워커가 켜져 있을 때 하루 1회. 놓친 백업은 다음 실행 때 수행. 마지막 성공·실패를 설정·작업실에 표시 |
| K-4 | PC 안 백업은 PC 고장을 막지 못한다 → 외부 백업 위치(외장 디스크·동기화 폴더) 지정 기능 |
| K-5 | 복원: 검증된 별도 위치에 먼저 풀기 → 경로 조작·누락 파일·지원 안 되는 스키마 버전이면 거부 → 현재 데이터 스냅샷 → 교체 → 실패 시 되돌리기 |

---

## 15. 비용·예산 (P3)

| 규칙 | 내용 |
|---|---|
| B-1 | 실제 제공자 실행 전 예상 비용 표시 |
| B-2 | 월 한도 미설정이면 실제 제공자 실행 불가 |
| B-3 | 작업 생성 시 예상 비용을 **원자적으로 예약**(`reserved`). `사용액 + 예약 합계 + 이번 예상 > 한도`면 `BUDGET_EXCEEDED` |
| B-4 | 완료·실패·취소 후 제공사 실제 청구 기준으로 **정산**(`settled`) 또는 **반환**(`refunded`). 실패·거절이라고 무조건 0원으로 보지 않는다 |
| B-5 | 1회 예상 비용이 설정값(기본 $1) 이상이면 화면 안 확인 단계 |
| B-6 | 작업실·설정에 이번 달 사용액·예약액, 제공사별·프로젝트별 합계. 응답에 실제 비용이 없으면 "추정" 표시 |

---

## 16. 보안·개인정보

- API 키는 `.env.local`에만. 설정 화면은 "연결됨 · 끝 4자리"와 연결 시험만. 로그·오류에 키·Authorization 헤더 출력 금지.
- `.gitignore`: `.env*`(단 `.env.example` 포함), `data/`, `storage/`, `backups/`.
- 127.0.0.1 바인딩. P7 전 외부 공개 금지.
- 업로드 파일은 실행하지 않고 정적 폴더에서 서빙하지 않는다(F-5).
- 전문 업무(P8) 데이터는 이 코드베이스·DB에 넣지 않는다.

---

## 17. 디자인 기준 (요약 — 상세는 P0-1 산출물)

| 항목 | 기준 |
|---|---|
| 분위기 | 명확함 · 따뜻함 · 수정하기 쉬움 |
| 색 | 남색 `#243B53`(주), 민트 `#0E9F94`(강조), 크림 `#FAF8F3`(배경). 토큰으로만 |
| 상태 | 성공·경고·실패·진행·잠김·샘플을 **색 + 아이콘 + 글자**로 함께 표시 |
| 글자 | 본문 최소 15px |
| 레이아웃 | PC 우선(제작·관리), 휴대폰은 검수·수정 요청 중심 카드. 390px에서 가로 스크롤 없음 |
| 접근성 | 키보드로 모든 조작, 포커스 표시, 확인 창 열리면 포커스 이동·Esc 닫기 |
| 피할 것 | 복잡한 메뉴, 작은 글씨, 결과 파일 없는 완료 표시, 원본 덮어쓰기, 전체 재생성 유도, 승인 없는 게시, 브라우저 기본 `confirm()` |

---

## 18. 단계별 마일스톤

이전 마일스톤 번호와의 대응: M1=P0, M2=P1-1·P1-3, M3=P1-4, M4=P1-5, M5=P1-6·P1-7, M6=P1-8.

### P0. 기반·디자인·전체 메뉴 뼈대

| ID | 작업 | 담당 | 완료 기준 |
|---|---|---|---|
| P0-1 | 디자인 시스템: `DESIGN.md`, `tokens.css`, `prototype.html`(작업실·분야 소개·프로젝트 단계 탭·장면 카드·검수) | 플래너 | 은영님 시안 확인 |
| P0-2 | 프로젝트 생성: Next.js, TS strict, 린트, Vitest, 4장 폴더, `.gitignore`, `.env.example`, 3.2 스크립트, README, 의존성 버전 확인·고정 | 코더 | build·lint·typecheck·test 통과 |
| P0-3 | menus.json 로더 + zod 스키마 + 시작 시 검증 | 코더 | 잘못된 JSON이면 어느 항목인지 표시 |
| P0-4 | 공통 부품: Button, IconButton, Card, Badge, StatusPill, Stepper, Tabs, EmptyState, PageHeader, Field(라벨·도움말·오류), Toast, ConfirmPanel | 코더 | 시안 일치, 키보드 포커스 |
| P0-5 | 레이아웃: 사이드바(menus.json 그룹 순서 자동), 상단바, 분야 소개(availability·단계 표시), 업무공간 "준비 중", 시작 점검 화면 | 코더 | 모든 메뉴 404 없음, 1280/390px 가로 스크롤 없음 |

P0-2는 디자인 산출물 없이 먼저 진행할 수 있다. P0-4·P0-5는 P0-1 이후.

### P1. 공통 제작 흐름 (mock)

| ID | 작업 | 완료 기준 | 필수 테스트 |
|---|---|---|---|
| P1-1 | DB 스키마(7.1)·마이그레이션·시드·시작 점검 | 재시작 후 데이터 유지, 시드가 기존 데이터를 덮지 않음 | 스키마·제약·시드 |
| P1-2 | 도메인 규칙: 단계 전이·게이트·버전·revision (5장) | S1~S7 구현, 서버에서 게이트 거부 | 상태 전이 전 케이스, 승인 전 생성 요청 거부 |
| P1-3 | 작업실 + 프로젝트 등록(템플릿 스냅샷 저장) | 필수 누락 시 칸 옆 한글 오류 | 입력 검증, 스냅샷 보존 |
| P1-4 | 자료·캐릭터 보관함 (10장 규칙) | 이미지·mp3·mp4 업로드 후 미리보기, 가짜 확장자 거절, 링크는 메타데이터만 | MIME 판별, 경로 차단, 해시 |
| P1-5 | 요구 확인 + 기획·장면표 + 승인 | 승인 전 생성 불가, 승인 후 수정 → 새 draft → 재승인 필요, 버전 비교 | S3 |
| P1-6 | 작업 큐 + 워커 + mock | 결정적 mock, 시나리오 재현, 재시작 복구, 중복 제출 방지, 취소 후 늦은 결과 자동 선택 안 함 | claim·retry·lease·idempotency·cancel |
| P1-7 | 장면 제작·버전 선택·복원 | 한 장면만 재생성 시 다른 장면 그대로, 복원 = 재선택, 동시 선택 시 한쪽만 | 포인터, 동시성, revision 증가 |
| P1-8 | 정적 글자 설정 + 검수 + 내보내기(편집용 묶음) | 필수 미통과 시 서버 거부, revision 변경 시 검수 무효, ZIP 재검증·해시 일치, 저장 오류 표시 | manifest·해시·무효화 |
| P1-9 | 생성 기록·활동 기록·백업·복원 | 놓친 백업 수행, 격리된 새 위치로 복원 후 참조 확인 | 백업 무결성·복원 롤백 |
| **P1 종료** | 쇼핑숏츠 샘플 1건을 등록부터 ZIP까지 | 검수 담당 흐름 검수 통과 + 은영님 확인 | 19장 증거 목록 |

### P2. 영상 조립·글자 레이어
P2-1 타임라인 스키마·리비전 · P2-2 Remotion 미리보기(비율 전환) · P2-3 글자 레이어 편집기·프리셋·안전영역 경고 · P2-4 PC 렌더 작업(ffprobe 검증, 진행률) · P2-5 오디오(loudnorm, 페이드, 크로스페이드, ducking) · P2-6 SRT/VTT·재편집용 ZIP.
**종료 기준**: 글자만 바꾸고 재렌더 시 영상 재생성 없음, 자막 오차 0.2초 이내, 휴대폰 재생 확인.

### P3. 실제 AI 연결 1차
P3-1 설정(키 상태·연결 시험)·예산(15장) · P3-2 Anthropic(기획·대본·과장 문구 검사) · P3-3 이미지·캐릭터 기준시트 · P3-4 영상(시작·끝 프레임, 9:16·16:9) · P3-5 음성(캐릭터별 목소리) · P3-6 실제 쇼핑숏츠 1편.
**종료 기준**: 기획서 성공 기준 충족, 한도 초과 차단, 거절 사유 표시, 실제 청구와 정산 기록 일치.

### P4. 분야 확장 A
P4-1 여행숏츠·여행 쇼핑숏츠 · P4-2 브랜드커넥트 트래커(수동) · P4-3 플레이리스트(Suno 가져오기·권리 필수·크로스페이드·챕터·루프 배경) · P4-4 가사 자막 싱크 · P4-5 공모전 분석(원문 대조, 불명확 항목, 자동 제출 없음).

### P5. 채널 패키지·게시·홍보 홈페이지
P5-1 수동 5채널 패키지(9:16 마스터 90초 이하 1080×1920, Threads 500자·주제 태그 1개, 인스타 해시태그 30개 이하, 페이스북 릴스 3~90초) · P5-2 YouTube(비공개·예약 → 승인 후 공개, 합성 미디어 표시) · P5-3 Meta · P5-4 TikTok(앱 보관함 업로드, AIGC 표시) · P5-5 기본 지표 · P5-6 홍보 홈페이지.

### P6. 고난도 분야
P6-1 뮤직비디오·춤 · P6-2 AI 드라마 · P6-3 AI 영화 · P6-4 야담 롱폼 · P6-5 애니메이션·GIF · P6-6 2D 모션그래픽(Remotion 코드 템플릿) · P6-7 제품 변환·3D·FOOH. 모두 **5초 시험 → 승인 → 확장**.

### P7. 클라우드 이전·협업
P7-1 Postgres 이전(검증·롤백 계획 포함) · P7-2 Storage(Pro, TUS, 브라우저 직접 업로드) · P7-3 Auth·역할·RLS · P7-4 pg-boss, 워커는 PC/서버(렌더는 Vercel에서 안 함) · P7-5 배포 · Remotion 라이선스 재확인.

### P8. 전문 업무 공간 (별도 저장소)
시작 조건: 실제 양식, 권한 담당자, 분야별 전문가 검토 책임자, 보안 설계 승인.

---

## 19. 검증 증거 목록 (P1 종료 시 전부 제출)

| # | 시나리오 | 기대 결과 |
|---|---|---|
| V1 | 승인 전 장면 생성 요청을 API로 직접 보냄 | 서버 거부 |
| V2 | 승인된 기획 수정 | 새 draft 생성, 재승인 전 생성 거부, 원본 보존 |
| V3 | 장면 하나만 재생성·복원 | 다른 장면 그대로, 복원 = 재선택 |
| V4 | 같은 장면 동시 선택 | 한쪽만 저장, 다른 쪽 안내 |
| V5 | 같은 작업 중복 제출 | 작업 1개 |
| V6 | 워커를 실행 중 종료 후 재시작 | 작업 복구, 제공자 작업 ID 있으면 재제출 없음 |
| V7 | 취소 후 늦은 결과 | 저장되지만 자동 선택 안 됨 |
| V8 | 저장소 쓰기 실패 | `STORAGE_FAILED`로 표시, 성공 표시 없음 |
| V9 | 검수 후 내용 변경 | 검수·내보내기 자격 무효 |
| V10 | 누락 파일·잘못된 경로·디스크 오류 | 오류 표시 |
| V11 | 실제 ZIP 풀기 | manifest 전 파일 존재·해시 일치, 절대경로·비밀 없음 |
| V12 | 백업을 격리된 새 위치로 복원 | 참조 전부 유효 |
| V13 | 1280/390px 화면 | 탐색·입력·오류·키보드·확인 창 포커스 정상 |

---

## 20. 작업 절차

### 20.1 코더 ↔ 검수 담당 ↔ 플래너

1. 코더는 세션 시작 시 `CLAUDE.md` → `PLAN.md` → `REVIEW.md`의 열린 필수 수정 순으로 읽는다.
2. 다음 마일스톤 하나만. 범위 밖 작업 금지.
3. 기준과 다르게 해야 하면 `QUESTIONS.md`에 적고 그 부분만 멈춘다.
4. 끝나면 `PROGRESS.md`: **마일스톤 ID / 바꾼 파일 / 실행 방법 / 실제 검증 결과 / 남은 문제**. 그리고 멈춘다.
5. 검수 담당(Codex)이 검수하고 `REVIEW.md`: **검수한 파일·커밋 / 재현 절차 / 기대·실제 / 필수 수정·권장**.
6. 코더는 수정 위치와 재확인 증거로 답한다. 필수 수정이 모두 닫히면 다음 마일스톤.
7. 검수 중 기준 문서·디자인이 틀렸거나 모호하면 검수 담당은 REVIEW에 **"플래너 확인 필요"**로 표시하고 `QUESTIONS.md`에 적는다. 플래너가 PLAN·DESIGN·menus.json을 고치거나 답한다. 검수 담당과 코더는 이 기준 문서들을 직접 고치지 않는다.
8. 플래너는 새 기준·디자인을 내면 `REVIEW.md`에 "기준 변경 알림"만 남긴다(판정은 하지 않음).

**연속 진행 방식 (2026-11-15 은영님 직접 지시, 현재 적용)**
- 구현 담당은 마일스톤마다 멈추지 않는다. 구현 → 검증 → 자체 검수 기록 → 다음 마일스톤으로 이어 간다. 위 4~6번의 "멈춘다"·"검수 통과 전 다음 금지"는 이 방식에서는 적용하지 않는다.
- 자체 검수는 REVIEW에 "자체 검수(독립 검수 아님)"으로 적고, 20.2 완료의 정의와 20.3 확인 항목을 그대로 따른다.
- 질문은 은영님의 결정이 꼭 필요한 것만 한다. 기준과 다르게 처리한 작은 사항은 `QUESTIONS.md`에 적고 진행하며, 플래너가 나중에 답한다.
- R1~R10(불변 원칙)에 걸리는 것은 작은 사항으로 보지 않는다. 그 부분만 멈추고 질문한다.
- P1 종료 판정은 18장 표 그대로다(검수 담당 흐름 검수 + 은영님 확인).

### 20.2 완료의 정의
- build · lint · typecheck · test 통과
- 새 도메인 규칙·서비스에 테스트 추가
- 완료 기준을 코더가 직접 실행해 확인하고 방법을 PROGRESS에 기록
- R1~R10 위반 없음
- 화면이 있으면 1280·390px 확인

### 20.3 검수 담당 검수

| 확인 | 방법 | 기준 |
|---|---|---|
| 빌드·코드 | build·lint·typecheck·test | 오류 0 |
| 화면 | 실제 브라우저 클릭, 1280·390px 스크린샷, 시안 대조 | 가로 스크롤·잘림 없음 |
| 디자인 | `DESIGN.md` 10장 완료 기준, 토큰 외 색상 코드 검색 | 기준 전부 충족 |
| 흐름 | 샘플 프로젝트 직접 진행 | 막힘 없음, 실패가 실패로 보임 |
| 파일 | ZIP 풀어 존재·재생·해상도·해시 | 일치 |
| 원칙 | R1~R10 | 위반 0 |

### 20.4 기타
- 커밋은 마일스톤 단위, 메시지 `P1-4: 자료 보관함 업로드·미리보기`.
- 새 의존성은 PROGRESS에 이유 기록. 유지보수 중단·라이선스 불명 패키지 금지.
- 화면 문구는 한국어, 사용자 관점("작업 대기열", "다시 만들기"). 개발 용어 노출 금지.

---

## 21. 하지 말 것 (P0~P6)

로그인·회원가입(P7 전) · 결제 · 자동 게시·출품·제출 · 세금·법률·의료 판단 · 실제 개인정보 · 원본 덮어쓰기 · 확인 없는 삭제 · 분야별 화면 복붙 · 공모전·쇼핑 사이트 대량 크롤링 · CapCut 프로젝트 파일 직접 생성 · Sora·Midjourney 연결 · mock 결과를 완성품으로 표시

---

## 22. 위험

| 항목 | 위험 | 대응 |
|---|---|---|
| 캐릭터 일관성 | 참조로도 얼굴이 흔들림 | 기준시트 + 샷별 재생성 + 사람 검수 |
| 모델 종료·가격 변동 | 월 단위 변동 | 설정값화, 연결 직전 재확인 |
| 실사 얼굴 거절 | 제공사 정책 | 사유 표시, 가상 캐릭터 기본 |
| 음악 권리 | Suno 다운로드 한도·플랜 | 곡별 권리 기록 필수 |
| 가상인물 표기 개정 | 원문 미확인 | P5 전 공정위 원문 확인 |
| Remotion 라이선스 | 4인 이상 유료 | P7 전 인원 확인 |
| 로컬 유실 | PC 고장 | 외부 백업 위치 |
| 박대리 방식 | 원본 없음 | 원본 전 특징 생성 금지 |
| 외부 서비스 정보 | 일부 2차 자료 | 연결 전 공식 URL·날짜 기록 (8.4) |

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|---|---|---|
| v1.0 | 2026-11-15 | 초안 (M1~M6) |
| v2.0 | 2026-11-15 | 기획서 전체 분석 + 외부 조사 반영 상세판 (플래너) |
| v2.1 | 2026-11-15 | 구현 담당 검토 8장 추가: 게이트 서버 강제, 템플릿 스냅샷, content_revision, 단일 선택 기준, 큐 중복·복구·취소, 결정적 mock, 파일·내보내기·백업 강화, 비용 정산 |
| v2.2 | 2026-11-15 | v2.0 상세판과 v2.1 검토를 하나로 통합. 메뉴 16+2 확정과 기획서 대조표(6.2), 검증 증거 목록(19장) 추가. 이 판부터 8장 부록 없이 본문에 반영 |
| v2.4 | 2026-11-15 | 20.1에 연속 진행 방식 추가(은영님 직접 지시): 마일스톤마다 자체 검수 기록 후 계속 진행, 작은 질문은 사후 답변 |
| v2.4 보완 | 2026-11-15 | 7.2에 P1 정적 글자 설정 저장 위치 명시(T-002, Codex 요청) |
| v2.3 | 2026-11-15 | 역할 변경(은영님 지정): 검수·테스트는 검수 담당(Codex), 플래너는 플랜·디자인. 20.1에 기준 문서 이의 절차(7·8번), 20.3에 디자인 대조 추가. P0-1 디자인 산출물 완료 |
