# T-078 · 독립 최종 CRLF 재검수

- **판정: PASS — F076-1 해소.** T077 구현에 참여하지 않은 Codex 작업자의 독립 검수다.
- 기준 HEAD: `235055adf6927f17b460e82f1a7c3aa95111a37b`; 제품 기준 `3e24c713cdd7773825bd1f5d58b32373dce5b872`와 제품 diff 없음.
- 일시: 2026-11-16 Asia/Seoul. task `task_d1369b0aa645`, dispatch `ctx_2d11df377bc8`.
- 작업 위치: 새 child `C:/Users/Administrator/orca/workspaces/dream-ai-studio/p2-2-crlf-recheck`. 최초 git status clean. 허용/실제 추적 파일 변경은 이 보고서 하나이며 공용 문서·제품·시험·fixture 수정, commit/push 및 하위 작업자는 없다.
- AGENTS, AI_TEAM_RULES, CLAUDE, PLAN, REVIEW, TEAM, docs/team 역할 지침, T073/T076/T077을 확인했다. Orca orchestration 스킬의 worker 완료 절차를 적용했다.

## 1. 변경 검토와 원본 보존

`git show 235055a --stat`은 T077 고유 보고서 및 `tests/p2-2-preview.test.ts` 두 파일만 보인다. `git diff 3e24c71 235055a -- tests/p2-2-preview.test.ts`의 실행 코드 변경은 마지막 오류 fallback 시험의 `readFileSync(...,"utf8")` 결과에 `.replace(/\r\n/g,"\n")`를 적용한 한 줄뿐이다(설명 주석 추가). 파일 자체나 제품의 줄바꿈을 바꾸지 않는다.

기존 assertion은 모두 동일하다: null fallback 두 형태 금지, `PlayerFailed`의 effect 내 `onFailed()` 호출과 dependency 검사, `errorFallback={fallback}` 및 `onFailed={failed}` 연결 검사. 시험 삭제·skip·기대값 완화 없음. `git diff --exit-code 3e24c71 235055a -- app components lib worker package.json package-lock.json migrations` exit0; 전체 변경 목록도 문서와 위 시험 외 제품 변경이 없음을 확인했다.

원본 `components/player/player-panel.tsx`의 읽은 실제 문자열을 Node로 집계했다. 실행 전후 모두 **CRLF 146개 / LF-only 0개**다. 종료 시 파일 SHA256은 `d64a0bc3acc97452323eaeaa84901fffdfc10b9f6166a30cd2cd57c868df9de4`. 원본을 LF로 바꿔 통과시킨 것이 아니다.

## 2. 이번 실제 실행

증거 E = `C:/Users/ADMINI~1/AppData/Local/Temp/dream-t078-evidence`.

시험 프로세스 환경은 `$env:DREAM_DATA_ROOT=$null`로 unset하고, `FFMPEG_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffmpeg.exe`, `FFPROBE_PATH=D:/starwork/dream-ai-studio/.tools/ffmpeg/ffprobe.exe`로 지정했다. 해당 실행 파일은 실행/읽기 용도만 사용했고 수정하지 않았다. S4/S5 생성 모드를 켜지 않았다.

| 실행 | 실제 결과 |
|---|---|
| `npm.cmd ci` | exit0, 267 packages 설치, 19초; audit 7 moderate 보고, dependency 수정 없음 |
| `npm.cmd test` | exit0, **36 files PASS / 425 passed / 2 skipped (427)**, 19:37:07 시작, 25.33초, E/full-test.log |
| `npm.cmd test -- tests/p2-2-preview.test.ts` | exit0, **13 passed**, 19:37:33 시작, 230ms, E/focused-test.log |
| 임시 사본에서 effect 제거 후 같은 집중 명령 | 기대한 exit1, **12 passed / 1 failed**, E/mutation-test.log |

