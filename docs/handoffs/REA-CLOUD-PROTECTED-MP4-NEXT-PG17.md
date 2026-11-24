# 실제 Next 보호 셸 · 등록 MP4 격리 빌드(PG17)

2026-11-20 · Codex(Front) · Master 배정 `msg_239e0752be57`

## 범위

- **무엇을 했나:** 실제 Next 보호 셸(`/cloud/reference-analysis`)의 격리 production 빌드에 `c07ebbe` 등록 MP4 시험 공급원을 연결했다.
- **사용한 근거:**
  - 셸: T317 셸 그대로
  - 목록 GET: `7514ad0`
  - 화면: 보호 목록 어댑터 `09735c9`·`87707c5`·`eb0e07b`
- **계정 판정:** A·B를 전역 전환으로 바꾸지 않는다. 각 요청의 실제 로그인 세션으로 판정한다. 같은 Next를 두 주소로 열어 쿠키를 나눴다.
  - A: `127.0.0.1:3488`
  - B: `localhost:3488`
- **바꾸지 않은 것:**
  - 제품 마운트, 운영 설정과 배포
  - 고정 최소 후보 `1341083f`, PNG·MP4 고정 시험
- **오버레이:** 격리 빌드 사본에만 덮었고 저장소에는 없다.

## 구성

| 구성 | 위치 | 내용 |
|---|---|---|
| PG17 공급원 | 저장소 `tests/reference-analysis/studio-protected-video-next.pg17.ts` | 소유 PG17.12, 합성 비공개 저장소, 제어 서버. 실행기 `studio-analysis-authority-store.pg17.mjs`의 `STUDIO_ANALYSIS_VERIFY_NEXT=1` 갈래가 부른다. 시드·MP4는 `c07ebbe`와 같다. |
| 연결 설정 파일 | `STUDIO_ANALYSIS_NEXT_CONFIG` (저장소 밖 절대 경로) | 실행기가 쓰고 끝날 때 지운다. 합성 연결 값만 들어 있다. |
| Next 오버레이 | `D:/starwork/rea-next-mp4/overlay/` | 파일 5개. 아래에 따로 정리했다. |
| 합성 인증 | `D:/starwork/rea-next-mp4/harness/fake-auth-ab.mjs` | 루프백 3489. 계정 `a@example.invalid`·`b@example.invalid`, 비밀번호 `synthetic-password-only`. 사용자 ID는 실행기의 ownerA·ownerB와 같다. |
| 브라우저 조작 | `D:/starwork/rea-next-mp4/harness/round-next.mjs` | ego 스크립트. A·B 두 페이지를 쓰고, 폭 390·1440에서 판정한 뒤 제어 서버 `/done`에 보고한다. |
| 빌드본 | `D:/starwork/rea-next-mp4/build/cand` | `d5d426f` git archive에 오버레이를 덮은 사본. `next build --webpack`, BUILD_ID `wDFLAhdzcZKWJumi59P7J`. |
| 근거 | `D:/starwork/rea-next-mp4/evidence/` | 판정 JSON, 빌드·서버·실행기 기록, `SHA256SUMS.txt` |

**Next 오버레이 파일 5개**

- 보호 목록 GET 경로: `app/api/studio/reference-analysis/materials/route.ts`
- 분석 POST 경로: `app/api/studio/reference-analysis/route.ts`
- 요청 수 확인용 경로: `app/api/t-harness/state/route.ts`
- 연결 모듈: `lib/t-harness/next-video-connection.ts`. 설정 파일로 `createIsolatedStudioAnalysisConnection`을 만든다. `resolveAuth`는 요청마다 `resolveServerAuth()`를 부른다.
- 셸 컴포넌트: `components/reference-analysis/studio-registered-analysis-page.tsx`. 셸에 `StudioProtectedMaterialsAnalysis`를 같은 오리진 경로로 마운트한다.

**오버레이 해시:** 목록 파일 `D:/starwork/rea-next-mp4/overlay-SHA256SUMS.txt`의 sha256은 `f9f30ee4103c649a0227e24ab443630ba6a7726c45b8d5c0d2e06e5f06bf609b`다. 목록에는 오버레이 5개와 harness 2개가 있다.

