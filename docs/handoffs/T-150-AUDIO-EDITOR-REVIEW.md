# T150 오디오 편집 U2/U3 독립 검수

- **제품 판정: FAIL. F150-1(P1, 초안 입력 소실) 필수 수정 후 재검수 필요.** 저장 인계·복구 등 통과 경로와 이 결함을 구분한다.
- 기준 `395d9ddab0bbe05b08d419209c2444d99b271e1c`(T149), `T-149-AUDIO-EDITOR.md`, `T-146-AUDIO-UI-CONNECTION.md` V4~V11. 구현에 참여하지 않은 검수자 수행.
- 허용 수정은 이 보고서뿐이다. 제품 수정·도구 설치본 변경·사용자 DB 접근·공용 상태 갱신 없음. T151 문구 문제를 중복 수정하지 않았다.

## F150-1 — 곡 연결 확인이 미리보기 이후의 gain·권리 입력을 지움

**중요도 P1 / U2 수용 차단.** 명시적으로 바꾼 초안 값이 다른 조작으로 조용히 사라진다. 특히 권리 메모도 잃는다. 저장 경쟁이나 DSP 문제가 아니라 `JoinBox`의 오래된 전체 초안 적용 문제다.

실제 Next 편집 화면에서 재현한 순서:

1. 가짜 v1 프로젝트에 10초 합성 음악 A와 B를 넣는다. A는 0초, B는 A 끝인 10초부터 들어간다.
2. A 끝 서서히를 `00:00.15`로 놓고, 이어질 곡 B를 선택하여 1초 겹침의 “이렇게 바꿔요” 미리보기를 만든다.
3. 미리보기를 둔 채 A 소리 크기를 **-6 dB**, A 라이선스 메모를 **`F150-stale-plan-keep`**로 바꾼다.
4. “이대로 연결”을 누른다.
5. 곡 연결은 적용되지만 **gain은 0으로, 메모는 빈 값으로 되돌아간다**. 전후 실제 input value는 `browser2.log`의 `before-apply`/`after-apply`에 남겼다. 이는 주입 DTO나 순수 helper 추정이 아닌 실제 React form 관찰이다.

원인 근거: 기준 `components/audio-editor/audio-editor.tsx:133`은 `planJoin(timeline,…)`이 만든 **전체 timeline**을 state `plan`에 보관한다. 후속 gain/rights 변경에도 plan을 갱신·폐기하지 않고, `:159`에서 `setDraft(plan.timeline)`으로 전체 초안을 덮어쓴다. `planJoin` 자체는 받은 초안을 보존하지만 UI가 이후의 초안을 넘기지 않는 것이다. “다른 소리·장면·글자 시간은 움직이지 않아요” 안내가 있어 이 소실을 예상하기도 어렵다. gain·권리는 직접 재현했고 다른 필드 소실까지 실행했다고 확대하지 않는다.

최소 수정 필요: 확인 시점의 최신 draft에서 연결을 계산하거나, 관련 초안 변경 시 미리보기를 무효화하여 다시 확인하게 해야 한다. gain/rights 같은 연결 외 변경을 보존하고, 연결 대상·시간·fade가 달라졌다면 갱신된 변경 목록을 확인하게 해야 한다. **미리보기 → gain/rights 변경 → 적용**의 실제 컴포넌트 회귀 검증을 추가해야 한다. 제품 파일은 검수자가 고치지 않았다.

## 환경·보호·실행 결과

OS-temp `C:/Users/Administrator/AppData/Local/Temp/dream-t150-review-ca37cd0d6d`에 `git archive 395d9dd`로 고정했다. 다른 작업의 WIP/공유 3013 서버/공유 `.next`를 쓰지 않았다. 물리 node_modules와 도구 사본, 자기 가짜 `ui-runtime`의 s5 DB·합성 WAV만 사용했다. 가짜 template snapshot은 현 메뉴로 맞추고 장면 2개×15초, 텍스트 없음으로 준비했다. 서버는 자기 `127.0.0.1:43150`이었다.

최종 추적 557파일 대조: 원시 바이트 차이 491개에는 CRLF 표현 차이가 포함된다. 줄끝 정규화 뒤 차이는 **`next-env.d.ts` 1개**이며, Next dev가 `.next/types` import를 `.next/dev/types`로 생성한 것이다. 이 자동 생성 차이 이외 내용 차이 0이다. 원시 전체 동일이라고 주장하지 않는다. 구현 파일을 편집하지 않았고 증거는 `review-audit.json`/로그에 있다.

