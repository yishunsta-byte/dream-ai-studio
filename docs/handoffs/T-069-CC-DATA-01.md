# T-069 F065-1 수정 — P1 호환 읽기·복원 정합성 (CC-DATA-01)

- 지시: Master `msg_f961f22f6419` (T-065 독립 검수 FAIL F065-1)
- 기준: `docs/handoffs/T-065-P2-1-INDEPENDENT-REVIEW.md` 20~52행

## 1. 원인

P1에서 옮긴 r1(`source=p1-migration`)을 P1 스냅샷으로 읽을 때 **글자와 content_revision만** 출처와 비교했어요. 해시까지 맞춘 r1의 장면 순서(`video`)가 달라도 통과해 옛 `sceneOrder`로 바꿔 보여 줬고, stale은 장면별 비교라 빈 배열이었어요. 복원·이관 뒤 검사(`checkTimelineRows`)도 스키마·정규화·해시·포인터만 봤어요.

## 2. 고친 것

| 파일 | 내용 |
|---|---|
| `lib/db/timeline-data.ts` | `checkP1MigratedRow` 추가 — 옮긴 r1을 **출처 스냅샷이 정하는 모든 값**과 대조: 자기 프로젝트 키(`project.{id}.edit.{uuid}`), 0005가 키로 만드는 행 id(`row:`+키)와 클립 id(`clip:`+키+`#`+장면), revision 1·되돌리기 출처 없음, content_revision·created_at, 프로젝트 비율, 오디오 없음, 글자(spec 규칙으로 옮긴 값), **장면 순서**(스냅샷 순서의 장면이 먼저 같은 순서로, 0005가 뒤에 붙인 장면은 그 뒤). 지금 선택과 무관한 값만 보므로 나중에 선택이 바뀌어도(stale) 정상 행은 통과해요. `checkTimelineRows`(이관 뒤·복원 뒤 검사)와 `verifyTimelineMigration`(0005 검사)이 같은 함수를 써요 |
| `lib/services/timeline.ts` | `editView`의 P1 분기가 같은 검사를 거쳐요. 다르면 `STAGE_LOCKED` "옮긴 타임라인이 원래 글자 설정과 달라요(글자·장면 순서·클립). 데이터 상태를 확인해 주세요."로 **거부**(옛 순서로 바꿔 보여 주지 않음) |
| `lib/services/exports.ts`, `components/exports-panel.tsx` | 내보내기 미리보기가 이 오류를 삼켜 "글자 설정을 저장하면…"으로 보이던 것을 고쳐, 거부 이유(`timelineError`)를 그대로 보여 줘요 |

정상 r1은 바뀐 것이 없어요 — P1 스냅샷 그대로 읽어 묶음 글자·SRT 바이트가 P1과 같아요(기존 시험 + 새 시험 1번).

## 3. 검증 (가상 사본만, OS 임시 폴더)

새 시험 `tests/p2-1-f065.test.ts` (5개):

1. 정상 s5 r1: 검사기 통과, `editView` = P1 스냅샷 보기, SRT `00:00:00,125`.
2. ~4. s5 사본에서 r1을 바꾸고 **JSON·canonical 해시를 함께 맞춘 뒤 원래 guard SQL 복구**(`sqlite_master` 전후 같음 확인) — ② 장면 순서만 거꾸로(검수 재현과 같음) ③ 순서 같고 클립 id 하나만 다름 ④ 세 번째 장면을 맨 앞으로. 셋 다: 검사기 `P1SourceMismatchError`, `editView` 거부, 검수 승인 거부, 내보내기 만들기 거부(그 사본에서만 검수 승인 상태로 바꿔 확인), 미리보기는 거부 이유 표시, 편집 화면 저장 SRT 미리보기 없음, DB 내용 그대로.
5. **검수 재현 그대로**: 순서를 바꾼 s5 사본의 DB 해시·크기를 manifest에 반영해 새 ZIP을 만들고, 제품 5단계 가상 원본에 등록해 실제 `restoreService.inspect`+`finish` → `RESTORE_INVALID`로 거부, 목적지 DB 생기지 않음, ZIP 그대로.

전체: `npm.cmd test` 35개 파일 412 통과 / 2 건너뜀(생성 전용), lint 0건, typecheck 통과, `npm.cmd run build` 통과. 정상 r1/r2·묶음(ZIP 글자·SRT)·복원 same/upgrade·s4→s5 이관 시험은 기존 그대로 통과. 시험 시작·끝에 s4.zip·s5.zip 해시 같음 확인.

## 4. 바꾸지 않은 것

등록된 0005 원문·SQL 1~4·고정 s4/s5·실제 사용자 데이터, 공용 문서, 패키지, Remotion 관련 코드.

## 5. 남은 점

- 편집 화면은 저장된 타임라인을 프레임 경로로 그대로 보여 줘요(이 경우 순서가 바뀐 그대로). 검수·내보내기는 거부되므로 바뀐 내용이 P1로 묶이지 않아요. 편집 화면에서 다시 저장하면 사용자 행(r2)이 되어 일반 규칙을 따라요.
- 0005가 뒤에 붙인 장면들(스냅샷 순서에 없던 장면)끼리의 순서는 그때의 장면 위치에 따른 것이라 나중에 다시 계산할 수 없어 대조하지 않아요. 그 장면들의 클립 id는 키로 대조해요.
