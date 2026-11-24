# 관리자 콘텐츠 분석·공개 화면 (Front)

2026-11-20 · Codex(Front) · Master 배정 `msg_dc8df647b185`, 계약 `msg_7cec5abd4fdc`·`msg_6208bcc8c986`

## 고정 SHA

| SHA | 내용 |
|---|---|
| `418e36f` | 관리자 화면, 공개 결과 화면, 공개 홈 메뉴 링크, 단위·브라우저 시험 |
| `dcffade` | 분석 중 초점을 ‘분석 취소’로 옮김 |
| `1ce1c09` | 공개 결과 화면 브라우저 시험 |

- 서버 경로, 저장, 공용 proxy는 Master 점유다(후보 `29ca376`).
- `app/analysis-results/page.tsx`는 서버 함수 `listPublishedReferenceAnalyses`를 import해서 Front 커밋에는 넣지 않았다(당시 후보 `29ca376`에 있었다는 이력). 최종 배포본 `2d199a7`에도 들어 있다.
- **운영 반영:** 2026-11-20 `2d199a7`이 원격 master에 반영됐다(e4fa378→2d199a7). Vercel 운영 배포 성공. 운영에서 확인한 것: 홈 200(‘분석 결과’ 링크 있음), `/analysis-results` 200·no-store(공개 0건 안내), 비로그인 관리자 분석·공개 API GET·POST·DELETE 모두 401.

## 화면 계약 (`components/admin/admin-reference-analysis-model.ts`)

> 공개 관리 경로는 `2d199a7`에서 `/api/admin/reference-publications`로 분리됐다(Master). 분석 경로의 빌드 추적이 공개 관리 경로까지 번지지 않게 하려는 조치다. 이전 하위 경로 `/api/admin/reference-analysis/publications`는 쓰지 않는다.

| 요청 | 보내는 것 | 받는 것 |
|---|---|---|
| `POST /api/admin/reference-analysis` | `{url, authorized:true}` | 200 `{result: StudioAnalysisResult}` (strict, 여분 필드가 있으면 실패) |
| `GET /api/admin/reference-publications` | — | 200 `{items}` |
| `POST /api/admin/reference-publications` | `{id, title, summary, prompt, media, authorized:true}` | 200 `{item}` (`item.id`가 보낸 `id`와 같아야 함) |
| `DELETE /api/admin/reference-publications` | `{id}` | 200 `{ok:true}` (이미 철회돼 있어도 ok) |

- **401·403:** 본문 없이 상태 코드로 판정한다. 받으면 모든 조작을 멈추고 로그인·권한 안내만 남긴다.
- **400·404·409·422:** 본문의 `error` 코드만 읽는다. 서버 문장은 쓰지 않고, 화면이 코드별 한국어 문구를 만든다.
- **그 밖의 응답과 형식 오류:** 일시 실패로 보여 준다.
- **길이 한도:** 제목 80자, 요약 600자, 프롬프트 2000자. 화면과 서버가 같은 한도로 검사한다.

## 화면 동작

| 화면 | 동작 |
|---|---|
| `/admin#admin-reference-analysis` | 지원 원본·형식 안내 → URL 입력 → 권리 확인 → 분석 실행(분석 중 초점은 ‘분석 취소’) → 결과 제목에 초점 → 결과·근거·생성 프롬프트 |
| 공개 준비 | 결과 고르기 → 제목·요약·프롬프트 수정 → 권리·공개 동의 → 공개 |
| 철회 | 공개 철회 → 확인 → 목록 다시 읽기 → ‘철회됨’ |
| `/analysis-results` | 승인 필드(제목·요약·생성 프롬프트·매체·공개 시각)만 평문으로 보여 준다. 빈 목록과 장애는 각각 안내 문구로 보여 준다. |
| 공개 홈 | 주 메뉴 마지막 링크 ‘분석 결과’ → `/analysis-results` |

공개 동작의 세부 규칙:
- **요청 id:** 공개 응답이 오지 않으면 같은 요청 id로 다시 보낸다. 초안을 고치거나 서버가 요청을 거절하면 새 id를 만든다.
- **늦은 응답:** 분석·목록의 늦은 응답은 순번 검사와 취소로 버린다.

