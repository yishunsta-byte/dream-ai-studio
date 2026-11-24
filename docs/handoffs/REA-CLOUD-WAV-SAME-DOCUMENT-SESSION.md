# 등록 PCM WAV · 같은 문서 세션 경계(PG17)

2026-11-20 · Codex(Front) · Master 배정 `msg_06260ea590be`

## 범위

- **무엇을 확인했나:** 문서를 유지한 채 인증이 만료되거나 계정이 바뀌는 경우, 늦게 도착한 응답이 있는 경우를 현재 계약 그대로 확인했다.
- **화면 구성:** 클라우드 레이아웃(`app/(cloud)/layout.tsx`)과 같은 순서로 `SessionBoundary` → `ProtectedContent` → `StudioProtectedMaterialsAnalysis`를 그렸다. 제품 코드는 그대로이고, 시험용 진입점만 새로 만들었다.
- **시험 서버가 흉내 낸 것:**
  - 세션 확인 `/api/auth/session` 계약(401 / `same` / `changed`)
  - 문서를 유지한 채 쿠키만 바꾸는 경로 `/__fixture/cookie`
  - 세션 확인 응답 붙잡기
  - 분석 응답 붙잡기
- **바꾸지 않은 것:** 앞선 고정 시험(`a702ce1`, `fef1cc1`), 보류된 Next 3488, 제품, 운영
- **공백과 최소 연결 조건:** [REA-CLOUD-WAV-SAME-DOCUMENT-SESSION-GAPS.md](REA-CLOUD-WAV-SAME-DOCUMENT-SESSION-GAPS.md)에 따로 정리했다.

## 현재 앱의 같은 문서 세션 신호

- **신호 종류:** `lib/auth/session-sync.ts`와 `components/auth/use-session-watch.ts`가 맡는다.
  - 다른 탭 알림: BroadcastChannel `dream-auth-session`과 `storage` 이벤트
  - 같은 탭에서 다시 확인하는 계기: `focus`, `visibilitychange`, `online`, `pageshow`(복원)
- **서버 답에 따른 동작:**
  - `same`: 본문을 그대로 보인다.
  - `changed`: 본문을 지우고 문서를 다시 받는다(15초 안에 한 번만).
  - 401: 본문을 지우고 `/login?next=…`로 이동한다.
- **의심 상태:** 확인하는 동안 본문을 `hidden`과 `inert`로 가린다.
- **알리는 쪽:** 로그인·로그아웃·비밀번호 변경 화면이 신호를 보낸다.
- **보호 목록 화면 자체:** 세션 신호를 받지 않는다. 기존 경계는 두 가지다.
  - 목록 GET이 401이면 로그인 안내를 띄운다.
  - 분석 POST가 `source_unavailable` 또는 `invalid_selection`이면 목록을 다시 조회한다.

## 바꾼 시험 경로

새 파일만 추가했다.

| 경로 | 내용 |
|---|---|
| `tests/reference-analysis/registered-pcm-wav-session-boundary-run.mjs` | 실행기. `fef1cc1` 실행기와 같은 이음새를 쓰고, 검증 함수만 바꿨다. |
| `tests/reference-analysis/registered-pcm-wav-session-boundary.pg17.ts` | 검증 본체 |
| `tests/reference-analysis/registered-pcm-wav-session-boundary-browser.tsx` | 브라우저 진입점. 경계 → 보호 본문 → 보호 목록 화면 순서로 그린다. |
| `tests/reference-analysis/registered-pcm-wav-session-boundary.ego.mjs` | ego 조작 스크립트. `p1`과 다른 탭 1개, 폭 390·1440 |

## 실행

```powershell
node --conditions=react-server --import tsx tests/reference-analysis/registered-pcm-wav-session-boundary-run.mjs
# "WAV-BOUNDARY-READY http://127.0.0.1:<포트>"를 확인한 뒤:
ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "http://127.0.0.1:<포트>"; await import("file:///<저장소>/tests/reference-analysis/registered-pcm-wav-session-boundary.ego.mjs")'
```

## 결과

