# T147 오디오 렌더 UI 독립 검수

- 판정: **bounded PASS — 이번 U1 범위에서 필수 제품 수정 발견 없음.** P2 전체 완료나 청취 품질 승인이 아니다.
- 기준: `7270d00097389b91dfe754ddc5e216c1f395e5d6` 및 `T-147-AUDIO-RENDER-UI.md`. 작성에 참여하지 않은 검수자가 diff, 시험, 실제 앱 연결을 확인했다.
- 반환 범위: 이 고유 보고서만. 제품·사용자 DB·설치 도구·고정 fixture·공용 상태 문서 수정 없음.

## 격리와 검증 기준

`git archive`로 OS-temp `C:/Users/Administrator/AppData/Local/Temp/dream-t147-review-FaTKfa`에 기준을 고정했다. 현재 검수 worktree HEAD `55367b4`나 다른 작업자의 WIP를 섞지 않았다. 추적 파일 551개 전수 대조 결과 CRLF를 LF로 정규화한 내용 차이 0; 원시 바이트가 다른 파일은 485개다. archive/export의 줄끝 표현 차이이므로 전체 바이트 동일이라고 주장하지 않는다. `review-source-audit.json`에 수량과 예시를 보존했다.

기존 물리 의존성의 복사본과 설치 도구의 물리 복사본만 실행했다. 설치본과 실행 사본의 검수 전후 SHA256:

- FFmpeg: `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`
- FFprobe: `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`

이는 이번 실행의 확인값이다. 과거 실행의 binary SHA를 소급 확정하지 않는다. 가짜 s5 복사본의 DB와 합성 pink noise만 사용했으며 외부 음원/사용자 데이터는 사용하지 않았다. Next dev는 자기 소유 `127.0.0.1:43147`과 가짜 `DREAM_DATA_ROOT`만 사용했다.

## 시험과 diff 확인

| 독립 실행 | 결과 / 의미 |
|---|---|
| Vitest `t147-render-audio-ui`, `p2-4-render-panel`, `p2-4-render-t120` | **29/29 PASS**, 3 files. 신규 8개를 포함한다. |
| 변경 page/component/copy/시험 ESLint | exit 0 (`review-lint.log`) |
| `tsc --noEmit --incremental false` | exit 0 (`review-types.log`) |
| `npm.cmd run build` | exit 0, Next 운영 빌드와 verify-build 통과 (`review-build.log`) |
| 고정 snapshot 추적 파일 대조 | 정규화 내용 차이 0/551 |

작성자의 전체 640 PASS/17 skip은 인계 보고의 결과이며 이번 독립 실행으로 재표기하지 않는다. 이번 변경은 U1 UI이므로 전체 DSP/restore 회귀를 무조건 반복하지 않고, 실제 신규 렌더와 UI 연결의 누락을 보완했다.

기존 시험 기대값 변경은 saved DTO에 `audioMode/audioClips`를 추가하고, 무음 트랙/내보내기 잠금 문구를 새 동작에 맞춘 것이다. 기존 진행·취소·권한 제한 assertion을 지우지 않았다. 신규 시험은 AAC에 낡은 80%/ETA가 있어도 막대·예상시간을 숨기는 경우, none/unsupported saved 모드, accepted-null silent/too_short, null/NaN/Infinity, failed/late/missing/cleanup 상태를 검사한다. 실제 음량 기준(-14 I±1, TP≤-1)이나 sparseclick 실패 정책을 완화한 diff는 없다.

## 실제 Next → 서비스 → DB → renderer → 파일 재생

작성자의 esbuild 격리 fixture 검증과 구분하여 실제 Next 페이지를 열었다. 가짜 프로젝트 `019b8b74-3f10-7137-8265-68b11d809f0c`에서 서비스로 v1 무음과 v2 AAC를 저장하고, 실제 claim/runClaimedRender/자식 renderer/FFmpeg를 실행했다. 가짜 template snapshot은 현 메뉴로 맞추고 장면 2개×2초·텍스트 없음으로 준비했다. 실제 사용자 프로젝트 설정을 바꾼 것이 아니다.

