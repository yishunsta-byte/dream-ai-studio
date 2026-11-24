# 보호 분석 화면 · 취소 뒤에도 성공을 돌려주는 목록 전송

2026-11-20 · Codex(Front) · Master 배정 `msg_324cdb161368`

## 범위

- **배경:** `900d9af` 브라우저 실측에서는 늦은 성공 응답이 화면에 도착한 경우가 0건이었다. 실제 `fetch`는 취소되면 응답을 넘기지 않기 때문이다.
- **이번에 한 것:** 기존 transport 주입 지점과 단위 시험을 그대로 써서, 취소 신호를 무시하고 이전 요청에 성공을 돌려주는 시험 대역으로 확인했다.
  1. 이전 목록·선택이 화면에 나오지 않고 새 요청 결과만 나오는가
  2. 정상 경로는 그대로인가
  3. 세대 검사와 abort 검사가 각각 따로 관찰되는가
- **판정:** 결함이 없어 제품 코드는 바꾸지 않았다.
- **범위 밖:** 공통 인증, 운영, Next

## 시험

### 단위 시험

`tests/reference-analysis/studio-protected-materials-analysis.test.ts`에 시험 1건을 추가했다.

- **시험 대역:** 취소 신호를 기록만 하고 요청을 거절하지 않는다. 응답은 시험이 직접 풀어 준다.
- **취소 뒤 성공:**
  - 대역이 성공 응답을 돌려주고 본문도 1번 읽혔다.
  - `loadProtectedMaterials`의 결과는 `{ kind: "failed" }`였다. 본문을 읽은 뒤 `throwIfAborted`가 막았다.
- **취소 전 성공 (정상 대조):** 결과는 `ready`였고 자료 1개에 ‘등록 자료 1’이 붙었다.
- **실행 결과:** 이 파일의 시험 18개가 모두 통과했다. tsc와 eslint 오류 0.

### 브라우저 시험 (새 파일, 서버 DB 없음, 합성 자료만)

| 경로 | 내용 |
|---|---|
| `tests/reference-analysis/protected-materials-late-transport-browser.tsx` | 진입점. `StudioProtectedMaterialsAnalysis`의 `transport`에 같은 시험 대역을 주입한다. 대역은 요청을 기록하고(취소 여부, 응답 여부, 본문 읽기 수), 취소 신호는 기록만 한다. 경계 값은 시험용으로 공개된 `SessionBoundaryContext`로 `view`와 `epoch`를 직접 바꾼다. |
| `tests/reference-analysis/protected-materials-late-transport-run.mjs` | 루프백 서버. 화면 묶음만 내보내고, ego 보고를 받아 판정한 뒤 종료한다. |
| `tests/reference-analysis/protected-materials-late-transport.ego.mjs` | ego 조작 스크립트. 폭 390·1440 |

```powershell
node tests/reference-analysis/protected-materials-late-transport-run.mjs
# "LATE-TRANSPORT-READY http://127.0.0.1:<포트>"를 확인한 뒤:
ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "http://127.0.0.1:<포트>"; await import("file:///<저장소>/tests/reference-analysis/protected-materials-late-transport.ego.mjs")'
```

## 결과

판정 `pass`, 실패 0, 실행기 exit 0이었다. 아래 세 경우를 폭 390과 1440에서 같은 순서로 확인했다.

첫 실행은 실패했다. 원인은 ego 스크립트의 실행 도우미가 인자가 없을 때도 `undefined`를 넘긴 것이었다. 그래서 첫 요청 대기에서 시간이 초과됐다. 화면 문제는 아니었다. 도우미를 고친 뒤 다시 실행했다. 첫 실행의 실행기는 실패를 보고하고 exit 1로 끝났다.

### N · 정상

1. 첫 목록 요청이 응답을 기다리는 동안 ‘불러오는 중’만 보였다.
2. 성공 응답(자료 2개)이 오자 선택지가 3개가 됐다. 첫 초점은 BODY였다.
3. 키보드로 둘째 자료를 고르고 권리를 체크했다.

### G1 · 늦은 성공이 새 결과보다 뒤에 도착

1. 의심 → `current`로 요청 #2를 만든다. 다시 의심 → `current`로 #2를 이전 세대로 만든다.
   - #2는 취소되고(`aborted`), #3은 취소되지 않았다.
   - 이 사이 화면은 ‘불러오는 중’이었고 선택은 없었다.
2. #3에 성공 응답(자료 1개)을 준다.
   - 선택지는 2개(‘등록 자료 1’)였고, 선택·체크는 없었다.
3. 취소된 #2에 성공 응답(이전 자료 2개)을 준다.
   - 응답이 실제로 도착했고 본문도 1번 읽혔다.
   - 화면은 그대로였다. 선택지 2개, 선택·체크 0이었다.
   - 실패 안내는 0이었다.
   - 이전·새 자료 이름과 ID가 DOM에 남은 흔적도 0이었다.

### G2 · 늦은 성공이 새 결과보다 먼저 도착

1. 새 목록에서 선택하고 권리를 체크한 상태로 시작한다.
2. 같은 방식으로 #4를 취소하고 #5를 만든다.
3. 취소된 #4에 성공 응답(이전 자료 2개)을 먼저 준다.
   - 본문은 1번 읽혔다.
   - 화면은 ‘불러오는 중’ 그대로였다. 선택 상자와 실패 안내는 0이었다.
4. #5에 성공 응답(자료 1개)을 준다.
   - 선택지는 2개였고, 선택·체크·실패 안내·흔적은 0이었다.
   - 요청은 모두 5건이었다.

## 무엇이 따로 관찰됐나 (근거대로)

1. **목록 조회 함수의 abort 검사** (`loadProtectedMaterials`)
   - 단위 시험에서 직접 관찰했다.
   - 취소 뒤 성공 응답의 본문을 읽은 다음 `throwIfAborted`로 `failed`를 돌려준다.
   - 브라우저에서도 취소된 #2·#4의 본문 읽기가 1번이었다. 응답이 함수 안까지 들어왔다는 뜻이다.
2. **컴포넌트의 버리기 검사** (`mine !== generation.current || controller.signal.aborted`)
   - 브라우저에서 관찰했다.
   - 1번 검사가 늦은 응답을 `failed`로 바꿨는데도 실패 안내가 한 번도 그려지지 않았다. 목록·선택도 바뀌지 않았다.
   - 따라서 컴포넌트 검사가 그 결과를 버린 것이 화면으로 드러난다.
3. **세대 검사와 abort 검사를 서로 떼어 보는 것**
   - 관찰할 수 없었다.
   - 현재 코드에서는 세대를 올리는 모든 경로가 진행 중 요청도 함께 취소한다. `fetchList`, `epoch` 효과, `deny`, 언마운트가 모두 그렇다.
   - 그래서 두 조건은 늘 함께 참이 된다. 코드를 바꾸지 않고 둘 중 하나만 참인 상태를 만들 수 없다.

## 남은 것

- **분석 POST 쪽 늦은 성공:** 이번 범위가 아니다. 분석 화면의 `activeJob` 비교는 기존 단위 시험 범위다.
- **실제 환경 확인:** 실제 Next와 운영 연결에서는 아직 확인하지 않았다.
