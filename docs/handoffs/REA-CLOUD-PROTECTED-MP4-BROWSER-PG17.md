# 클라우드 분석 보호 목록 · 등록 MP4 격리 브라우저 통합

2026-11-20 · Codex(Front) · Master 배정 `msg_db42f925f501`

## 범위

- **기준:**
  - 보호 목록 GET: `7514ad0`
  - 등록 자료 분석 연결: `f90c374`
  - 화면: 검증된 보호 자료 선택·권리 확인 UI (`87707c5`, `eb0e07b`)
  - 화면 진입점: PNG 통합(`0abded0`, `976761f`)의 진입점을 그대로 재사용했다.
- **흐름:**
  1. 브라우저가 보호 목록을 GET으로 받는다.
  2. 자료별 사용 권리를 확인한다.
  3. 등록 MP4를 분석 POST로 보낸다.
  4. 실제 디코딩 프레임과 장면 전환 결과가 나온다.
  5. 승인을 철회하면 결과와 목록이 정리된다.
  6. 계정 B로 바꿔 계정 격리를 확인한다.
- **바꾸지 않은 것:**
  - 제품 코드, 보호 API, 운영 설정과 서비스 연결
  - 고정 후보 `1341083f`
  - 고정 PNG 검증 파일 (`studio-protected-materials-browser.*`)
- **범위 밖:** 음악

## 바꾼 시험 경로

| 경로 | 내용 |
|---|---|
| `tests/reference-analysis/studio-analysis-authority-store.pg17.mjs` | `STUDIO_ANALYSIS_VERIFY_VIDEO_BROWSER=1` 갈래를 추가했다. `seed(admin, images, videos)`에 세 번째 인자를 더해, 지정한 자료를 `video/mp4`·2,000 ms로 등록한다. 인자를 생략하면 기존과 같다. 기존 기본·연결·PNG 갈래는 다시 실행해 모두 exit 0이었다. |
| `tests/reference-analysis/studio-protected-video-browser.pg17.ts` | 검증 본체. 내용은 아래에 정리했다. |
| `tests/reference-analysis/studio-protected-video-browser.ego.mjs` | ego 브라우저 조작 스크립트(390·1440) |

**검증 본체가 하는 일**

- **시험용 MP4 생성:** 저장소 `.tools/ffmpeg`로 두 개를 만든다. 둘 다 32×24, 30 fps, mpeg4, 2초다.
  - A: 빨강에서 청록으로, 1초에 바뀐다.
  - B: 파랑에서 노랑으로 바뀐다.
- **저장소 검증:** 실제 `.tools/ffmpeg/ffprobe`로 한다.
- **다운로드 집계:** 계정별로 따로 센다.
- **계정 전환:** 로그인 계정을 A에서 B로 바꾸는 조작을 제공한다.
- **대기 타이머:** 보고를 받거나 600초 대기 제한이 지나면 타이머를 지운다. 그래서 실행기가 정리 뒤 바로 끝난다.

## 실행

```powershell
$env:STUDIO_ANALYSIS_VERIFY_VIDEO_BROWSER='1'
node --conditions=react-server --import tsx tests/reference-analysis/studio-analysis-authority-store.pg17.mjs
# 출력의 "BROWSER-FIXTURE-READY http://127.0.0.1:<포트>"를 확인한 뒤 다른 창에서:
ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "http://127.0.0.1:<포트>"; await import("file:///<저장소>/tests/reference-analysis/studio-protected-video-browser.ego.mjs")'
Remove-Item Env:STUDIO_ANALYSIS_VERIFY_VIDEO_BROWSER
```

통과하면 `PG17 protected video browser: …` 줄이 나온다. 이어서 PG17·리스너·임시 클러스터를 정리하고 exit 0으로 끝난다.

## 완료 조건과 결과

