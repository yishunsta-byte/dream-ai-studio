# T317 · 클라우드 분석 페이지 보호 데이터 분리 (T316 단계 1)

- 배정: Master `msg_7df7ba77f9cf` (T316 `fced9f9` 단계 1 채택)
- 담당: Codex(Front)
- 바꾼 파일:
  - `app/(cloud)/cloud/reference-analysis/page.tsx`
  - `components/reference-analysis/studio-registered-analysis-page.tsx`
  - `tests/reference-analysis/studio-registered-analysis-page.test.ts`
  - 이 문서

## 바꾸기 전 상태

- 페이지 서버 렌더가 `loadStudioRegisteredAnalysisPage`로 등록 자료 목록(`label`·`projectId`·`assetId`)을 읽었어요.
- 그 목록을 클라이언트 컴포넌트 props로 넘겼어요. 그래서 연결이 켜지면 목록이 초기 HTML과 인라인 RSC·Flight에 실렸어요.
- 운영 연결(`studioAnalysisConnection`)은 지금 `undefined`라서 실제로는 '연결되지 않음' 상태였어요.
- 인증 처리:
  - 401 → `/login?next=…`
  - 403 → `/login?error=forbidden`
  - 503·판별 예외 → `/login?error=unavailable`
  - 로컬 → `CloudReadLocal`

## 바뀐 동작

- **페이지는 인증·로컬 판정만 해요**(`getRenderAuth`). 목록 로더와 연결을 import하지도, 호출하지도 않아요. 401·403·503·예외·로컬 처리는 그대로예요.
- **셸 컴포넌트는 props가 없어요.** `StudioRegisteredAnalysisPage()`는 `StudioRegisteredAnalysis`를 공급자 없이 그려요. 화면에는 '등록 자료 분석 공급자가 아직 연결되지 않았어요.' 안내와 비활성 '분석 실행'만 나와요.
- 클라이언트가 목록을 따로 요청하는 경로는 아직 없어요. 새 API를 열지 않으려고, 연결 여부와 상관없이 닫힌 셸만 보내요(fail closed). 브라우저에서 새 요청도 만들지 않아요.
- **바꾸지 않은 것:**
  - `lib/reference-analysis/*`: 로더·연결·분석 POST
  - DB 계약, 활성화 플래그
  - `StudioRegisteredAnalysisPageProps` 타입: lib 로더 반환 형식이라 타입만 남겼어요

## 검증

**단위 시험** `npx vitest run tests/reference-analysis/studio-registered-analysis-page.test.ts`: 7/7 통과.
- 신규: 합성 표식을 돌려주는 연결을 모듈 대체로 켜 두고 확인 페이지를 그렸어요.
  - 목록 호출 0회
  - 표식·라벨·ID·경로·사용자 ID 미포함
  - 비활성 실행 버튼
  - 인증 예외 → `/login?error=unavailable`, 호출 0회
  - 셸 props `{}`
- 기존: 401·403·503 리다이렉트, 로컬·미연결 화면, 로더 계약 시험은 유지했어요.

**전체 묶음:**
- `npx vitest run tests/reference-analysis`: 파일 20 통과·5 건너뜀, 시험 214 통과·64 건너뜀
- `tsc` 오류 0
- 바꾼 3개 파일 ESLint 통과

**격리 운영 빌드:**
- 준비:
  - HEAD `fced9f9`를 `git archive`로 임시 폴더에 풀고, 바꾼 2개 파일을 덮었어요.
  - `node_modules`는 복사본이에요. 정션은 쓰지 않았어요.
- 사본 전용 패치(커밋 안 함):
  - 인증은 쿠키 `t317-auth` = verified·local·401·403·503·throw 로 정했어요.
  - 연결은 합성 표식 행(`T317-SYNTHETIC-PRIVATE-MARKER`, 합성 ID 2개)을 돌려주고, 호출할 때마다 파일에 기록해요. 즉 **연결이 켜진 상태**로 시험했어요.
- `npm run build` 뒤 `next start -H 127.0.0.1 -p 3317`로 실행했어요.

| 요청 | 결과 | 표식·ID |
|---|---|---|
| 확인 사용자 HTML | 200, 셸 안내 있음 | 없음 |
| 확인 사용자 Flight (`RSC: 1`, `_rsc` 307 따라감) | 200 `text/x-component` 5,003B, 셸 컴포넌트 참조 있음, `materials` 문자열 없음 | 없음 |
| 프리페치 Flight (`Next-Router-Prefetch`) | 200, 324B | 없음 |
| 세그먼트 프리페치 (`/_tree`) | 200, 324B | 없음 |
| 로컬 HTML | 200, '이 PC에서는 기존 작업실을 써요' | 없음 |
| 401 / 403 / 503 HTML | 307 → `/login?next=%2Fcloud%2Freference-analysis` / `?error=forbidden` / `?error=unavailable` | 없음 |
| 401 Flight | 200, Flight 안에 `NEXT_REDIRECT;replace;/login?next=…;307` | 없음 |
| `.next/static` 37개 파일 | — | 0개 |
| 미리 만든 HTML | 없음(동적 페이지) | — |
| **목록 함수 호출 수** | **모든 요청 뒤 0** | — |

- 정리: 서버를 멈췄어요. 임시 사본은 재분석 지점을 먼저 지우고 폴더째 삭제했어요(없음 확인). 3317 포트 대기 0, 저장소 `node_modules` 항목 283개 그대로예요.

## 발견 사항 (범위 밖, 바꾸지 않음)

1. **계정 이메일 노출:** 확인 사용자 HTML·Flight에 그 사용자 본인의 이메일(합성 `owner@example.invalid`)이 나와요. 원인은 `app/(cloud)/layout.tsx`의 계정 표시(`currentAccountEmail`)예요. 이 페이지가 넣은 것이 아니고 클라우드 화면 전체의 기존 동작이에요. T316 단계 1의 '개인 props 없음' 기준을 레이아웃까지 넓힐지는 Master 판단이 필요해요.
2. **인증 판별 예외 시 500:** 인증 판별이 예외를 던지면 페이지 대신 레이아웃의 `currentAccountEmail`이 먼저 실패해서 500이 돼요. 합성 throw로 확인했어요. 응답에 표식·내부 메시지는 없었어요. 페이지 자체는 예외를 `/login?error=unavailable`로 바꾸고, 이 동작은 단위 시험으로 확인했어요. 실제 `resolveServerAuth`는 내부에서 오류를 503 결과로 바꾸므로 운영에서 이 경로가 나오는 일은 드물 거예요.

## 남은 일 (단계 1-2 이후)

- 클라이언트 목록 조회 경로: 로그인 세션, `no-store`, 이동·로그아웃·계정 교체·bfcache 정리가 필요해요. 새 경로 추가라서 별도 배정과 충돌 조정이 필요해요.
- 앱 분석 POST의 '연결 불가' 고정은 기존 연결 `undefined` 상태로 유지돼요. 이번에 바꾸지 않았어요.
- 브라우저 화면 실측(뒤로 가기·bfcache)은 목록 경로가 생긴 뒤 하는 것이 의미가 있어요. 이번에는 ego 브라우저를 쓰지 않았어요.
