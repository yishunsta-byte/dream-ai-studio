# 보호 분석 화면 · 늦은 목록 응답과 세션 경계

2026-11-20 · Codex(Front) · Master 배정 `msg_327579cc6af3`

## 범위

- **확인한 것:** `0327324` 기준에서, 이미 보낸 보호 목록 요청의 응답이 세션 확인 중이거나 이전 `epoch` 뒤에 늦게 돌아오는 경우를 확인했다.
  1. 버려야 할 응답이 목록·선택·결과를 되살리는가
  2. 현재 계정이 확인된 뒤 유효한 목록을 1번만 받는가
  3. 정상 목록과 키보드 동작에 회귀가 있는가
  4. 늦은 응답이 취소됐는가, 늦게 성공했는가
- **판정:** 결함이 없어 제품 코드는 바꾸지 않았다.
- **범위 밖:** 공통 권한, 서버 DTO, 운영, 거부된 Next 실행

## 시험 (새 파일)

| 경로 | 내용 |
|---|---|
| `tests/reference-analysis/registered-pcm-wav-late-list.pg17.ts` | 검증 본체. `0327324` 시험 서버에 목록 응답 붙잡기를 더했다. `/__fixture/hold-next-list`는 다음 목록 GET 응답을 계산한 뒤 붙잡는다. `/__fixture/release-list`에서 응답을 보내고, 연결이 이미 끊겼으면 버림으로 센다. |
| `tests/reference-analysis/registered-pcm-wav-late-list-run.mjs` | 실행기 |
| `tests/reference-analysis/registered-pcm-wav-late-list.ego.mjs` | ego 조작 스크립트. `p1`과 다른 탭 1개, 폭 390·1440 |

화면 진입점은 `0327324`의 `registered-pcm-wav-session-mount-browser.tsx`를 지연 없이 그대로 쓴다. 클라우드 레이아웃과 같은 순서로 경계 → 보호 본문 → 보호 목록 화면이 그려진다.

```powershell
node --conditions=react-server --import tsx tests/reference-analysis/registered-pcm-wav-late-list-run.mjs
# "WAV-LATE-LIST-READY http://127.0.0.1:<포트>"를 확인한 뒤:
ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "http://127.0.0.1:<포트>"; await import("file:///<저장소>/tests/reference-analysis/registered-pcm-wav-late-list.ego.mjs")'
```

## 결과

판정 `pass`, 실패 0, 실행기 exit 0이었다. 아래 두 경우를 폭 390과 1440에서 같은 순서로 확인했다.

### L1 · 같은 계정, 이전 epoch의 늦은 목록

1. **정상 목록 (회귀)**
   - 첫 초점은 BODY였다.
   - 키보드로 분석했더니 A 결과(`RMS 25%`, `0–125 ms`)가 나왔다. 이어 초안을 고쳤다.
2. **신호 #1 → `same` 확인**
   - 확인 뒤 다시 받는 목록 GET을 붙잡아 두었다.
   - 이 동안 화면에는 ‘불러오는 중’ 안내만 있었다.
   - 선택 상자, 이전 결과, 고친 문장은 DOM에서 0이었다.
3. **신호 #2 (이전 epoch로 만듦)**
   - 붙잡은 목록 응답을 놓았다.
   - 화면이 이미 요청을 취소한 뒤라 **전달 0, 버림 1**이었다.
   - 본문은 `hidden`과 `inert`로 가려졌고, 선택 상자·결과·편집 문장의 DOM 되살림은 0이었다.
4. **`same` 확인 뒤**
   - 목록 GET은 모두 2번이었다(붙잡힌 1번 + 유효 1번).
   - 선택지는 2개였고, 선택·체크·결과·편집은 0이었다.
   - 초점은 빈 자료 선택에 있었다. ArrowDown → Tab을 누르면 권리 체크로 갔다.
   - POST는 0, 가로 넘침은 0이었다.

### L2 · 계정 변경, 첫 목록이 늦게 옴

1. 같은 탭에서 문서를 새로 열 때 첫 A 목록 GET을 붙잡는다. 화면에는 ‘불러오는 중’만 있었다.
2. 다른 탭에서 B로 바꾸고 신호를 보낸 뒤, 붙잡은 A 목록 응답을 놓는다.
   - **전달 0, 버림 1**이었다.
   - 본문은 가려졌고 선택 상자는 0이었다.
3. `changed`가 확정돼 문서를 다시 받았다.
   - 계정은 B였다.
   - 목록 GET은 1번이었고, B 목록은 1개였으며, 선택지는 2개였다. 선택은 없었다.
   - 원본 읽기는 0, 가로 넘침은 0이었다.

### 서버 합계 (교차 POST 2건 포함)

| 항목 | 값 |
|---|---|
| POST | 4 (`ready` 2, `source_unavailable` 2) |
| 원본 읽기 | A 4, B 0 |
| 붙잡은 목록 응답 | 4 (전달 0, 버림 4) |

## 취소와 늦은 성공

- **관찰된 것:** 붙잡은 늦은 목록 응답 4건 모두 화면이 먼저 요청을 취소했다.
  - L1에서는 `epoch` 효과가 `inFlight.abort()`를 불렀다.
  - L2에서는 문서를 다시 받았다.
  - 그래서 브라우저가 연결을 닫았고, 서버가 응답을 버렸다.
- **관찰되지 않은 것:** 응답이 화면에 늦게 도착해 ‘성공’한 경우는 이번 실측에서 0건이다.
  - 실제 브라우저 `fetch`는 취소되면 응답을 넘기지 않기 때문이다.
  - 취소를 무시하는 주입 수단으로 늦은 성공을 만들면, 세대 번호 비교(`mine !== generation.current`)가 막는 구조다. 이번 브라우저 실측 범위에서는 그 경로를 직접 일으키지 못했다.

## 회귀와 정적 검사

- 제품 변경이 없어 `0327324`·`2854c24`의 결과는 그대로다.
- tsc와 eslint 오류 0이다.
