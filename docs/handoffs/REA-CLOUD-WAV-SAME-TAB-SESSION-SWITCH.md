# 등록 PCM WAV · 한 오리진 한 탭 세션 교체(PG17)

2026-11-20 · Codex(Front) · Master 배정 `msg_b11c72dbbf09`

## 범위

- **기준:** `a702ce1` 등록 WAV 브라우저 통합과 같은 구성이다. 소유 PG17 t367 이음새, 실제 WAV 등록·승인·RLS, 읽기 어댑터 `66a11b5`, 보호 목록 처리기 `7514ad0`, 권리 UI를 쓴다.
- **추가 시험:** 별도 파일로만 두었다. 한 주소(`127.0.0.1`)와 한 탭에서 A → 로그아웃 → B로 세션을 바꾼다.
- **바꾸지 않은 것:**
  - `a702ce1` 고정 파일
  - 제품 코드와 운영
  - 보류된 실제 Next 3488 실행본

## 바꾼 시험 경로

새 파일만 추가했다.

| 경로 | 내용 |
|---|---|
| `tests/reference-analysis/registered-pcm-wav-session-switch-run.mjs` | 실행기. `a702ce1` 실행기와 같은 이음새를 쓰고, 검증 함수만 바꿨다. |
| `tests/reference-analysis/registered-pcm-wav-session-switch.pg17.ts` | 검증 본체. 아래 기능을 `a702ce1` 본체에 더했다. |
| `tests/reference-analysis/registered-pcm-wav-session-switch.ego.mjs` | ego 조작 스크립트. 한 탭(`p1`), 폭 390·1440. |

**본체에 더한 기능**

- `/__logout`: 쿠키를 지우고 `/`로 보낸다.
- `/__fixture/hold-next-post`: 다음 분석 POST 응답을 **계산한 뒤** 붙잡아 둔다. 계산을 먼저 끝내므로 로그아웃 뒤에 A 원본을 읽는 일이 생기지 않는다.
- `/__fixture/release`: 붙잡은 응답을 놓는다. 이미 끊긴 연결이면 버린 수로, 아니면 보낸 수로 센다.
- 401 응답 수를 센다.

## 실행

```powershell
node --conditions=react-server --import tsx tests/reference-analysis/registered-pcm-wav-session-switch-run.mjs
# "WAV-SWITCH-READY http://127.0.0.1:<포트>"를 확인한 뒤:
ego-browser nodejs -e 'globalThis.FIXTURE_ORIGIN = "http://127.0.0.1:<포트>"; await import("file:///<저장소>/tests/reference-analysis/registered-pcm-wav-session-switch.ego.mjs")'
```

보고가 오면 실행기가 판정한다. 이어서 서버 쪽 교차 POST를 확인하고, PG17·리스너·임시 클러스터·작업 폴더를 정리한 뒤 exit 0으로 끝난다.

## 결과

판정 `pass`, 실패 0, 실행기 exit 0이었다. 폭 390과 1440에서 같은 순서로 확인했다.

1. **A 로그인 → 분석**
   - `음악 분석 · 결과 1개`, `오디오 1채널 · 최대 정규화 RMS 25%`, 구간 `0–125 ms`, 창작 초안이 나왔다.
   - 초안 끝에 편집 문장을 덧붙였다.
2. **A ‘다시 분석’ 응답을 붙잡은 채 같은 탭에서 `/__logout`**
   - 화면은 ‘다시 로그인해 주세요’ 안내와 ‘다시 로그인’ 링크만 남았다.
   - 결과, RMS, 초안, 편집 문장, 선택, 체크가 모두 0이었다. localStorage·sessionStorage도 0이었다.
   - 가로 넘침은 0이었다.
3. **401 경계**
   - 세션 없이 목록 GET은 401이었다.
   - 세션 없이 분석 POST도 401이었다(`AUTH_REQUIRED`).
   - 원본 읽기 증가는 0이었다.
4. **같은 탭에서 `/__session?as=b` 로그인 → 붙잡은 A 응답 놓기**
   - B 목록은 ‘등록 자료 1’ 하나뿐이었고, 목록 GET도 1개였다.
   - A 응답을 놓은 뒤 화면에 A 흔적이 0이었다. 결과, RMS 25%, 편집 문장, 초안, 선택, 체크, 저장소가 모두 비어 있었다.
   - 초점은 BODY였다.
5. **B가 직접 분석 실행**
   - POST 1번, B 원본 읽기 2번이었다.
   - `RMS 12.5%`, 구간 `0–125 ms`였고 A의 25%나 편집 문장이 섞이지 않았다.
   - 로그아웃 뒤 A 원본 읽기는 0이었다. B도 직접 실행하기 전까지는 원본 읽기가 0이었다.
   - 가로 넘침은 0이었다.

**서버 쪽 교차 POST:** A→B 자료, B→A 자료 모두 `source_unavailable`이었고 읽기는 0이었다.

**최종 합계**

| 항목 | 값 |
|---|---|
| POST | 10 (`ready` 6, `source_unavailable` 2, 401 2) |
| 원본 읽기 | A 8, B 4 |
| 붙잡은 응답 | 2 (버림 2, 보냄 0) |

작업 폴더는 비었다. tsc와 eslint 오류는 0이다.

## 해석과 남은 것

- **붙잡은 A 응답이 화면에 닿지 않은 이유:** 같은 탭에서 페이지를 이동하면 브라우저가 진행 중이던 요청을 끊는다. 그래서 두 번 모두 서버가 응답을 버렸다(버림 2).
  - 이번 시험은 ‘페이지 이동으로 바꾼 세션’에서 이전 응답과 편집 내용이 남지 않음을 확인했다.
  - 문서를 다시 불러오지 않은 채 세션만 바뀌는 경우는 이번 범위 밖이다. 이때 화면 안의 세대·중단 처리가 어떻게 동작하는지는 `87707c5`·`eb0e07b` 단위 시험에 근거가 있다.
- **로그인 방식:** 로그인은 시험 서버의 합성 쿠키다. 실제 Next·Supabase 로그인과 로그아웃은 보류된 3488 실행본의 범위다.
