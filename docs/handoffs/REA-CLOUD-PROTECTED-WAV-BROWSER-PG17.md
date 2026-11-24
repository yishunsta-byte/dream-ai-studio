# 등록 PCM WAV · 보호 목록 · 권리 확인 브라우저 통합(PG17)

2026-11-20 · Codex(Front) · Master 배정 `msg_0a83c6d12efd`

## 범위

- **기준:**
  - 독립 통과한 PCM WAV 읽기 어댑터: `66a11b5`
  - 소유 PG17 등록·승인·RLS 시험: `f1d2b53`
  - 현재 보호 자료 권리 UI: `87707c5`, `eb0e07b`
  - 보호 목록 처리기: `7514ad0`
- **흐름:** 브라우저 → 보호 목록 GET → 자료별 사용 권리 확인 → 분석 POST → 실제 음악 결과 → 승인 철회 → 계정 격리
- **바꾸지 않은 것:**
  - 제품 API와 운영 공급원
  - 최소 후보 `1341083f`
  - 실제 Next MP4 빌드·포트 `D:/starwork/rea-next-mp4`, 3488·3489
  - 기존 WAV 실행기와 PNG·MP4 시험 파일

## 바꾼 시험 경로

새 파일만 추가했다.

| 경로 | 내용 |
|---|---|
| `tests/reference-analysis/registered-pcm-wav-browser-run.mjs` | 실행기. 기존 WAV 권한 실행기와 같은 t367 소유 PG17 이음새를 쓴다. 이음새 blob 확인과 인증 ALS 대체도 같다. 부르는 검증 함수만 바꿨다. |
| `tests/reference-analysis/registered-pcm-wav-browser.pg17.ts` | 검증 본체. 내용은 아래에 정리했다. |
| `tests/reference-analysis/registered-pcm-wav-browser.ego.mjs` | ego 조작 스크립트. A·B 두 탭, 폭 390·1440. 판정을 `/__fixture/done`에 보고한다. |

**검증 본체가 하는 일**

- **등록:** `f1d2b53`과 같은 방식으로 실제 비공개 WAV 등록 처리기를 쓴다.
  - A: 1채널 8 kHz, 1,000프레임, 최대값 8192
  - B: 1채널 8 kHz, 1,000프레임, 최대값 4096
- **승인:** 등록·`rea-reference` 연결·승인을 넣는다.
- **목록:** 같은 RLS 읽기 역할로 `pcm_fixture.current_wav`를 조회해 스냅샷을 만들고, 기존 보호 목록 처리기 `createIsolatedStudioMaterialsGet`에 넣는다(시험 경로).
- **분석:** `createIsolatedRegisteredPcmWavAnalysis`를 `createStudioAnalysisPost`로 연다.
- **계정 판정:** 전역 전환이 아니라 요청마다 쿠키 세션 `wav-session`으로 정한다. 두 세션이 동시에 살아 있도록 주소를 나눴다.
  - A: `127.0.0.1`
  - B: `localhost`
- **읽기 연결:** 연결 하나를 요청 사이에 차례로 나눠 쓴다.

## 실행

```powershell
node --conditions=react-server --import tsx tests/reference-analysis/registered-pcm-wav-browser-run.mjs
# 출력의 "WAV-BROWSER-READY http://127.0.0.1:<포트>"를 확인한 뒤 다른 창에서:
ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "http://127.0.0.1:<포트>"; await import("file:///<저장소>/tests/reference-analysis/registered-pcm-wav-browser.ego.mjs")'
```

- **세션:** 스크립트가 `/__session?as=a`(127.0.0.1)와 `/__session?as=b`(localhost)로 들어간다.
- **철회와 복원:** `POST /__fixture/revoke-a`, `/restore-a`로 실제 PG 승인을 바꾼다.
- **원본 읽기 수:** `GET /__fixture/state`의 `readsA`·`readsB`에서 본다.
- **판정과 정리:**
  - 보고가 오면 실행기가 판정한다.
  - 이어서 서버 쪽 교차 POST를 확인한다.
  - 그다음 PG17·리스너·임시 클러스터·작업 폴더를 정리하고 exit 0으로 끝난다.
  - 대기 타이머는 끝나면 지운다. 대기 제한은 600초다.