| 조건 | 결과 |
|---|---|
| 확인 전 POST 0 | 계정 A와 B 모두 같다. 폭마다 자료를 고른 뒤 꺼진 실행 버튼을 강제로 눌렀다. 분석 POST와 다운로드 증가는 0이었다. |
| 정상 POST·다운로드 1과 영상 시간값 | Space로 확인, Tab, Enter를 누르면 POST 1, A 객체 다운로드 1, `ready`가 나왔다. 초점은 ‘분석 결과’로 갔다. 화면 결과는 ‘영상 분석 · 결과 3개’였다. |
| 승인 철회 뒤 결과 제거 | 실제 PG 자료 승인을 철회하고 ‘다시 분석’을 눌렀다. `source_unavailable`이 나왔고 다운로드는 늘지 않았다. 다시 받은 목록은 비었다. 선택, 체크, 결과, 초안이 모두 사라졌다. 초점은 빈 목록 안내로 갔다. |
| 계정 격리 (브라우저) | 계정 B로 바꾼 뒤 새 화면은 아래와 같았다. |
| 계정 격리 (서버) | 브라우저 조작이 끝난 뒤 다른 계정 자료 ID로 직접 POST를 보냈다. A가 B의 자료를, B가 A의 자료를 보냈을 때 둘 다 `source_unavailable`이었고 다운로드는 0이었다. |
| 390·1440 | 첫 진입에서 초점을 가져가지 않았다(BODY). 자료 선택 다음 Tab은 체크 칸, 그다음은 실행 버튼이다. 결과는 390px에서 입력 카드 아래, 1440px에서 옆에 놓였다. 가로 넘침은 0이다. |

**영상 결과 세 개** (결과를 키보드로 하나씩 넘기며 읽었다)

| 결과 | 원본 프레임 표시 시각 | 근거 |
|---|---|---|
| 결과 1 · 0 ms | 0 ms | 디코딩된 영상 프레임 0 ms |
| 결과 2 · 1000 ms | 1000 ms | 디코딩된 영상 프레임 1000 ms |
| 결과 3 · 1000 ms · 장면 전환 후보 | 1000 ms | 인접 프레임의 평균 RGB 차이 74.51%(967–1000 ms) |

모든 시각은 2초 안에 있다. 응답에 원본 해시는 없었다.

**계정 B로 바꾼 뒤 화면**

- 목록에는 B 자기 자료 1개만 있다. 선택하지 않은 상태이고 체크는 꺼져 있다. A의 결과와 초안은 남지 않았다.
- B 분석은 B 객체만 1회 내려받았고 A 다운로드는 늘지 않았다. 결과는 같은 형태의 세 개였다.

**서버 합계 (직접 POST 확인 포함)**

| 항목 | 값 |
|---|---|
| 목록 GET | 6 |
| 프리페치 204 | 3 |
| 분석 POST | 8 (`ready` 4, `source_unavailable` 4) |
| 다운로드 | 4 (A 2, B 2) |

분석 작업 폴더는 비었다.

**정적 검사:** tsc와 eslint 오류 0.

## 처음 HTML·프리페치 검증 범위와 실제 Next 페이지 RSC의 구분

- **이 시험이 확인하는 것:** 시험 서버의 일반 HTML과 esbuild로 묶은 화면이다. 실제 Next 페이지가 아니어서 RSC/Flight 응답이 없다.
  - 처음 HTML에 프로젝트·자료·소유자 ID와 서버 쪽 자료 이름이 없다.
  - 보호 목록 GET에 `RSC: 1`, `Next-Router-Prefetch`, `Sec-Purpose: prefetch`를 붙이면 204 빈 응답이다(3회, 인증·목록 호출 없음).
  - 화면이 그린 DOM에 ID와 서버 이름이 없다.
- **실제 Next 페이지의 확인 위치:** 클라우드 분석 셸의 HTML·Flight·라우터/세그먼트 프리페치 무노출은 다른 문서에서 확인했다.
  - [T317 자료 없는 셸](T317-REA-CLOUD-ANALYSIS-PROTECTED-SHELL.md)
  - [보호 목록](REA-CLOUD-PROTECTED-MATERIALS-LIST.md) (`7514ad0`). 테스트 사본 Next에서 4종 요청이 200이었고 표식이 없었다.
- **아직 없는 것:** 이번 MP4 흐름을 실제 Next 페이지에 연결해서 본 확인은 없다.

## 독립 검수(PG Tester)

위 명령을 Tester 폴더의 별도 소유 루프백에서 그대로 실행한다.