| 직접 재현 | 관찰 및 근거 |
|---|---|
| 신규 무음 결과 | 4초 H.264 결과 성공, 0 audio streams. 실제 페이지의 무음 배지/해당 없음 표시 및 custom sound 버튼 0개 확인. |
| 신규 AAC 결과 `01a1e646-dd76-756c-9783-3834fc83bdc1` | 4초, AAC 1트랙, 실제 최종 측정 **-14.3 LUFS / -3.7 dBTP**가 화면에 연결됐다. 기준 문장은 측정값과 별도다. UI 주입 수치가 아니다. |
| saved DTO와 과거 결과 분리 | r3 AAC의 상단은 저장 소리 1개, 과거 r2는 무음으로 표시. 서비스로 r4 무음을 저장하니 상단만 무음으로 바뀌고 과거 AAC 표시는 유지됐다. 이후 서비스 restore로 r5 AAC 복원. |
| 실제 AAC compose | 실제 진행 중 페이지에 장면·글자·소리 합치기/음량 맞춤 포함 문구와 경과시간·시도 수가 보였다. 백분율/예상시간이 없는 실제 full-page snapshot은 `browser6.log`; 오래된 숫자 props 방어는 별도 자동시험이다. |
| 정상 재생 초기/재열기 | metadata readyState 4, duration 4, muted=true/paused=true/autoplay=false. 닫았다 열어도 같은 초기값. |
| 기기 소리 버튼 | 클릭 후 muted=false이나 paused=true 유지, aria-pressed=true와 끄기 문구로 전환. `video.muted=true`에 따른 실제 volumechange 이벤트 뒤 버튼도 켜기/false로 동기화. 이는 native 속성 이벤트 검사이며 OS 음량 UI 검사로 확대하지 않는다. |
| 키보드 재생 | native video에 초점을 두고 Space로 paused=false/currentTime>0. **390px에서도** muted=false, currentTime>0, error=null 확인. |
| 실제 파일 읽기 오류 | 페이지를 연 상태에서 자기 AAC 파일만 임시 rename, cache disabled로 새 요청. 서버 응답 **503**, native MediaError 4와 role=alert 안내 발생. 파일 복원 뒤 서비스의 succeeded/1 stream 유지 확인. renderer 실패로 바꾸지 않았다. |
| 실제 fileMissing | 자기 파일을 옮긴 채 페이지 새로고침: 파일 없음/원인 안내, 보기 버튼 0·download 0. 이후 원위치 복원. |
| 실제 canceledLate | 실제 worker의 no-replace link 직후 cancel hook으로 `01a1e64c-1af8-71b7-868c-d069b490f085` 생성. DB canceled/canceledLate=true, 실제 페이지 취소 뒤 끝남/보관 전용, 보기 0·download 0. 단순 DOM prop 주입이 아니다. |
| cleanup 경고 | 자기 성공 row의 cleanup_left만 합성 주입했다. 경고가 떠도 기존 실제 AAC의 보기/받기는 유지됐다. 실제 cleanup EBUSY 재현은 이번 UI 검수에서 하지 않았다. |

AAC MP4 SHA256 `e169f3d49154e5face7fdbf7f3686aaba50d7552b52f7da5e79076a498e87201`; 오류 주입 전후 동일. 무음 MP4 SHA256 `14cb78c5eb90d4708214b8e058039ab9535cacdaccfe6520c4a0e7863c6e3edf`. 소리 버튼은 파일을 다시 쓰지 않으며 기기 mute와 저장본 설명이 분리된다. sample/stale 표시, 자막 측정 전·휴대폰 확인 전, 최종 내보내기 잠금은 유지됐다.

## 화면, 근거와 제한

