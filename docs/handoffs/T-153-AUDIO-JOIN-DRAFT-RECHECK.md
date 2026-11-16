# T153 곡 연결 초안 보존 집중 재검수

- **판정: bounded PASS — 원 F150-1(P1) 수정 확인, 이번 집중 범위의 필수 회귀 발견 없음.** U2/U3 전체·실기기·청취 완료를 뜻하지 않는다.
- 기준 `9127cf2023799561d0984f25fd52a3ebb4c20365`, `T-152-AUDIO-JOIN-DRAFT-FIX.md` 전문과 원 T150 보고서. 수정에 참여하지 않은 검수자가 수행했다.
- 반환은 이 고유 보고서만. 제품·DB 스키마·DSP·설치 도구·사용자 자료·공유 문서 변경 없음. T151 현재 문구는 그대로다.

## 고정 환경과 독립 실행

`git archive 9127cf2`를 OS-temp `C:/Users/Administrator/AppData/Local/Temp/dream-t153-review-f91e2e0fb2`에 풀었다. 물리 node_modules/도구 사본과 새 가짜 s5 DB, 로컬 생성 sine WAV만 사용했다. 이전 T150 seed 스크립트를 재사용하여 표시 이름은 `T150 배경곡 A/B/목소리`이지만 DB·asset/clip ID와 runtime은 이번에 새로 생성했다. 가짜 template snapshot만 현 메뉴에 맞추고 장면 2개×15초·텍스트 없음으로 준비했다.

자기 Next dev는 `127.0.0.1:43153`, 자기 `DREAM_DATA_ROOT`만 사용했다. 사용자3013 및 그 `.next`에는 접근·중단·쓰기하지 않았다. 개발 서버의 시스템 파일 watch EINVAL/고정 합성 이미지 decode 경고는 있었으며 이번 판정을 영상 미리보기의 시각 품질 검수로 확대하지 않는다.

| 독립 명령 | 결과 |
|---|---|
| `vitest run tests/t152-audio-join-draft.test.ts tests/p2-5u2-audio-editor.test.ts tests/p2-3b-timeline.test.ts --reporter=verbose` | **34 PASS**, 신규 7개 포함, 3 files |
| 변경 audio editor/helper/신규 시험 ESLint | exit0 |
| `tsc --noEmit --incremental false` | exit0 |
| 실제 Next 편집 페이지 | 관련 컴포넌트 컴파일·API·가짜 DB와 연결하여 아래 수행 |

운영 build/전체655시험은 T152 작성자의 자체 결과로 상속했으며 이번에 재실행하지 않았다. 의존성·라우트·스키마 변경 없는 집중 수정이라 전체 회귀와 T150 통과 경로 전부를 무조건 반복하지 않았다.

새 7개 중 5개는 순수 연산, 1개는 컴포넌트 **소스 문자열/함수형 갱신 가드**, 1개는 가짜 DB 저장/CAS 시험이다. 정적 가드는 실제 React 클릭·재렌더·remount의 자동 DOM 시험이 아니다. 별도 DOM 패키지를 추가하지 않고 실제 브라우저로 그 수명을 보완했다. 정상적인 순차 사용자 조작과 실제 응답 경합을 확인한 것이며 모든 React 동시 스케줄링을 증명한 것은 아니다.

## 원 F150-1 실제 재현 → 저장 → 재읽기

`browser2.mjs/log`는 실제 앱 form을 조작했다.

1. A/B 음악을 넣고 A 끝 서서히 `00:00.15`, A→B 1초 연결 미리보기를 연다.
2. 그 상태에서 A gain **-6**, A 라이선스 메모 **`F150-stale-plan-keep`**를 입력한다.
3. “이대로 연결” 적용 후 **gain -6/메모 그대로**, A 끝 서서히만0, B 시작9초를 확인했다. 원래의 gain0/빈 메모 소실은 재현되지 않았다.
4. 실제 `POST /timeline` payload·응답을 기록하고 r3 저장, 실제 GET 및 페이지 새로고침 후 다시 읽었다. **-6/메모/1초 join이 모두 보존**됐다. DTO를 주입한 정적 fixture 결과가 아니다.