| 파일 | sha256 |
|---|---|
| `overlay/app/api/studio/reference-analysis/materials/route.ts` | `139ade77…f81` |
| `overlay/app/api/studio/reference-analysis/route.ts` | `1c4ea6e9…e220` |
| `overlay/app/api/t-harness/state/route.ts` | `06c71b21…e516` |
| `overlay/components/reference-analysis/studio-registered-analysis-page.tsx` | `8972a81f…6ec6` |
| `overlay/lib/t-harness/next-video-connection.ts` | `626651da…f788` |
| `harness/fake-auth-ab.mjs` | `22c3a33e…ac8b` |
| `harness/round-next.mjs` | `5be1441e…c3ff` |

전체 값은 목록 파일에 있다.

## 실행

```powershell
# 1. 합성 인증
node D:/starwork/rea-next-mp4/harness/fake-auth-ab.mjs 3489
# 2. PG17 공급원(저장소에서). "NEXT-FIXTURE-READY control=http://127.0.0.1:<제어 포트> …"를 기다린다
$env:STUDIO_ANALYSIS_NEXT_CONFIG='D:\starwork\rea-next-mp4\run\config.json'; $env:STUDIO_ANALYSIS_VERIFY_NEXT='1'
node --conditions=react-server --import tsx tests/reference-analysis/studio-analysis-authority-store.pg17.mjs
# 3. Next 빌드본(공급원 준비 뒤에 띄운다: 첫 요청 때 설정 파일을 읽는다)
cd D:/starwork/rea-next-mp4/build/cand
$env:DREAM_AUTH_MODE='supabase'; $env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:3489'; $env:NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-anon-key'
$env:DREAM_ALLOWED_EMAILS='a@example.invalid,b@example.invalid'; $env:STUDIO_ANALYSIS_NEXT_CONFIG='D:\starwork\rea-next-mp4\run\config.json'; $env:NODE_ENV='production'
node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3488
# 4. 브라우저 조작
ego-browser nodejs -e 'globalThis.NEXT_PORT = 3488; globalThis.CONTROL = "http://127.0.0.1:<제어 포트>"; await import("file:///D:/starwork/rea-next-mp4/harness/round-next.mjs")'
```

**실행 후 동작**

- 조작이 보고를 보내면 실행기가 판정한다. 판정이 `pass`면 통과 줄을 쓴다.
- 이어서 PG17·리스너·임시 클러스터와 설정 파일을 정리하고 exit 0으로 끝난다.
- 판정이 실패여도 정리는 한다. 이때는 exit 1이다.
- Next와 합성 인증은 직접 끈다. 공급원을 다시 띄울 때는 Next도 다시 띄운다. 연결이 Next 프로세스 안에 캐시되기 때문이다.

**합성 로그인과 철회 사용법**

- **로그인:** `/login?next=%2Fcloud%2Freference-analysis`에서 위 합성 계정으로 로그인한다.
- **철회와 복원:** 제어 서버에 아래 요청을 보낸다. 실제 PG 자료 승인이 바뀐다.
  - `POST <제어>/revoke-a`, `/restore-a`
  - `POST <제어>/revoke-b`, `/restore-b`
- **다운로드 수:** `GET <제어>/state`에서 계정별로 본다.
- **Next 요청 수:** 로그인 세션으로 `GET /api/t-harness/state`를 부르면 목록 GET·프리페치 204·POST·`ready`·`source_unavailable` 수가 나온다.

## 결과

마지막 실행에서 판정 `pass`, 실패 0, 실행기 exit 0이었다. 근거는 `evidence/round-next-report.json`이다.

**처음 HTML·Flight·사전 요청 4종 (실제 Next, 로그인 A)**

| 요청 | 상태 | 형식 | 본문 글자 수 |
|---|---|---|---|
| HTML | 200 | `text/html` | 9,912자 |
| Flight (`RSC: 1`) | 200 | `text/x-component` | 4,912자 |
| 라우터 프리페치 | 200 | — | 324자 |
| 세그먼트 프리페치(`/_tree`) | 200 | — | 324자 |

