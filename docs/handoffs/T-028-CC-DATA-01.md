# T-028 · 버전 비교 실패 상자의 기획·자료 링크 복구 (F-017-1, CC-DATA-01)

| 항목 | 내용 |
|---|---|
| 작업 ID / 상위 | T-028 / T-023 (R-017 F-017-1, F-016-1 잔여) |
| 지시 | Master `msg_e8d456c2825d`, 수락 회신 `msg_9c5197a1eb05` |
| 근거 | `p1-independent-recheck/docs/handoffs/T-027-INDEPENDENT-RECHECK.md` 83~89행 F-017-1 |
| 상태 | ready_review (자체 검증만 했어요. 독립 재검수와 브라우저 확인은 아직이에요) |

## 원인과 수정

- **원인:** 제가 T-023에서 쓴 `JobNotice`가 `!compact&&copy.links.length>0`일 때만 링크를 그렸어요. 버전 비교는 `compact`로 상자를 부르기 때문에 "기획 고치기"·"자료 바꾸기"가 늘 빠졌어요. 최근 시도가 성공으로 바뀌면 예전 거절 실패는 비교 영역에만 남는데, 그때 행동 링크가 하나도 없게 돼요.
- **수정 (`components/production-panel.tsx` 1줄):** `compact`이어도 `copy.links`를 그려요. compact 상자의 다른 모양(작은 h4, 코드 줄, 실패 버전 점선 테두리, "선택한 v{n}" 문구 없음)은 그대로예요.
- **CSS (`components/production-panel.module.css` 1줄):** `.compactLinks { gap:var(--sp-2); }`. 좁은 비교 칸에서 링크 사이 간격만 줄였어요. 글자 크기는 줄이지 않아 누르기 쉬운 크기를 유지해요.
- **그대로 둔 것:**
  - 거절에는 재시도 버튼이 없어요(`sceneErrorCopy` CONTENT_REJECTED `action:null`).
  - 실패 버전에는 "이 버전으로 되돌리기"가 없어요.
  - 기존 선택은 바뀌지 않아요.
  - 링크 주소(`/projects/{id}/plan`, `/library`)는 기본 카드와 같은 `linkHref`에서 나와요.

## 검증

| 명령 | 결과 |
|---|---|
| `tests/production-panel-render.test.ts` (새, 2검사) | 실제 서비스 데이터로 `ProductionPanel`을 `react-dom/server`에서 HTML로 그려 확인했어요(OS 임시 fixture, mock 제공자). **수정 전 코드에서는 2검사 모두 실패, 수정 후 통과**를 직접 확인했어요 |
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| `npm test` | 26파일 223검사 통과 |
| `npm run build` | 종료 0, 경고 0, 로컬 데이터·비밀 추적 없음 (다른 dev 서버 유지, `.next` 삭제·이동 없음) |

새 테스트가 확인한 것:
1. **v1 성공(선택) → v2 거절 → v3 성공:** 거절 상자는 비교 영역(`<details>` 뒤)에만 1개 있어요. 그 안에 `href="/projects/{id}/plan"` "기획 고치기"와 `href="/library"` "자료 바꾸기"가 있고, "자동 재시도 안 함"이 나오고, 버튼은 없어요. 화면 전체에 "다시 시도" 버튼이 없어요. "이 버전으로 되돌리기"는 선택 안 된 성공 버전(v3) 1개에만 있어요. 선택은 v1 그대로이고, 거절 작업의 수동 retry는 거절돼요.
2. **v1 성공(선택) → v2 거절(최근):** 기본 카드와 비교 영역, 두 상자 모두 두 링크가 있어요. 기본 카드에는 "선택한 v1은 그대로예요."가 나오고, 다시 시도 버튼은 없어요.

## 하지 않은 것·한계

- **브라우저로 직접 확인하지 않았어요.** 키보드로 비교 영역을 열어 링크로 이동하는 것과 1280·390 배치는 확인하지 않았어요. 서버 렌더 HTML로 마크업만 확인했어요. Master가 요청할 독립 재검수 범위예요.
- F-016-2·V13은 다시 하지 않았어요(지시 범위).
- 공용 TEAM·REVIEW·PLAN, 다른 서비스, 실제 데이터는 바꾸지 않았어요.