## 시험

### 단위 시험 · `tests/admin/admin-reference-analysis.test.ts` (10건)

- 3종 분석 결과를 받는다.
- 상태 코드와 오류 코드를 화면 분류로 옮긴다.
- 형식이 엄격하게 맞을 때만 받는다.
- 취소된 뒤 성공한 응답은 실패로 닫는다.
- 공개 요청 본문이 계약과 같고, 응답 id가 다르면 실패로 본다.
- 목록과 철회가 계약대로 동작한다.
- 초안 생성과 길이 검사가 맞다.
- 첫 화면과 공개 결과 화면을 정적으로 그려 확인한다.

### 브라우저 시험 (390·1440)

| 시험 | 실행 | 확인한 것 |
|---|---|---|
| 관리자 화면 | `node tests/admin/admin-reference-analysis-run.mjs` → `admin-reference-analysis.ego.mjs` | 키보드 분석, 공개 실패 뒤 같은 id로 다시 보내기, 철회, 이미지·영상, 401로 멈춤, 가로 넘침 0 |
| 공개 결과 화면 | `node tests/admin/published-analysis-results-run.mjs` → `published-analysis-results.ego.mjs` | 3종, HTML을 해석하지 않음, 빈 목록, 장애 안내, 긴 글, 가로 넘침 0 |

- 두 브라우저 시험 모두 서버 DB 없이 합성 응답만 쓴다.
- 이번 변경에 맞춰 함께 고친 기존 시험이 있다.
  - `tests/admin/admin-hub-information-architecture.test.ts`: 관리 메뉴에 새 구역을 반영했다. `29ca376`에는 이 수정이 없어 이 시험이 실패한다.
  - `tests/public-showcase/neon-showcase.test.ts`: 메뉴 링크 1건을 확인한다.

## 남은 것

- **Preview 빌드 실패 (`29ca376`):** 로그를 읽으려던 시도가 거절됐다. 원인은 아직 확인하지 못했다.
- **실제 운영 확인:** 음악·영상은 Linux FFmpeg가 필요하다. 실제 Supabase 저장과 함께 운영에서 아직 확인하지 않았다.
- **보호 콘텐츠 분석 제품 마운트 (`/cloud/reference-analysis`):** 지금은 ‘준비 중’ 안내만 보여 준다. 운영 목록과 분석 공급원(Backend)이 아직 조립되지 않아 막혀 있다.

## 후보 조립 대조 (HEAD 대비 `8bff2e0`, blob 앞 10자리)

| 파일 | Front 최신 | 8bff2e0 | 넣을 것 |
|---|---|---|---|
| `components/admin/admin-reference-analysis-model.ts` | `d5b8004c16` | `d496123b1c` | Front 최신(`cb11d62`: 409·413·429 코드) |
| `components/admin/admin-reference-analysis.tsx` | `6bfa7665f4` | `95771ee6f5` | Front 최신(`dcffade` 초점, `cb11d62` 충돌 처리) |
| `components/reference-analysis/published-analysis-results.tsx` | `5dd3e5b2f8` | `4197bbbb72` | Front 최신(`00dba9f` 홈 링크를 일반 a로) |
| `tests/admin/admin-reference-analysis.test.ts` | `5e54b3b14a` | `e1e43729f7` | Front 최신 |
| `admin-reference-analysis.module.css`, `admin-hub.tsx`, `admin-navigation.tsx`, `admin.module.css`, `published-analysis-results.module.css`, `tests/admin/admin-hub-information-architecture.test.ts` | 같음 | 같음 | 그대로 |
| `components/public-showcase/neon-showcase.tsx`, `tests/public-showcase/neon-showcase.test.ts` | master 최신 | `e4fa378` 기반 | 후보에는 이미 ‘분석 결과’ 링크 1줄과 시험이 있다. master 쪽 다른 변경은 섞지 않는다 |

`8bff2e0`에는 `tests/public-showcase/home-navigation.test.ts`가 없다. 그래도 `00dba9f`의 규칙(공개 홈 링크는 일반 a)은 같이 넣는다.