수정 diff는 미리보기 state에서 전체 timeline을 제거하고 `JoinRequest`만 보관한다. 매 렌더 `joinPreview`로 최신 초안을 계획하고, 적용은 `setDraft(old=>applyJoin(old,…))`로 다시 계산한다. UI 실측과 이 원인이 일치한다. 이전 보고서의 FAIL을 삭제하거나 일반 안전 보장으로 바꾼 것이 아니라 이 원재현을 닫는다.

## 인접 변경·확인 수명·응답 경쟁

| 실제 수행 | 관찰 |
|---|---|
| fade 재확인 | 연결을 풀고 미리보기를 연 뒤 A 끝 fade를 0→15frames로 변경. “바뀐 값 확인” 1개/“이대로 연결” 0개, 최신 변경 목록과 안내가 나타났다. |
| start 재확인 | 위 재확인 뒤 A 시작을1초로 변경. 다시 확인 버튼만 나타나 B 시작9→10초 등의 새 목록을 제시했다. Enter로 재확인→Enter로 적용 후 A gain -6/권리 메모 보존, B10~20초 확인. |
| 추가·역할 변경 | 미리보기 도중 효과음을 추가하면 새 clip 선택으로 이전 inspector/미리보기가 해제됐다. 추가 clip gain -2와 effect→voice 변경 후 A/B 최신 시간·gain이 유지됐다. |
| 삭제·되돌리기 | 추가한 voice를 제거하고 A gain **-7**/rights **`keep-after-delete-undo`**를 고친 뒤 toast “되돌리기”. voice -2가 복구되고 A의 후속 두 값이 그대로였다. 전체 이전 초안으로 돌아가지 않았다. |
| 삭제된 대상의 계획 | 실제 선택 전환/추가/삭제로 inspector 수명이 바뀌면 미리보기를 재사용하지 않는 것을 확인했다. 대상이 없어진 최신 draft에서 apply를 거절하는 분기는 순수시험이다. 대상 삭제 후 같은 inspector가 살아 있는 특수 DOM 시험이라고 표현하지 않는다. |
| 미리보기에서 저장 중 join 적용 | 유효한 no-join 초안의 미리보기를 연 채 실제 POST r4를 보내고 **응답 반환만** browser fetch gate로 보류했다. 대기 중 연결 적용→겹침2초→gain -8/rights `join-later-during-save`/raw 시작 `00:0`/선택 B로 변경했다. 응답 뒤 join2초·gain -8·rights·raw/aria-invalid·선택 B와 미저장 안내가 모두 보존됐다(`browser4.log`, `own-response-latest.json`). POST1회, 저장 버튼 disabled. |
| 최신 응답·CAS·복구 | 다시 no-join 미리보기를 열고 r5 응답을 보류했다. 후속 join75frames/gain **-10**/rights **`newer-response-recovery-rights`**/raw `00:0`/선택 B를 만들었다. 별도 실제 HTTP writer가 r6을 저장해200, 그 전 revision으로 POST하면409였다. r5 응답 해제 뒤 화면은r6, 복구 영역으로 초점 이동, 다운로드한 실제 `actual-recovery.json`에 전체 후속 draft/75frame join/-10/rights/raw/선택 B와 ownSave r5/shown r6이 보존됐다. 최신 버전에 자동 덮어쓰기하지 않았다. |
| 응답까지 미리보기를 계속 열어 둠 | 별도 r7 시험에서는 대기 내내 “이대로 연결”이1개로 남도록 유지했다. 대기 중 gain **-11**/rights **`preview-stays-open-during-save`**/raw `00:0`을 입력. 응답/remount 뒤 값·선택 A는 유지되고 미리보기만 닫혀 target은빈값/적용버튼0이었다(`browser7.log`). 다시 곡을 골라야 하며 오래된 미리보기는 적용되지 않는다. |

응답 gate는 실제 서버 저장을 완료시킨 후 JavaScript에 Response가 돌아가는 시점만 보류한 검수 도구다. 제품 소스/응답 DTO를 바꾸지 않았다. 최신 버전 writer는 같은 페이지에서 별도 실제 HTTP 요청을 보낸 것이며 두 창 동시 UI 실행으로 부르지 않는다. Clipboard copy·업로드·native 숨김·기존 전체 렌더 시험은 이번에 재수행하지 않았다.