| 독립 실행 | 결과 |
|---|---|
| `vitest run tests/p2-5u2-audio-editor.test.ts tests/p2-3b-timeline.test.ts` | **27 PASS**, 신규 8개 포함 |
| `vitest run tests/p2-3-text-editor.test.ts tests/p2-1-timeline-api.test.ts` | **20 PASS** |
| 변경 TS/TSX/시험 대상 ESLint | exit0 |
| `tsc --noEmit --incremental false` | exit0 |
| `npm.cmd run build` | exit0, Next 운영 build·verify-build 통과 |

합계 **47 PASS**는 제품 FAIL을 없애지 않는다. 첫 명령에는 존재하지 않는 `p2-3b-text-ops.test.ts` 필터도 있었으나 실제 수집·통과는 위 2파일/27개뿐이다. 작성자의 전체 648 PASS/17 skip은 상속 보고이며 이번에 전체 회귀를 반복하지 않았다. 기존 `p2-3b-timeline` 기대값 변경은 복구 상태에 audio 필드가 추가된 소스 문자열 1줄이며 기존 검사 삭제는 없다. 다만 신규 시험은 순수 연산/서비스 중심으로 F150-1의 **컴포넌트 미리보기 state 수명**을 검증하지 못한다.

실행 사본/설치본 SHA256을 전후 확인했다:

- FFmpeg `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`
- FFprobe `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`

도구 없음 검사는 `realpath`가 자기 temp `.tools` 안임을 확인하고 **그 물리 FFmpeg 사본만** 임시 rename한 뒤 finally로 복원했다. 설치본을 변조하지 않았으며 복원 후 해시 동일이다. 합성 A 파일 오류 검사도 자기 runtime 경로 가드와 원본 buffer 보존/finally 복원·해시 대조를 사용했다.

## V4~V11 실제 수행과 한계