ego-browser TaskSpace24에서 실제 앱을 검수했다. `actual-desktop-results.png`(1280px), `actual-mobile-player.png`(390px)를 직접 열어 확인했다. 모바일 innerWidth390/scrollWidth375, video 폭 약301px로 가로 넘침 없이 native controls와 소리 버튼을 사용할 수 있었다. `mobile.png`는 390px 상단/결과 진입 화면이다. CLI 호출마다 기본 viewport가 복원되므로 이름만 mobile인 `mobile-player.png`/`mobile-file-error.png`를 모바일 증거로 세지 않았다. 실제 모바일 플레이는 `browser5.log`의 actual390과 대응 PNG에 근거한다.

전체 24 상태 조합·조건부 완료 focus·취소창 Esc는 작성자의 fixture 결과와 코드/기존 회귀시험을 대조했으며 이번 실제 앱에서 전 조합을 반복하지 않았다. 실제 unsupported-v1 loader 및 silent/too_short 신규 renderer 결과의 브라우저 통합은 미실행(자동 UI 시험만 통과). 실제 스피커 청취, 명료도, OS 음량, 실기기 휴대폰, 스크린리더, 200% 확대는 미검증이다. 합성 수치와 재생 성공만으로 청취 품질을 주장하지 않는다. U2 편집·저장 form과 U3 원본 미리듣기는 이번 범위 밖이다.

검수 harness의 첫 v1 저장은 v2 전용 key를 잘못 남겨 strict schema가 거부했다. explicit v1 payload로 고쳐 정상 저장/화면 확인했고 이를 제품 FAIL로 세지 않았다. 한 모바일 클릭은 고정 header의 pointer 가림으로 CLI가 중단됐다. 상태를 확인한 후 별도 navigation으로 검사를 이어갔으며 실패 호출을 통과 수에 넣지 않았다. dev의 C: 시스템 파일 watch EINVAL 경고는 있었으나 page/API/native renderer와 운영 build는 통과했다.

## 정리와 다음 조건

TaskSpace24는 finish keep[]로 닫았고, 자기 dev exec만 중단했다. native worker 3건/운영 build는 정상 종료, 43147 listen 없음 확인. 파일 rename은 모두 원상 복구했고 가짜 saved 상태도 AAC로 되돌렸다. 설치 도구 SHA 보존, 검수 worktree 제품 변경 없음 확인.

자기 temp의 node_modules/.tools/.next/ui-runtime/tmp 삭제는 자동 승인 검토가 `blocked by policy`로 거부했다. 우회 삭제하지 않았으므로 **가짜 DB·합성 음원·MP4·물리 사본 및 캐시가 위 OS-temp 경로에 남아 있다**. 프로세스는 종료됐고 사용자 DB/설치본에는 쓰지 않았다. 같은 경로에 `seed.mjs`, `late.mjs`, `save-none.mjs`, browser1~8.mjs/log, UI meta, 시험/build/lint/type 로그, source audit와 PNG를 보존하여 재현 가능하다.

판정은 U1 연결의 bounded PASS다. 필수 수정 요청 없음; Master 통합 후 U2/U3는 별도 담당/허용 범위로 진행 가능하다. 실제 청취/실기기 등 남은 항목은 완료로 표시하지 않는다.

복사용 전달 메시지: T147 7270d00 U1 독립검수 bounded PASS입니다. 관련 29시험/lint/type/build와 실제 가짜 프로젝트의 무음·AAC·commit후취소 renderer→Next/DB 연결, 실제 파일오류/누락 권한, 390px native mute·키보드 재생을 확인했고 필수 수정은 없습니다. 실제 음량 -14.3/-3.7과 파일 SHA 보존을 기록했으며 청취/실기기/스크린리더/200% 및 U2/U3는 미검증입니다. 자기 프로세스는 종료했고 자동 승인 검토가 temp 삭제를 거부하여 OS-temp 가짜 런타임은 남아 있습니다; 고유 보고서만 통합해 주세요.