## 1280/390 좁은 키보드·화면 확인

ego-browser TaskSpace28에서 `reconfirm-1280.png`, `readonly-390.png`를 캡처하고 직접 열어 확인했다.

- 1280/scrollWidth1265: 최신 변경 목록·재확인 안내 읽힘, 확인 버튼 높이44px. 재확인/적용에 Enter를 사용하여 동작 확인.
- 390/scrollWidth375: 가로 넘침 없음, 보이는 소리 input/select0·연결 확인/적용 버튼0. 소리 목록/권리 보기와 원본 듣기 버튼44px 유지. 원본 듣기 Enter로 열린 native audio는 paused=true/autoplay=false였다.
- 실제 source의 T151 현재 설명(영상·글자만 무음, 원본은 아래에서 하나씩, 합친 소리는 렌더 결과)을 확인했다. DOM 문구 대체나 제품 파일 수정 없이 기준에 포함된 문구를 읽었다.

실기기·청취·스크린리더·200%·실제 탭 hidden은 T150에서 남은 그대로 미검증이다. U1/DSP/복원 독립 수치는 상속 근거이며 이번 연결 UI 재검수로 새로 실행한 증거가 아니다. 전체 U2/U3 완료를 선언하지 않는다.

## 원본·소스·정리

가짜 초기 r2 v1 `timeline_json` 문자열/SHA가 검수 후 정확히 동일했다(`original-v1-bytes.json`, SHA `9be8ae4119491a824f4cfefa57daafe59da7d431ca3032c18fdda9a4eb431918`). 기존 버전을 덮어쓰지 않았으며 사용자 DB는 사용하지 않았다.

검수 전후 설치본과 실행 사본 SHA256:

- FFmpeg `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`
- FFprobe `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`

이번에는 도구 변조/없음 시험 자체를 하지 않았다. 사본만 실행했고 설치본에 쓰지 않았다. 추적561파일 대조 결과 원시차495개에는 CRLF export 표현이 포함되며, 줄끝 정규화 뒤 차이는 Next dev가 생성한 `next-env.d.ts`의 `.next/types`→`.next/dev/types` import1파일뿐이다. 해당 자동 생성 환경 파일 외 구현 내용 차이0이며 전체 원시 바이트 동일을 주장하지 않는다(`review-audit.json`).

브라우저 TaskSpace28 finish keep[]와 자기 dev exec 중단 완료, 43153 listen 없음 확인. 3013/공유 `.next` 불변. 위 temp에 seed/UI meta/clip meta/browser1~7 스크립트·로그/실제 recovery JSON/관련시험·lint·type·audit·초기v1검증/PNG를 보존했다.

자기 `.next/node_modules/.tools`의 절대경로를 먼저 resolve하여 소유 temp 하위임을 확인했지만 삭제 명령이 **자동 승인 검토의 `blocked by policy`로 거절**됐다. 우회하지 않았으므로 물리 의존성·도구·캐시·가짜 DB/합성음원·증거가 위 경로에 잔존한다. 검수 worktree 수정은 이 보고서뿐이다.

다음 조건: Master가 F150-1 집중 수정 결과를 bounded 범위로 수용할 수 있다. T150의 실제 hidden 등 미검증과 U2/U3 전체 잔여는 별도로 유지한다.

복사용 전달 메시지: T153 원F150-1 집중재검수 bounded PASS입니다. 9127cf2에서 실제 미리보기→gain-6/권리 수정→적용→POST/GET·새로고침 보존, fade/start 재확인, 추가/역할/삭제되돌리기 최신값, 열린 미리보기의 지연응답/후속join·raw·선택·권리와 최신버전409·복구JSON을 확인했습니다. 관련34(신규7)/lint/type 통과, 실제1280/390·Enter 좁은 회귀도 통과했고 T151 문구 유지했습니다. 전체 build/전체시험·청취·실제hidden·실기기 등은 재실행하지 않았으며 U2/U3 전체 완료로 확대하지 않습니다. 고유 보고서만 통합해 주세요; 자기 서버/브라우저 종료, 자동 승인 삭제 거절에 따른 temp 잔존을 기록했습니다.
