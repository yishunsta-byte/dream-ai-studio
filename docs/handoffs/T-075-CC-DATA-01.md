# T-075 F073-1 수정 — 최초 Player 오류가 빈 무대로 숨겨지던 문제 (CC-DATA-01)

- 지시: Master `msg_fa5a95a95e6f`, 기준 `docs/handoffs/T-073-PLAYER-INDEPENDENT-REVIEW.md` 7장
- 바꾼 파일: `components/player/player-panel.tsx`, `tests/p2-2-preview.test.ts`, 이 보고서. T-074 가독성 값 그대로. API·DB·스키마·패키지·공유 문서·고정 fixture 변경 없음

## 1. 원인과 수정

- 원인: Player 오류를 부모의 `useEffect` 이벤트 구독(`error`)으로만 받았다. 처음 띄울 때·비율을 바꿔 다시 그릴 때·다시 불러오기 때 생기는 그림 단계 오류는 그 구독보다 먼저 나서 사라지고, `errorFallback`은 `()=>null`이라 빈 무대와 켜진 재생 버튼만 남았다.
- 수정: `errorFallback`이 `PlayerFailed`를 그린다. 이 부품은 **effect에서** 패널의 `failed()`(=`setStatus("error")`)를 부르고(그림 중 부모 상태 변경 없음) "미리보기를 띄우지 못했어요."를 `role="alert"`로 보인다. 패널은 오류 칸(Callout + "미리보기 다시 불러오기")으로 바꾸고 재생·1/30초 버튼을 끈다. 실행 중 오류의 기존 이벤트 경로는 그대로.
- 초점: 다시 불러오기 → 성공하면 새 무대로, 또 실패하면 다시 불러오기 버튼으로. 비율을 바꾸다 실패하면 누른 비율 버튼에 남음(재시도로 보지 않음).
- 회귀 시험 1개(`p2-2-preview` 13번째): 대체 화면이 `()=>null`이 아니고, `PlayerFailed`가 effect로 알리며, Player·StageView에 연결됨(소스 검사 — 시험 환경이 node라 DOM 그리기 시험은 하지 않음).

## 2. 확인

- 원본 저장소: `npm.cmd test` 36개 파일 **425 통과 / 2 건너뜀**, lint 0, typecheck, build 통과.
- 고장 주입(T-073 7장 방식): OS 임시 폴더에 소스 사본(추적 파일, node_modules 복사 — Turbopack이 바깥 연결을 받지 않음)을 만들고 **사본의** `timeline-composition.tsx` 맨 앞에만 `sessionStorage "t075-player-fault"==="1"`이면 throw 한 줄을 넣어 production build·`next start 127.0.0.1:3061`. 데이터는 s5 고정 백업을 다른 임시 폴더에 푼 사본. 끝나고 둘 다 삭제. 다른 파일은 원본과 `cmp` 같음.

| # | 경우 | 결과 |
|---|---|---|
| A | flag 0 | 정상 무대, 글자 1, 재생 버튼 켜짐 |
| B | flag 1로 페이지 새로 열기(최초 마운트) | 오류 안내 + 다시 불러오기, 무대 없음, 재생 버튼 꺼짐 |
| C | flag 1인 채 다시 불러오기 | 또 오류 안내 유지, 초점 = 다시 불러오기 |
| D | flag 0 뒤 다시 불러오기 | 복구(무대·글자), 초점 = 무대 |
| E | flag 1 뒤 16:9(비율 재마운트) | 오류 안내 + 다시 불러오기, 재생 버튼 꺼짐, 초점 = 16:9 버튼. flag 0 뒤 다시 불러오기 → 16:9 그대로 복구 |
| 390 | flag 1 최초 | 오류 안내 + 다시 불러오기, 가로 넘침 0 |
| 편집·저장 | 오류 중 글자 고침 → 저장 | 저장 동작(사본에 r2), 저장 뒤 새 화면에서도 flag 1이면 오류 안내 유지, flag 0 뒤 복구 |
| 읽기 전용 | A~E·390 동안 | fetch·XHR 쓰기 0, DB 모든 표 행 수+해시 전후 같음(저장 시험 전) |

- console.error에는 주입한 `T075_PLAYER_FAILURE`만 기록. production 빌드라 React 개발 경고(그림 중 상태 변경 경고 등)는 나오지 않으므로 이 방법으로는 확인할 수 없음 — 코드상 부모 상태 변경은 effect에서만 함.
- 캡처 `tmp/t075-evidence/` 5장: 최초 실패 1280·390, 복구, 비율 재마운트 실패, 저장 뒤 실패 유지.
