# T147 · U1 오디오 렌더 UI 연결

| 항목 | 내용 |
|---|---|
| 담당 / 상태 | Codex design · CX-DESIGN-01 / **ready_review**, 작성자 자체검증. 독립검수 아님 |
| 날짜 / 기준 | 2026-11-17 Asia/Seoul / `4ca29e836d4a6c2877767d3403959935dcce2ed2` |
| 배정 | Master `msg_0b82aabb45c7` “T146검토완료 U1구현”, 수락·파일범위 전송 `msg_7418e44528b3` |
| 기준 명세 | `T-146-AUDIO-UI-CONNECTION.md` U1, 현재 RenderView와 저장본 timeline |

## 결과와 변경 범위

AAC 렌더를 무조건 소리 없는 영상/준비 중으로 설명하던 화면을 실제 서버 상태에 연결했다. **제품4파일·기존시험1파일·새시험1파일·이 보고서**만 변경한다. DSP, API, DB, 서버 저장/취소/파일 권한, 편집 form, Player, T125, 공유 상태·배포는 변경하지 않았다. 기존 미추적 T122/T137 문서는 보존했다.

| 파일 | 최종 동작 |
|---|---|
| `app/(studio)/projects/[id]/render/page.tsx` | 저장본 `editing.base`에서 audioMode/clipCount를 파생해 직렬화 가능한 SavedRenderTimeline 전달. 저장본과 과거 결과·기기 mute를 분리. 소리 있는 v1은 unsupported |
| `components/render-panel/copy.ts` | AAC 단계명/live/준비·합치기·검사 문구. 결과의 트랙·신호·음량 판정을 구분하는 순수 helper |
| `components/render-panel/render-panel.tsx` | AAC compose의 progress/ETA 숨김, 상태별 결과·측정값·접힌 기준/profile/tool, cleanupLeft 비차단 경고, 결과 재생의 기기 음소거 버튼/안내 |
| `components/render-panel/render-panel.module.css` | 기존 토큰만 사용하는 세부 정보/경고 스타일. summary 최소44px |
| `tests/p2-4-render-panel.test.ts` | 새 저장본 DTO와 사실에 맞게 바뀐 기존 문구 기대값 |
| `tests/t147-render-audio-ui.test.ts` | 아래 불변조건 회귀8개 |

AAC는 기존 prepare/compose/verify 키를 유지한다. compose progress가 null이거나 잘못 남은 프레임 퍼센트가 있어도 막대/ETA를 표시하지 않는다. 경과 시간·시도 횟수는 남긴다. 무음 작업의 기존 프레임 퍼센트는 유지한다. 대기/취소 문구 우선순위와 단계 변경당 live·완료당 Toast/조건부 초점 이동을 유지한다.

성공·verify passed·AAC1트랙에서 normalized/accepted true/유한한 실제값일 때만 “음량 기준 충족”을 표시한다. silent/too_short의 accepted null은 정상 성공으로 재생·받기가 가능하고, 무음 신호/3초 미만·음량 맞춤 미적용으로 설명한다. none은 소리 트랙 없음·음량 맞춤 해당 없음, 기록 없거나 검사 전이면 측정 전/기록 없음이다. null/NaN/Infinity를0이나 목표값으로 만들지 않는다. 측정값과 기준은 별도 문장이다. 실패에는 음량 성공배지나 없는 측정값을 만들지 않는다.

“영상 보기”는 재생 영역만 연다. 매번 muted/paused로 시작하며 사용자 동작의 “이 기기에서 소리 켜기”는 video.muted만 바꾼다. native 음소거 조작도 volumechange로 상태를 동기화한다. 닫으면 video가 해제되고 다시 열면 muted로 시작한다. 실제 재생은 native control에서 시작한다. 재생 파일 오류는 기기에서 열지 못했다는 안내로 표시하며 renderer 상태를 바꾸지 않는다. 소리 없는 결과에는 추가 음소거 버튼을 만들지 않는다.

late/fileMissing은 기존 usable 조건대로 재생·받기 불가다. stale/sample 표시, 기존 편집용 ZIP·최종 내보내기 잠금, subtitleMeasure/phonePlayback 미확인도 유지한다. 소리 편집·자막 등 남은 단계의 확인이 필요하다는 내보내기 문구만 수정했다.

## 실행 검증

| 명령 / 방법 | 실제 결과 |
|---|---|
| `npm.cmd exec vitest run -- tests/t147-render-audio-ui.test.ts tests/p2-4-render-panel.test.ts tests/p2-4-render-t120.test.ts` | **29 PASS**, 새8개 포함 |
| `npm.cmd test` | **640 PASS / 17 skipped**, 56파일 통과·2파일 skip, 약64초. skipped native/E2E를 새 통과로 세지 않음 |
| `npm.cmd run lint` | exit0, 경고0. 브라우저 fixture 생성 뒤 최종 재확인도 exit0 |
| `npm.cmd run typecheck` | exit0 |
| `npm.cmd run build` | 최종 exit0, Next16.4.6 운영 빌드와 verify-build 통과 |
| `git diff --check` | exit0 |

처음 PowerShell의 npm.ps1 실행 정책 차단은 npm.cmd로 실행해 해결했다. 첫 운영 build는 ignored tmp의 검증 fixture.tsx까지 타입 검사해 fixture의 느슨한 타입 때문에 실패했다. 제품 설정을 바꾸거나 검사를 끄지 않고, 검증용 JS fixture를 `.jsx`로 옮긴 뒤 같은 운영 build가 통과했다. 제품 타입 오류를 숨기기 위한 변경은 없다.