| 항목 | 직접 확인한 결과 / 구분 |
|---|---|
| V4 v1→v2 | 실제 form에서 소리를 넣고 POST 저장, r3 v2 왕복. 음악 A/B·1초 equalPower 연결·권리가 실제 GET/화면에 남았다. 원래 r2 v1의 `timeline_json` 문자열과 SHA는 검수 후에도 정확히 동일(`original-v1-bytes.json`, SHA `9be8ae4119491a824f4cfefa57daafe59da7d431ca3032c18fdda9a4eb431918`). 글자/장면과 v2 필드의 기존 회귀는 위 20/27시험이다. |
| V5 오류·raw | 실제 `00:0` raw 값/aria-invalid와 저장·렌더 진입 차단 확인. 자동시험에서 시간 형식/fade 합/겹침/세 곡/원본 범위/음악 외 duck/권리 오류를 검사했다. 이 모든 오류를 브라우저에서 하나씩 재현한 것은 아니다. |
| V6 연결·참조 | UI의 양끝 fade/다음 곡 시작 변경 미리보기와 실제 연결 저장 확인. 같은 asset의 rights1행·제거·역할 변경은 자동시험 통과. **미리보기 후 다른 입력을 고치면 F150-1 FAIL**이다. |
| V7 자기 지연 응답 | 실제 POST는 서버에서 완료시키고 브라우저 fetch 응답 반환만 gate로 보류했다(제품 소스 수정 없음). 보낸 gain -4의 r4 응답 중 gain -8·join 2초·rights `later-rights-own-save`·raw `00:0`을 고친 뒤 응답 해제: 값·선택·aria-invalid가 모두 남고 미저장 안내가 나왔다. POST 1회, 중복 저장 버튼·렌더 진입은 disabled. 저장 중 추가 버튼도 disabled이므로 audio 추가 자체를 실행했다고 하지 않는다. |
| V7 최신 버전·복구 | 자기 r7 응답을 보류한 상태에서 독립 HTTP writer가 r8을 실제 저장했다. r7 응답 해제 뒤 화면은 r8, 후속 gain **-12**·join **90frames**·rights **`actual-recovery-rights`**·raw `00:0`·선택 B는 자동 반영하지 않고 복구 영역/실제 다운로드 JSON에 보존됐다. 영역으로 초점 이동도 확인. `actual-recovery.json`의 sent/ownSave/shown/draft/audioFields/선택을 직접 읽었다. Clipboard 복사 버튼 자체는 이번에 실행하지 않았다. |
| V7 두 창 CAS | p2는 r6을 표시한 채 후속 메모 `stale-CAS-do-not-drop`으로 저장했다. 실제 서버 409와 충돌 안내, 원래 입력 보존 확인(`browser14.log`). 두 창 지연 응답 경합 첫 시도는 p1의 gate 상태를 잃었으므로 통과로 세지 않았다. 위 r7→r8 복구 재현은 한 페이지의 별도 실제 HTTP writer이며 **두 창 동시 UI 성공**으로 바꾸어 부르지 않는다. |
| V8 업로드 | 실제 file input→POST upload 201 후 `synthetic-upload.wav`가 후보 목록에 나타났다. 미저장 gain **-9**, rights **`preserve-across-upload`**, dirty 상태가 유지됐다. 업로드 취소는 작성자의 자체 확인만 있고 이번 독립 실행은 없다. |
| V8 보관 참조 | 자기 DB에서 저장본 A만 보관. 편집 DTO/목록·권리 행은 유지되고 새 후보에서는 제외됐다. A clip을 그대로 둔 채 B 권리만 바꿔 서비스 저장 성공, audio 배열 동일. A gain을 바꾸면 경고가 나오고 실제 저장은 400으로 거절되어 r10·입력 -10이 유지됐다. 버튼 자체는 enabled이며 서버가 최종 거절한다. |
| V8 렌더 게이트 | 자기 A 누락: `AUDIO_SOURCE_MISSING/file_missing`; 자기 A invalid bytes: `/file_changed`; 물리 사본 FFmpeg 없음: `AUDIO_TOOL_MISSING`, 모두 ready=false 실제 API 확인. available이 렌더 PASS를 뜻하지 않는다. 10분 초과의 신규 실제 화면/요청은 이번에 반복하지 않았으며 기존 DSP/렌더 증거와 구분한다. |
| V9 원본 듣기 | 실제 native audio의 autoplay=false/preload=none/처음 paused. A→B 전환 시 이전 element paused=true/disconnected, 새 것은 paused. native 재생 중 실제 SPA의 편집→export 이동 후 이전 element paused=true/disconnected와 pause 이벤트, audio 0 확인(`browser12.log`). 닫기/Enter 닫기의 제거도 확인했다. |
| V9 오류 | 자기 합성 A bytes만 잠시 invalid로 만들어 실제 HTTP/native MediaError4·오류 안내를 발생시켰다. gain/rights 보존, 원본 복원 SHA 동일, 다시 불러오기 뒤 error null/paused. 이는 실제 디코드 오류 분기이며 **유효한 컨테이너의 브라우저 미지원 codec** 시험과는 다르다. |
| V9 실제 숨김 | **미검증.** Page.bringToFront와 유효 targetId의 Target.activateTarget으로 p2가 active여도 Ego의 p1 visibility는 visible, hidden 이력은 없었다. 합성 이벤트로 실제 탭 숨김 PASS를 만들지 않았다. 코드의 hidden→pause 처리는 읽었으나 실제 Chrome/실기기 숨김 검증이 남는다. |
| V10 1280/390 | 실제 PNG를 열어 줄바꿈·세로 배치 확인. innerWidth/scrollWidth는 1280/1265 및 390/375로 가로 넘침 없음. 390에서는 보이는 소리 form 입력 0, 읽기·권리 보기·원본 듣기만 존재. 소리 카드의 버튼·text/select/file 조작은 44px 이상; checkbox 시각 상자는20px이고 감싼 label44px로 코드 대조했다. 역할→Tab은 시작 칸, 입력 ←/Space 뒤 Player slider 0 유지. 390 원본 듣기 Enter→native 재생 버튼 Space→currentTime>0/error null, Enter 닫기 확인. |
| V11 기존 경계 | dirty/raw-invalid/저장 중 렌더 진입 disabled를 실제 확인했다. 기존 글자·timeline API 회귀는 20시험이다. U1의 late/fileMissing/샘플/최종 잠금과 DSP 수치는 이전 독립 증거 상속이며 이번에 새 렌더를 만들거나 DSP를 재측정하지 않았다. |

## 원본 첫 Space 관찰과 T151