## 결과

같은 명령으로 두 번 실행했고 두 번 모두 판정 `pass`, 실패 0, exit 0이었다. 두 번째는 원본 읽기를 정확히 2회로 판정했다.

**처음 HTML·사전 요청**

- 처음 HTML에 자료·프로젝트·소유자 ID, ‘등록 음악’·‘등록 자료’, 권리 메모가 없다.
- 목록 GET에 `RSC: 1`, `Next-Router-Prefetch`, `Sec-Purpose: prefetch`를 붙이면 204 빈 응답이다(3회).
- 익명 목록 GET은 401이고 자료 ID가 없다.
- 이 시험은 일반 HTML과 묶음 스크립트다. 실제 Next RSC/Flight는 범위 밖이다.

**요청별 세션:** 같은 시점에 A 세션과 B 세션이 각각 자기 자료 1개만 받았다.

**폭 390·1440, A·B 각각**

| 확인 | 결과 |
|---|---|
| 첫 진입 | 초점 BODY. 목록은 ‘등록 자료 1’ 하나이고 DOM 노출 0. |
| 확인 전 | 꺼진 실행을 강제로 눌러도 POST 0, 원본 읽기 0 |
| 확인 후 | Space → Tab → Enter. 초점 순서는 체크 → 실행 → ‘분석 결과’ |
| 요청 | POST 1, `ready` 1. 자기 원본 읽기 2회(분석 전 1회 + 분석 뒤 재확인 1회, 사본 1개). 상대 원본 읽기 0. |
| 결과 | ‘음악 분석 · 결과 1개’. 제목은 관찰 근거·분석 추정·창작 초안. |
| 창작 초안 | “사용자 장면의 강조 지점에 맞춰 배경 음악의 셈여림을 구성하세요.” |
| 결과 배치 | 390px에서 아래, 1440px에서 옆 |
| 가로 넘침 | A·B 모두 0 |

**관찰 근거**

| 계정 | 근거 |
|---|---|
| A | `오디오 1채널 · 최대 정규화 RMS 25%`, 구간 `0–125 ms` |
| B | `오디오 1채널 · 최대 정규화 RMS 12.5%`, 구간 `0–125 ms` |

**A 승인 철회 뒤 ‘다시 분석’**

- `source_unavailable` 1건이었고 원본 읽기는 0이었다.
- 선택, 체크, 결과, 초안이 사라지고 빈 목록이 되었다.
- 초점은 ‘분석할 수 있는 등록 자료가 없어요’ 안내로 갔다.
- 가로 넘침은 0이었다.
- 같은 동안 B 세션 목록은 1개 그대로였다.

**서버 쪽 교차 POST:** A 세션이 B 자료로, B 세션이 A 자료로 보냈다. 둘 다 `source_unavailable`이었고 원본 읽기는 0이었다.

**합계 (두 폭 + 교차)**

| 항목 | 값 |
|---|---|
| POST | 8 (`ready` 4, `source_unavailable` 4) |
| 원본 읽기 | A 4, B 4 |

작업 폴더는 비었다.

**회귀와 정적 검사**

- 기존 `registered-pcm-wav-authority-run.mjs`를 다시 실행해 통과했다(exit 0).
- tsc와 eslint 오류 0.

## 남은 것

- **목록 공급원:** 이번 목록은 시험 경로다. 같은 RLS 조회로 만든 스냅샷이다. 운영 음악 목록 공급원과 승인·철회 증거 발급은 범위 밖이다. [음악 발급 경계](REA-CLOUD-MUSIC-ISSUANCE-BOUNDARY.md)
- **실제 Next:** 이번 WAV 흐름을 실제 Next 셸에 연결한 확인은 없다.