2 skips는 `tests/s4-fixture.test.ts:28`과 `tests/s5-fixture.test.ts:39`의 `describe.runIf(process.env.S4_WRITE/S5_WRITE==="1")` 고정 백업 생성 시험이다. 생성 모드를 활성화하지 않았으므로 고정 fixture를 다시 쓰지 않는다. 전체 결과는 요청한 425 PASS / 2 generation skips와 일치한다.

Mutation은 git 추적 파일을 바이트 복사한 OS-temp `C:/Users/ADMINI~1/AppData/Local/Temp/dream-t078-mutation-1794825450833`에서만 수행했다. 그 사본의 node_modules junction은 이번 child 설치본을 가리킨다. `PlayerFailed`의 `  useEffect(()=>{onFailed();},[onFailed]);`가 정확히 1회인지 확인한 뒤 그 한 줄 내용만 제거했다. CRLF 원본의 다른 내용은 그대로 복사했으며, 해당 오류 fallback 시험이 `tests/p2-2-preview.test.ts:100`의 정확한 effect substring assertion에서 실패했다. 따라서 정상 CRLF 통과가 의미 검사 무력화 때문이 아님을 확인했다. 원본 제품/시험에는 mutation을 적용하지 않았다. 증거와 임시 사본을 보존했다.

## 3. 상속 근거와 한계

제품이 3e24c71 이후 바뀌지 않아 불필요한 browser/full build/lint/typecheck 재실행은 하지 않았다. 다음은 **이번에 새로 실행한 결과가 아니라 기존 독립 근거 상속**이다.

- T073 (`ad0501b`): 광범위 runtime, 실제 MP4/trim, scene0, buffering/font, preview-only DB/API 불변, P1/CAS 및 lint/typecheck/build. 최초 Player 실패 F073-1은 당시 FAIL이었고 후속 T076 근거로 해결 여부를 구분한다.
- T076 (`3e24c71`): 최초/비율 remount/실패 재시도/복구, 오류 중 실제 저장, focus, preview-only 요청0과 모든 표 의미불변, 개발 모드 부모 render-state 경고0, T074 양폭 표시/안전영역/모바일 안내 및 lint/typecheck/build PASS. 당시 전체 시험 424 PASS/1 FAIL/2 SKIP의 유일한 F076-1을 이번 실제 CRLF 425 PASS로 닫는다.
- 실제 휴대폰·스크린 리더·실제 hidden 탭·초기 font-checking 장기 지연 등 T073/T076 미확인 범위는 그대로이며 새 PASS를 부여하지 않는다. 사용자/디자인의 최종 게이트도 대신하지 않는다.

실제 사용자 데이터/운영 서버에 접근하거나 서버를 시작·종료하지 않았다. 실행 후 git status는 보고서 작성 전 clean이었고, 보고서 작성 후 이 파일 하나만 새 파일이다. npm ci의 lock 변경도 없다. 미구현 또는 이번 검수의 필수 수정 요청은 없다. Master는 본 PASS와 T073/T076의 명시된 범위별 근거를 합쳐 다음 게이트를 판단할 수 있다.

## 플래너·Master에게 복사할 메시지

> T078 독립 최종 CRLF 재검수 PASS입니다. 기준235055a의 원본 player-panel은 CRLF146/LF-only0을 유지했고 npm ci 후 전체425 PASS/2 generation skips, 집중13 PASS를 직접 확인했습니다. T077은 읽은 문자열의 CRLF만 정규화하며 기존 assertion을 유지하고, 임시 사본의 effect 제거는12 PASS/1 FAIL로 정확히 검출했습니다. 제품3e24c71 이후 변경이 없어 browser/build/lint/typecheck는 T073/T076의 명시된 독립 근거를 상속하며 기존 미확인 및 최종 사용자/디자인 게이트는 유지합니다. 이 문구는 복사용이며 실제 완료 통지는 별도 Orca worker_done 영수증으로 구분합니다.
