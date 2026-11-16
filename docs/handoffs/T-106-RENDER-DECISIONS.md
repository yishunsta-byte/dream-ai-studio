# T-106 · 렌더 결정 정합과 기존 지침 갱신 (Claude design)

| 항목 | 내용 |
|---|---|
| 담당 / 지시 | Claude design (CC-DESIGN-01) / Master `msg_1dc95ea69dd3` |
| 근거 | T-101 `3799dfd` 설계, Master 결정(아래 1장), `@remotion/renderer`·`@remotion/licensing` 4.0.543 배포 코드, Remotion 공식 문서 |
| 바꾼 것 | `T-102-PC-RENDER-UX.md`(표 고침 + 13장), `T-037-REMOTION-CONDITIONS.md` 8장 3번의 **렌더 licenseKey 부분만**, 이 파일 |
| 안 바꾼 것 | 제품 코드·공유 상태·PLAN·spec·자산·DESIGN·prototype. T-037의 Player `acknowledgeRemotionLicense` 부분 |
| 사용자 결정 | 없음 |

---

## 1. Master 결정 (T-101 회수)

| # | 결정 |
|---|---|
| D-1 | `licenseKey: null` |
| D-2 | 렌더용 브라우저(Headless Shell)는 별도 설치 스크립트, sha 고정. 렌더 중 자동 다운로드 없음 |
| D-3 | P2-4 렌더는 오디오 트랙 0개가 기대값 |
| D-5 | concurrency 1 |
| D-9 | 전부 4.0.543 고정 |
| D-6 | 파일 이름 slug는 한글 유지 |
| — | 프로젝트당 진행 중 렌더 1개, 전체 작업 동시 1 |
| **D-7** | **통과한 MP4와 취소 뒤 끝나 보관한 MP4도 백업에 포함.** 파일 누락을 정상 백업 정책으로 삼지 않음(T-101 추천 "행만 포함"과 반대) |
| — | T-105(코딩): `renders` 0006·s6·백업/복원 기반만. 렌더러 구현·UI는 나중 배정 |

---

## 2. T-037 ③ 갱신 근거 — `licenseKey`

### 2.1 배포 코드 (직접 읽음)

`npm pack @remotion/renderer@4.0.543 @remotion/licensing@4.0.543 --ignore-scripts`로 받아 대화용 임시 폴더에서 읽기만 함(실행·설치 안 함).

| 위치 | 내용 |
|---|---|
| `renderer/dist/render-media.js` 581~600줄 | 렌더가 끝난 뒤 `if (licenseKey === null) { resolve(result); return; }` — **null이면 아무것도 보내지 않음.** 아니면 `internalRegisterUsageEvent({event:'cloud-render', host:null, succeeded:true, licenseKey: licenseKey === 'free-license' ? null : licenseKey, …})` — **`"free-license"`도 전송함**(키 값만 null로 바꿔 보냄) |
| `licensing/dist/register-usage-event.js` | 주소 `https://www.remotion.pro/api/track/register-usage-point`, POST JSON `{event, apiKey, host, succeeded, isStill, isProduction, idempotencyKey}`. 최대 4번 시도, 시도마다 10초 제한, 사이 1·2·4초 대기. 결과는 렌더 성공 여부와 무관(실패해도 렌더는 끝남) |
| 같은 파일 686~699줄 | 키가 없을 때 "Pass licenseKey…" 경고는 5.0 변경 스위치(`ENABLE_V5_BREAKING_CHANGES`)가 켜졌을 때만 |

→ T-101의 사실 기록과 같음.

### 2.2 공식 문서 (2026-11-16 읽음, 페이지에 갱신 날짜 없음)

- telemetry: "Server-side rendering only sends telemetry when a license key is set, and only for successful renders" / "Telemetry never throttles, blocks, or fails renders".
- licenseKey 설명: 무료 대상이면 `"free-license"`를 넘겨 "declare your eligibility". **이 값으로 서버 렌더가 사용 기록을 보내는지는 문서에 적혀 있지 않음.**
- licensing: "For all versions below Remotion 5.0, it is **voluntary** to use this package." / 5.0부터 Automators 요금제는 필수. FAQ: "Telemetry in server-side rendering remains voluntary for Free License users".
- 받는 곳의 주소는 문서에 없음("Remotion's servers").

### 2.3 문서와 4.0.543의 차이