새 자동 회귀는 AAC의 오래된 progress/ETA 유입에도 불확정 유지, 준비/검사/대기/취소 우선순위, 저장본 모드와 과거 행 분리, 실제 음량/기준 구분 및 실패 허위표시 방지, silent/too_short 정상 이용, null/비유한값 방어, none·cleanup·late·missing·잠금 보존을 확인한다.

## 브라우저 자체확인

ego-browser 스킬의 v2.2.1 절차로 TaskSpace23을 사용했다. **실제 제품 RenderPanel/ToastProvider/스타일을 esbuild로 불러온 격리 페이지**이며 Next navigation/Link는 fixture용 대체다. 127.0.0.1:3147에만 바인딩했다. 데이터는 상태별 주입 값이며 사용자DB/프로젝트/워크플로/API를 쓰지 않았다. 따라서 실제 saved loader→DB→renderer 전체통합 통과는 아니다.

- 1280/390 × normalized/silent/too_short/none/기록없음/failed/late/fileMissing/cleanup/compose/prepare/verify = **24조합**. 제품 panel의 가로 넘침0, visible button/link/summary 최소높이44px, 이름 없는 조작0. AAC prepare/compose/verify progress막대0.
- normalized/compose를 두 폭에서 캡처했고 실제 PNG를 열어 가독성/줄바꿈/진행 카드를 확인했다. 기존 token/반응형을 유지한다.
- 합성4초 H.264/AAC 파일을 native video로 열어 metadata·readyState를 확인했다. 열기 직후 paused=true/muted=true/autoplay=false. 소리 켜기 Enter 후 paused=true/muted=false, 버튼은 소리 끄기로 바뀜. 닫았다 다시 열면 paused=true/muted=true.
- 390에서 사용자 키보드 동작으로 native 재생 시작: paused=false/muted=false/currentTime>0/error=null. 닫기 뒤 video 없음. **디코딩/재생 상태 검증이며 실제 스피커 청취/음질·음량 검수가 아니다.** UI에 주입한 -14.3/-3.7은 이 합성 파일을 측정한 수치가 아니다.
- 단계→성공 prop 전환: 카드 밖 초점 `outside` 보존, 진행 카드 내부 초점만 `render-audio-result` 제목으로 이동. 취소창 Enter로 열기→“계속 만들기” 초점, Esc 닫기→“취소” 초점 복귀. 소리 확인 details도 Enter로 열렸다.

로컬 비버전 증거는 `tmp/t147-ui/`에 남겼다: `matrix.json`, `interaction.json`, `keyboard.json`, `playback.json`, `normalized-{1280,390}.png`, `compose-{1280,390}.png`, fixture 빌드/서버와 실행 round*.mjs. 브라우저 첫 pointer 호출은 자동 스크롤 위치 판정 오류, 첫 상태 선택은 지원하지 않는 불완전 role locator 오류로 중단됐다. 당시 상태를 snapshot으로 확인하고 명확한 CSS/이름 selector 및 키보드로 후속 확인했으며 두 중단을 성공횟수로 세지 않았다.

검증용 MP4는 설치 FFmpeg를 자기 tmp에 물리 복사해 lavfi color+sine으로 생성했다. 원본/사본 SHA256은 둘 다 `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`이었다. 설치본 수정·새 설치·외부 음원/사용자 미디어 사용 없음. 작업 후 TaskSpace23은 finish keep[]로 닫고 fixture 서버는 소유한 exec 세션만 중지했다.

## 미구현·검수 요청

U2 편집 form/목록·복구, U3 원본 미리듣기, 통합 초안 mix preview는 이 배정 밖이다. 기존 edit Player의 무음 전용 설명도 U2/U3에서 실제 지원범위에 맞춰 연결해야 한다. 실제 AAC renderer 신규 실행·음질/청취·실제폰·스크린리더·200%·네트워크 재생실패는 이번에 검수하지 않았다. native 파일 오류 안내는 구현됐지만 실제 실패 주입 브라우저 검수는 하지 않았다. T144 bounded DSP/복원 검증을 U1 청취/전체P2 완료로 확대하지 않는다.

Master께 별도 담당의 U1 검수를 요청한다. 특히 저장본 DTO의 실제 서비스 연결, 실제 기존/새 AAC 결과의 표시와 native mute 동기화, late/fileMissing 권한 유지, 네트워크 실패 및 390 재생을 대조해 주시기 바란다. U1 검수 뒤 U2/U3를 단일 작성자·허용파일로 배정하면 된다. 추가 사용자 승인 대기는 필요 없다.

복사용 전달 메시지: T147 U1 ready_review 반환합니다. 저장본 audio DTO, AAC 불확정 진행/ETA 숨김·소리 포함 단계/live, normalized/silent/too_short/none/null/실패 표시, 실제 측정/기준 구분, 기기 mute와 native 재생 안내, cleanup 경고를 구현했습니다. 관련29·전체640/17skip·lint/type/build 통과. 격리 실제컴포넌트24조합(1280/390) overflow0/조작44px·native 합성AAC 재생·재열기mute·조건부초점·취소Esc 자체확인했습니다. 사용자DB/실제renderer/스피커청취/실기기/배포 검수는 아닙니다. 제품4+시험2+고유보고서만 선택커밋, 기존T122/T137 보존. 독립U1검수 후 U2/U3 배정 부탁드립니다.