판정 `pass`, 실패 0, 실행기 exit 0이었다. 아래 세 경우를 폭 390과 1440에서 같은 순서로 확인했다. 매번 A가 먼저 분석해 `RMS 25%`, `0–125 ms` 결과를 받고 초안을 고친 상태에서 시작한다.

### S1 · 만료: 문서 유지, 쿠키 삭제

1. 문서를 그대로 둔 채 쿠키를 지운다(204).
2. ‘다시 분석’을 누른다.
   - POST가 401을 받았고 원본 읽기는 0이었다.
   - 화면에는 ‘이 자료의 분석 결과를 가져오지 못했어요. 다시 시도해 주세요.’가 나왔다. 로그인 안내는 나오지 않았다.
   - 이전 결과, 초안, 고친 문장은 사라졌다.
   - 자료 선택과 권리 체크는 남았다(선택됨, 체크 켬).
   - 계정 표시값은 A 그대로였다.
3. `focus` 복귀로 다시 확인하게 한다.
   - 세션 확인이 401을 받았다.
   - 본문을 지우고 `/login?next=%2F`로 이동했다.

### S2 · 다른 탭 계정 변경과 늦은 응답

1. A의 ‘다시 분석’ 응답을 붙잡는다. 서버는 계산을 마친 상태다.
2. 세션 확인 응답도 붙잡는다.
3. 다른 탭에서 같은 브라우저 쿠키를 B로 바꾸고 BroadcastChannel 신호를 보낸다.
4. A 탭이 의심 상태가 된다.
   - ‘로그인 상태를 확인하고 있어요’ 안내가 뜨고 초점이 안내로 갔다.
   - 본문은 `hidden`과 `inert`로 가려졌다.
   - 보이는 화면에 결과, RMS, 고친 문장, 선택, 체크가 없었다.
5. 붙잡은 A 응답을 놓는다.
   - 응답이 실제로 전달됐다(전달 1).
   - 본문은 계속 가려진 상태였고, 보이는 화면에도 A 값이 없었다.
   - 다만 가려진 DOM 안에는 `RMS 25%`가 들어 있었다.
6. 세션 확인 응답을 놓는다.
   - 답은 `changed`였다. 본문을 지우고 문서를 다시 받았다.
   - 다시 받은 화면은 계정 B였다. 목록은 ‘등록 자료 1’ 하나였고, 선택·체크·결과는 없었으며, DOM의 `RMS 25%`와 고친 문장도 0이었다.
7. B가 직접 분석을 실행한다.
   - `RMS 12.5%`, `0–125 ms` 결과가 나왔다.
   - 원본 읽기는 B만 2번이었다. 붙잡은 응답 뒤로 A 읽기는 0이었고, B도 직접 실행하기 전에는 0이었다.
   - 가로 넘침은 0이었다.

### S3 · 신호 없이 문서 유지, 쿠키만 B로 교체

1. 쿠키를 B로 바꾼다(204). 다른 탭 신호는 보내지 않는다.
2. A 선택이 남은 채 ‘다시 분석’을 누른다.
   - POST가 `source_unavailable`을 받았고 원본 읽기는 0이었다.
   - 기존 철회 경계가 동작했다. ‘선택한 자료에 접근할 수 없어요’ 안내가 뜨고 목록을 다시 조회했다.
   - 다시 조회한 목록은 B의 자료 1개였다. 선택·체크·결과·초안·고친 문장은 0이었다.
   - 가로 넘침은 0이었다.
   - 경계의 계정 표시값은 A 그대로였다. 신호나 `focus` 복귀가 없으면 경계는 다시 확인하지 않는다.

### 합계와 기타

**서버 합계 (교차 POST 2건 포함)**

| 항목 | 값 |
|---|---|
| POST | 16 (`ready` 10, `source_unavailable` 4, 401 2) |
| 원본 읽기 | A 16, B 4 |
| 붙잡은 분석 응답 | 2 (전달 2) |
| 붙잡은 세션 확인 | 2 |

작업 폴더는 비었다. tsc와 eslint 오류는 0이다.

**브라우저 저장소:** 남은 값은 제품 `reloadOnce`의 시각 표식(`dream-auth-session-reloaded`) 하나뿐이었다. 계정 정보는 없었다.