| | 문서 | 4.0.543 코드 |
|---|---|---|
| `"free-license"` 서버 렌더 | 자격 선언이라고만 함. 전송 여부 말 없음 | **전송함**(apiKey null, IP는 요청에서 보임) |
| `null` | 키가 없으면 전송 안 함 | 전송 안 함 — 일치 |
| 받는 곳 | 안 적힘 | `www.remotion.pro` |
| 강제 여부 | 4.x 무료는 voluntary | 경고도 5.0 스위치 전엔 없음 — 일치 |

### 2.4 결론

- 개인 무료 대상(T-040 "개인 활동이야")은 4.x에서 사용 기록이 voluntary이고, 이 앱은 127.0.0.1 로컬·외부 전송 최소 원칙이라 **`null`이 맞음.** 무료 자격 자체는 키 값과 무관(LICENSE 조건).
- 또 하나: 인터넷이 없을 때 `"free-license"`면 렌더가 끝난 뒤 재시도로 최대 약 47초를 더 기다림(4×10초 + 7초). `null`은 이 지연도 없음.
- 5.0으로 올릴 때는 T-037 2번대로 다시 확인(Automators는 필수가 되지만 개인 무료·Creators는 문서상 선택).
- 이것은 법률 판단이 아니라 배포 코드·공개 문서 대조 기록.

---

## 3. 화면·동작 정합 (T-102에 반영한 것)

| 주제 | 정한 것 |
|---|---|
| P2-4 소리 없음 확인 | 파일 확인 표에 "오디오 트랙 0개" — 트랙이 **있어도** 확인 실패. 칩 "소리 없음 · 다음 단계에서 붙여요". 소리 단계는 화면에 없음 |
| 진행 | 준비(퍼센트 없음) → 합치기(프레임 퍼센트) → 파일 확인(퍼센트 숨김). 대기에는 "처리기 꺼짐"과 "다른 작업 뒤에서 기다림"을 나눠 보임 |
| 취소 | 확인 패널 → 취소하는 중 → 취소됨(정리 성공/실패 + 남은 상대경로). 취소 뒤 끝난 통과 영상은 "취소 뒤 끝남", 보관·백업 포함, 자동 선택·내보내기 대상 아님 |
| 기존 파일 불변 | 새로 만들기·재시도·취소·실패·복원 어느 것도 예전 MP4를 덮거나 지우지 않음. 같은 버전 둘째부터 `-2` |
| 백업 포함 상태 | 통과·취소 뒤 끝난 MP4 = 백업 포함. 그래서 복원 뒤 "파일 없음"은 **오류**로 보이고 원인 확인 안내. 확인 실패·취소로 정리된 임시 파일은 결과 행 기록만 |
| 디스크 부족 | 시작 전 확인에서 막음(필요·남은 공간). 도중이면 실패 행. **자동 재시도 없음** — 사람이 공간을 비운 뒤 "다시 만들기" |
| 무한 반복 금지 | 자동 재시도는 도구 중단(`RENDER_BROWSER_CRASHED`·lease 만료)과 `STORAGE_FAILED`만 최대 2번. 그 뒤엔 실패 행 + 사람이 다시 만들기. 결정적 실패(`RENDER_VERIFY_FAILED`·`RENDER_INPUT_CHANGED`·`FONT_MISSING`·`RENDER_INPUT_MISSING`·`DISK_FULL`)는 자동 재시도 0 |
| 도구 없음 | `RENDER_BROWSER_MISSING`이면 시작 전 막고 설치 안내(스크립트 실행은 승인 뒤) |
| 전체 동시 1 | 렌더가 도는 동안 다른 작업 화면에 "영상 만드는 중이라 기다려요" |
| 수용 조건 | T-102 R-13~16 추가(외부 요청 0, 디스크 부족, 백업 복원 뒤 재생, 다른 작업 대기 표시) |

---

## 4. T-105(코딩)에 알릴 것

- 백업 포함이 결정이므로 s6 fixture에 **통과 MP4 1개와 취소 뒤 끝난 MP4 1개**(가상, 작은 파일)가 들어가고, 복원 뒤 경로·해시가 맞는지 확인되면 화면 R-15를 검수할 수 있음.
- 확인 실패·취소로 정리된 행은 파일 경로 없이 복원되어야 함("파일 없음" 오류로 보이면 안 됨 — 처음부터 재생·받기가 없는 행).
- 오류 코드 이름이 바뀌면 T-102 문구는 그대로 두고 이름만 맞춤.

## 5. 미확인

- 렌더를 실제로 돌려 외부 요청 0건을 본 것은 아님(T-101 완료 조건 6의 CDP 감사로 확인 예정).
- 문서 페이지에 갱신 날짜가 없어, 읽은 날(2026-11-16) 기준.
