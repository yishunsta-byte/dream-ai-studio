# 보호 분석 화면 · 세션 확인 중 최초 마운트와 실제 POST 403

2026-11-20 · Codex(Front) · Master 배정 `msg_32eeb67b1e42`

## 범위

- **확인할 것** (`2854c24` 뒤에 브라우저에서 아직 재지 않은 부분)
  1. 세션 확인 중에 화면이 처음 그려질 때 목록 조회가 0인가
  2. 확인이 끝난 뒤 자기 목록을 1번만 받는가
  3. 실제 POST 403에서 접근 거절 안내가 뜨고, 선택·초안이 지워지고, 초점이 안내로 가고, 원본 읽기가 0인가
  4. 정상 경로에 회귀가 없는가
- **고친 범위:** 보호 분석 어댑터 한 파일 안에서만 최소로 고쳤다.
- **바꾸지 않은 것:**
  - 공통 세션 구현
  - 서버 권한
  - 운영
  - 보류된 Next
  - G3 (신호 없이 계정이 바뀌는 경우)

## 결함과 보완

**결함:** 고치기 전 코드로 새 시험을 돌렸더니 판정이 `fail`이었다.

- 두 폭 모두 `M1 no list while checking`에서 실패했다.
- 경계가 확인 중일 때 화면이 처음 그려지면 목록 GET을 바로 1번 보냈다(가려진 본문 안에서).
- 확인이 끝난 뒤에는 다시 받지 않았다. 따라서 확인 전에 받은 목록이 그대로 쓰였다.
- POST 403과 정상 경로는 그때도 기대대로였다.
- 실패한 실행도 정리를 마친 뒤 exit 1로 끝났다.

**보완** (`components/reference-analysis/studio-protected-materials-analysis.tsx`)

- 처음 마운트될 때 경계가 `current`가 아니면 목록을 받지 않는다.
- 대신 `staleEpoch` 표시만 남긴다. 그러면 기존 `current` 확인 효과가 목록을 1번 받는다.
- 경계 밖이거나 경계가 `current`인 상태에서 처음 그려지면 이전과 같다.

## 시험 (새 파일)

| 경로 | 내용 |
|---|---|
| `tests/reference-analysis/registered-pcm-wav-session-mount-browser.tsx` | 브라우저 진입점. 경계 → 보호 본문 → 지연 마운트. `?defer=1`이면 `fixture-mount` 이벤트가 올 때 화면을 그린다. 레이아웃은 유지한 채 페이지만 바뀌는 순간을 흉내 낸다. |
| `tests/reference-analysis/registered-pcm-wav-session-mount.pg17.ts` | 검증 본체. `2f77c62` 시험 서버를 바탕으로 했고, 허용 밖 세션 `f`(인증 403 `AUTH_FORBIDDEN`)와 403 수 세기를 더했다. |
| `tests/reference-analysis/registered-pcm-wav-session-mount-run.mjs` | 실행기 |
| `tests/reference-analysis/registered-pcm-wav-session-mount.ego.mjs` | ego 조작 스크립트. `p1`과 다른 탭 1개, 폭 390·1440 |

```powershell
node --conditions=react-server --import tsx tests/reference-analysis/registered-pcm-wav-session-mount-run.mjs
# "WAV-MOUNT-READY http://127.0.0.1:<포트>"를 확인한 뒤:
ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "http://127.0.0.1:<포트>"; await import("file:///<저장소>/tests/reference-analysis/registered-pcm-wav-session-mount.ego.mjs")'
```

## 결과 (보완 뒤)

판정 `pass`, 실패 0이었다. 실행기는 정리를 마치고 정상 종료했다. 아래 세 경우를 폭 390과 1440에서 같은 순서로 확인했다.

### M0 · 정상 지연 마운트

- 확인된 상태에서 화면을 그렸다.
- 목록 GET은 1번이었고, 첫 초점은 BODY, 선택은 없었다.
- A 분석 결과는 `RMS 25%`, `0–125 ms`였고 A 원본 읽기는 2, B는 0이었다.

### M1 · 세션 확인 중 마운트

1. 같은 계정 신호를 보내고 세션 확인 응답을 붙잡아 둔 채 화면을 그린다.
   - 목록 GET은 0이었다.
   - 본문은 `hidden`과 `inert`로 가려졌다.
   - 가려진 본문에는 ‘불러오는 중’ 안내만 있었고, 선택 상자는 없었다.
2. `same` 확인 뒤
   - 목록 GET은 정확히 1번이었다.
   - 선택지는 2개(빈 선택 + ‘등록 자료 1’)였고, 선택과 체크는 없었다.
   - 초점은 빈 자료 선택에 있었다.
   - POST와 원본 읽기는 0이었다.
   - 가로 넘침은 0이었다.

### F · 실제 POST 403

1. A 결과를 받고 초안을 고친다.
2. 문서를 유지한 채 허용 밖 세션(`f`)으로 바꾸고 ‘다시 분석’을 누른다.
   - 서버 POST가 403을 1번 돌려줬다.
   - 원본 읽기는 0, 목록 재조회도 0이었다.
3. 화면 상태
   - ‘이 화면에 접근할 수 없어요’ 상태로 바뀌었고, 링크는 없었다.
   - 선택 상자, 체크, 초안, 결과, `RMS 25%`, 편집 문장이 DOM에서 모두 0이었다.
   - 초점은 안내로 갔고 가로 넘침은 0이었다.

### 서버 합계 (교차 POST 2건 포함)

| 항목 | 값 |
|---|---|
| POST | 8 (`ready` 4, 403 2, `source_unavailable` 2) |
| 원본 읽기 | A 8, B 0 |

## 회귀

- **`2854c24` 보완 확인 시험** (`registered-pcm-wav-session-guard`)
  - 다시 실행해 `pass`, exit 0이었다.
  - 합계는 이전과 같았다: POST 20, 원본 읽기 A 24·B 4, 붙잡은 응답 버림 2.
- **단위 시험**
  - `tests/reference-analysis`와 세션 시험 `t213`·`t220`·`t235`: 31개 파일 통과(7개 건너뜀), 310개 시험 통과(74개 건너뜀)
  - tsc와 eslint 오류 0

## 남은 것

- **G3:** 신호 없이 계정이 바뀌는 경우는 범위 밖이다.
- **실제 환경 확인:** 실제 Next 셸, Supabase 세션, 운영 연결에서는 아직 확인하지 않았다.