본문 크기는 ego `page.fetch` 응답 본문의 글자 수(문자열 길이)다. 실제 전송 바이트는 측정하지 않았다.

- 네 응답 모두 소유자·프로젝트·자료 ID와 서버 이름(‘등록 영상 · …’)이 0이었다.
- 같은 오리진 목록 GET에 `RSC: 1`이나 `Next-Router-Prefetch`를 붙이면 204 빈 응답이다(2회).
- 이 사전 요청 6개가 목록 조회를 시작한 횟수는 0이다.
- `Sec-Purpose`는 브라우저 fetch에서 직접 붙일 수 없는 헤더라 이번 범위에서 빠졌다. `c07ebbe`·`7514ad0`에서 확인했다.

**익명 접근**

- 셸은 307로 `/login?next=%2Fcloud%2Freference-analysis`에 보낸다.
- 목록 GET은 401이고 자료 정보가 없다.

**요청별 세션(동시)**

- A 세션의 목록 GET은 A 자료 1개만, B 세션은 B 자료 1개만 받았다.
- A 승인을 철회한 동안에도 B 목록은 그대로였다.

**폭 390·1440, A·B 각각**

| 확인 | 결과 |
|---|---|
| 첫 진입 | BODY. 초점을 가져가지 않는다. |
| Tab 순서 | 자료 선택 → 체크 → 실행 |
| 확인 전 | 꺼진 실행을 강제로 눌러도 POST 0, 다운로드 0 |
| 확인 후 | POST 1, `ready` 1, 자기 객체 다운로드 1. 초점은 ‘분석 결과’ |
| 결과 | `결과 1 · 0 ms` / `결과 2 · 1000 ms` / `결과 3 · 1000 ms · 장면 전환 후보`. 원본 프레임 시각은 0·1000·1000이고, 장면 전환 근거는 967–1000 ms다. |
| 결과 배치 | 390px에서 아래, 1440px에서 옆 |

**B 새 화면:** 아무것도 고르지 않았고, 체크는 꺼져 있고, 초안이 없다.

**교차 POST:** A 세션이 B 자료 ID로, B 세션이 A 자료 ID로 보냈다. 둘 다 `source_unavailable`이었고 다운로드는 0이었다.

**A 승인 철회 뒤 ‘다시 분석’**

- `source_unavailable` 1건이었고 다운로드는 0이었다.
- 선택, 체크, 결과, 초안이 사라졌다.
- 초점은 ‘분석할 수 있는 등록 자료가 없어요’ 안내로 갔다.

**가로 넘침 (scrollWidth / clientWidth / 차이)**

| 폭 | 상태 | A | B |
|---|---|---|---|
| 390 | 성공 결과 | 390 / 390 / 0 | 390 / 390 / 0 |
| 390 | 철회 빈 화면 | 390 / 390 / 0 | — |
| 1440 | 성공 결과 | 1425 / 1425 / 0 | 1425 / 1425 / 0 |
| 1440 | 철회 빈 화면 | 1440 / 1440 / 0 | — |

1440의 clientWidth가 1425인 것은 세로 스크롤 막대 때문이다.

**저장소 다운로드 합계:** 4 (A 2, B 2). 분석 작업 폴더는 비었다.

**앞선 두 번의 실패 실행** (보완했다)

1. 두 번째 탭을 여는 API를 잘못 썼다. `task.newPage()`로 고쳤다.
2. 로그인 직후 화면이 스스로 목록을 받는 요청이 사전 요청 세기와 겹쳤다. 화면의 목록 로드가 끝난 뒤부터 세도록 고쳤다.

두 번 모두 실행기는 정리 후 exit 1이었다.

## 구분과 남은 것

- **실제 Next로 확인한 것:** 실제 Next 셸·Flight·프리페치, 같은 오리진 경로, 실제 로그인 세션 판정이다.
- **오버레이가 대신한 것:** 목록·분석 경로와 셸 마운트다. 제품 원본은 여전히 미연결 셸이고 분석 POST는 503이다.
- **운영 연결 조건(T323):** 송신 호스트, TLS, 원장, 승인 공급원이 필요하다. 이번 범위 밖이다.