**O150-1(관찰, 필수 수정으로 분류하지 않음):** `focus('audio')` 뒤 첫 Space는 paused=true/readyState0이고 play 이벤트·불러오기 없이 남으며, 두 번째 Space에서 실제 재생됐다. 작성자의 관찰을 재현했다. 그러나 **native 접근성 트리의 재생 버튼 자체에 초점을 두면 첫 Space로 바로 재생됐다**(390px, currentTime0.030017/error null, `browser20.log`). preload/디코드 지연이 원인이라고 확정하지 않는다. audio 바깥 컨테이너와 실제 native control 사이의 초점 차이를 구분해야 한다. 실제 청취·음질·명료도·OS 음량 판정은 하지 않았다.

Master의 T151 `48b82af` 문구 안내를 읽었다. 기준 source를 바꾸지 않고 기존 설명 p의 DOM text만 새 문구로 대체해 **문구 레이아웃만** 1280/390 캡처/직접 확인했다. `t151-copy-injected-{1280,390}.png`에서 줄바꿈/넘침 문제 없음. 통합된 T151 제품 빌드나 저자64시험을 독립 재실행했다고 주장하지 않는다. T149의 오래된 “다음 단계” 문구를 F150 중복 지적으로 올리지 않는다.

실제 휴대폰/스크린리더/200% 확대·실제 청취·실제 탭 hidden·유효 미지원 codec·upload cancel·모든 V5 오류의 실제 화면 조합·Clipboard copy·10분 초과 신규 실행은 미검증이다. U1(T147)·DSP/restore(T144 등)의 상속 결과를 새 U2/U3 증거로 포장하지 않는다.

## 증거와 정리

위 temp에 `seed.mjs`, `ui-meta.json`, `clip-meta.json`, browser1~20.mjs/log, `own-response-state.json`, `actual-recovery.json`, `archived-check.json`, `original-v1-bytes.json`, review 시험/lint/type/build/audit 로그 및 editor/native/T151 PNG가 있다. 오류가 난 browser 호출(첫 두 창 gate, native element Space 대기, stale ref, 초기 CAS의 빈 alert 관찰)은 통과 수에 넣지 않았다. 다음 상태/실제 오류 문구를 다시 확인한 근거를 별도로 적었다. dev의 시스템 파일 watch EINVAL 및 고정 합성 이미지 decode 경고는 있었으며 영상 미리보기의 시각 품질을 새로 보증하지 않는다.

TaskSpace26 finish keep[]와 자기 dev exec 중단 완료, 43150 listen 없음 확인. 사용자 서버3013/그 `.next`는 건드리지 않았다. A file/FFmpeg 사본 rename·invalid bytes는 finally 복원했고 SHA 보존을 확인했다. 가짜 DB의 보관 상태·시험 revision과 합성 업로드는 evidence로 남아 있다.

자기 `.next/node_modules/.tools` 경로를 먼저 resolve하여 temp 하위임을 확인했으나, 삭제 명령이 **자동 승인 검토의 `blocked by policy`로 거절**됐다. 우회하지 않았으므로 **위 temp의 물리 의존성·도구·캐시·가짜 DB/합성음원·증거가 잔존**한다. 검수 worktree에는 이 고유 보고서 외 제품 변경이 없다.

다음 조건: F150-1을 단일 담당이 최소 수정하고 위 순서의 컴포넌트 검증과 저장 경쟁/복구 비퇴행을 재검수해야 U2를 수용할 수 있다. 실제 탭 hidden 등 명시 미검증은 별도 실행 전 완료 표시하지 않는다.

복사용 전달 메시지: T150 독립검수 제품 FAIL입니다. T149 395d9dd에서 곡 연결 미리보기 후 gain -6/권리 메모를 고치고 적용하면 gain0/빈 메모로 사라지는 F150-1(P1)을 실제 앱에서 재현했습니다; audio-editor:133/159의 stale 전체 timeline 적용을 최신 draft 보존 방식으로 고쳐 재검수해 주세요. 관련47시험/lint/type/build, 실제 지연 저장·최신응답 복구 JSON·CAS·업로드 목록·보관참조·native 전환/SPA 종료·오류·1280/390 키보드는 기록 범위 통과입니다. 실제 hidden은 Ego에서 visible로 남아 미검증이고, native 재생 버튼을 직접 고르면 첫 Space는 정상입니다. 고유 보고서만 통합해 주세요; 자기 프로세스는 종료했고 자동 승인 정책의 temp 삭제 거절로 잔존 경로를 기록했습니다.
