# 클라우드 분석 보호 목록 · 등록 PNG 격리 브라우저 통합

2026-11-20 · Codex(Front) · Master 배정 `msg_42aaf65b3886`

## 범위

- **기준:**
  - 화면: `87707c5`(권리 확인)와 `eb0e07b`(재조회 초점)
  - 보호 목록 GET: `7514ad0`
  - 등록 이미지 분석 연결: `f90c374`
- **흐름:** 브라우저 → 보호 목록 GET → 자료별 사용 권리 확인 → 등록 PNG 분석 POST → 실제 이미지 결과 → 승인 철회 → 결과와 목록 정리
- **실행 환경:** 기존 작업 폴더의 소유 루프백만 쓴다.
  - PG17.12 클러스터, 합성 비공개 저장소, 시험 서버
  - 합성 인증(소유자 A 고정)
- **바꾸지 않은 것:** 운영 설정과 서비스 연결, 고정 후보 `1341083f`, 제품 코드, API 계약
- **범위 밖:** 영상과 음악

## 바꾼 시험 경로

| 경로 | 내용 |
|---|---|
| `tests/reference-analysis/studio-analysis-authority-store.pg17.mjs` | `STUDIO_ANALYSIS_VERIFY_BROWSER=1` 갈래를 추가했다. 기존 시드와 권한 함수로 아래 검증을 부른다. 기존 두 갈래는 그대로다. |
| `tests/reference-analysis/studio-protected-materials-browser.pg17.ts` | 검증 본체 |
| `tests/reference-analysis/studio-protected-materials-browser.tsx` | 브라우저 진입점. `StudioProtectedMaterialsAnalysis`를 그대로 묶는다. |
| `tests/reference-analysis/studio-protected-materials-browser.ego.mjs` | ego 브라우저 조작 스크립트(390·1440) |

**검증 본체가 하는 일**

- 기존 `createIsolatedStudioAnalysisConnection`의 `getMaterials`와 분석 POST를 루프백 HTTP로 노출한다.
- esbuild로 화면을 묶는다. `next/link`만 일반 링크로 바꿨다.
- 처음 HTML과 프리페치를 검사한다.
- 브라우저 조작을 기다린 뒤, 서버 쪽 숫자와 브라우저 보고를 판정한다.

## 실행

```powershell
$env:STUDIO_ANALYSIS_VERIFY_BROWSER='1'
node --conditions=react-server --import tsx tests/reference-analysis/studio-analysis-authority-store.pg17.mjs
# 출력의 "BROWSER-FIXTURE-READY http://127.0.0.1:<포트>"를 확인한 뒤 다른 창에서:
ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "http://127.0.0.1:<포트>"; await import("file:///<저장소>/tests/reference-analysis/studio-protected-materials-browser.ego.mjs")'
Remove-Item Env:STUDIO_ANALYSIS_VERIFY_BROWSER
```

- 조작 스크립트는 끝나면 `/__fixture/done`에 보고를 보낸다. 그러면 실행기가 판정하고 PG17·리스너·임시 클러스터를 정리한다.
- 10분 안에 보고가 없으면 실패로 끝난다.

## 완료 조건과 결과

같은 명령으로 세 번 실행했고, 마지막 실행은 저장소의 조작 스크립트를 그대로 썼다. 세 번 모두 통과했다.

| 조건 | 결과 |
|---|---|
| 처음 HTML·RSC에 보호 메타데이터가 없다 | 처음 HTML에 프로젝트·자료 ID, 소유자 ID, 서버 이름(‘등록 이미지 · …’)이 없다. 목록 GET에 `RSC: 1`, `Next-Router-Prefetch`, `Sec-Purpose: prefetch`를 붙이면 204 빈 응답이다(3회, 인증·목록 호출 없음). 화면이 그린 DOM에도 ID와 서버 이름이 0개다. |
| 체크 전 POST 0 | 폭마다 자료를 고르고 꺼진 실행 버튼을 강제로 눌렀다. 분석 POST 증가는 0이었다(390 이전 0→0, 1440 이전 2→2). |
| 승인 결과 1건 | 폭마다 Space로 확인, Tab, Enter를 눌렀다. POST 1회, 자료 다운로드 1회, 결과 `ready`. 결과 제목 ‘분석 결과’에 초점이 갔다. 화면에 관찰 근거·분석 추정·창작 초안이 나오고, 빨간 PNG 색 `#e02020`이 보였다. 응답에 원본 해시는 없었다. |
| 승인 철회 뒤 결과·목록 정리 | 실제 PG 권한을 철회한 뒤 ‘다시 분석’을 눌렀다. 서버는 `source_unavailable`을 돌려줬고 자료 다운로드는 늘지 않았다. 화면이 목록을 다시 받아 빈 목록이 되었다. 선택, 체크, 결과, 초안이 모두 사라지고, 초점은 ‘분석할 수 있는 등록 자료가 없어요’ 안내에 갔다. |
| 390·1440 초점과 배치 | 첫 진입에서 초점을 가져가지 않았다(BODY). 자료 선택 다음 Tab은 체크 칸이다. 결과는 390px에서 입력 카드 아래, 1440px에서 옆에 놓였다. 가로 넘침은 0이다. |

**서버 합계 (두 폭)**

- 목록 GET 4, 프리페치 204 3
- 분석 POST 4: `ready` 2, `source_unavailable` 2
- 저장소 다운로드 2
- 분석 작업 폴더는 비었다.

**정적 검사:** tsc와 eslint 오류 0. 위 실행 직전 전체 vitest는 3,130건 통과했다.

## 독립 검수(PG Tester)

위 명령을 Tester 폴더의 별도 소유 루프백에서 그대로 실행한다. 합성 계정은 실행기 안의 소유자 A, PNG는 실행기가 만드는 16×16 빨강·파랑 PNG다.
