# T-119 렌더 취소 확인 문구 · 영상 대기 표시(R-16) — CC-DATA-01 반환

- 담당: CC-DATA-01 · 지시: Master msg_91754c812b94 (+ 정정 msg_0dfe0d109bb9, msg_7b9fdbed008b)
- 기준: c7f7774(T-120) 위 별도 커밋. 백엔드·DB·API·worker·migrations·packages·전역 스타일은 바꾸지 않았어요.
- 상태: 자체 검수 완료(독립 검수 아님). 디자인 검수는 Codex design(CX-DESIGN-01)에 요청해요.

## 1. 바꾼 내용
| 항목 | 내용 | 파일 |
|---|---|---|
| 공용 확인창 | `ConfirmPanel`에 선택 prop `closeLabel`(기본 "취소" 그대로). 기존 사용처(자료 보관함·UI 갤러리)는 바뀌지 않아요 | `components/ui/interactive.tsx` |
| 렌더 취소 확인 | 닫기 "계속 만들기"(처음 초점) / 위험 "취소하기" | `components/render-panel/render-panel.tsx` |
| 대기 표시 | `renderWait(jobs, jobId)`: 서버가 준 값만 사용 — `status==="queued"`, `kind!=="render"`, `blockedBy==="render"`일 때만. 링크는 같은 목록의 실행 중 render 작업 projectId로만 만들고, 없으면 링크 없이 문구만(추측 없음). 문구 "영상 만드는 중이라 기다려요. 영상이 끝나면 이어서 시작해요." + "영상 만들기 진행 보기"(다른 프로젝트면 이름 붙임) | `components/render-panel/render-wait.tsx`(새), `render-panel.module.css`(`.wait`, `.waitLink`) |
| 연결 | 작업 대기열·장면 제작·내보내기 화면. 작업 대기열은 받은 목록을 그대로, 나머지 두 화면은 대기 작업이 있을 때만 기존 `/api/jobs`를 2초마다 읽어요(새 API·서비스 없음) | `jobs-panel.tsx`, `production-panel.tsx`, `exports-panel.tsx` |
| 작업 대기열 render 행 | 종류 라벨 "음성"으로 잘못 나오던 것을 "소리 없는 영상"으로, 링크 "영상 만들기로 가기 →"(`/projects/{id}/render`) | `jobs-panel.tsx` |
| 재생 버튼 이름 | 누르면 플레이어만 펼치고 자동 재생하지 않으므로 "재생/재생 닫기" → "영상 보기/영상 닫기"(Master 허용 항목) | `render-panel.tsx` |

초점 로직은 바꾸지 않았어요(정정 지시대로). 공용 Button disabled 이유 aria 등 전역 수정도 하지 않았어요.

## 2. 검증
- vitest 556 통과 + 13 skip. 새 `tests/p2-4-render-wait.test.ts` 5개(ConfirmPanel 기본 "취소"·closeLabel, renderWait 조건 6가지·링크 없음 경우, 문구·링크·다른 프로젝트 이름, JobsPanel 정적 렌더: 대기 안내 1개·render 링크·"소리 없는 영상"). `p2-4-render-panel` 에 "영상 보기" 확인 추가.
- lint·tsc 통과, 운영 빌드(복사본) 통과, nft 37개 렌더 도구·로컬 데이터 추적 0.
- 실제 브라우저(ego, 가상 s5 사본 + 복사본 dev :3119 + 저장소 worker로 **실제 렌더 실행 중**), 증거 `tmp/t119-evidence/*.png`:
  - API 값: `[render running, image queued blockedBy "render"]` 일 때 장면 제작·작업 대기열 화면 모두 안내와 링크 `/projects/{id}/render` 표시. 1280·390 모두 가로 넘침 없음(`scrollWidth` 1265/390). (`10-produce-*`, `11-jobs-*`)
  - 키보드: 작업 대기열에서 Tab 33번에 "영상 만들기 진행 보기", Enter로 렌더 진행 화면 이동.
  - 취소 확인(1280·390): Tab으로 "취소" 버튼 → Enter → 대화상자 열림, 초점 "계속 만들기", 버튼 ["계속 만들기","취소하기"]. Escape → 닫히고 초점이 "취소" 버튼으로 복귀. 다시 열어 Enter("계속 만들기") → 닫히고 렌더는 계속 running. (`20-cancel-confirm-*`)
  - "영상 보기" 누르면 `aria-expanded=true`, 버튼 "영상 닫기", 비디오는 멈춘 상태(자동 재생 안 함). (`30-view-video-1280.png`)
- 정리: dev·worker 종료(내가 띄운 PID 트리만), 가상 데이터 `dream-t119-ui-*` 삭제, 복사본 `.tools` 삭제, 브라우저 작업 공간 종료.

## 3. 확인 못 한 것 · 참고
- **내보내기 화면의 대기 안내는 브라우저로 확인하지 못했어요.** 가상 s5에서 내보내기 단계가 잠겨 있어 대기 export 작업을 만들 수 없었어요. 코드는 같은 `RenderWaitNote`·`useRenderWait`를 쓰고 tsc는 통과해요.
- 가상 s5의 생성 입력(참조 형식)이 옛 형식이라 제품 경로의 "샘플 이미지 만들기"가 "작업 입력을 확인해 주세요"로 거절돼요(fixture 문제, 이번 범위 아님). 그래서 **가상 사본에만** 기존 실패 작업을 복제해 대기 작업 1개를 만들었어요(`tmp/t119-queue.cjs`, 실행 시각을 먼 미래로 둬 처리기가 집지 않음). `blockedBy`는 서버가 계산한 값이에요.
- 처음 hydration 전 상태의 초점 경계는 T123 최종 판단에 따라 손대지 않았어요.
- 대기(attempt 0) 소문구 보완은 허용 항목이었지만 이번엔 넣지 않았어요(필요하면 다음에).
