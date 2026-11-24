# T282-F1-R REA 대기 확인 권한 독립 재검수

2026-11-19 KST · Codex(Tester) · 고정 커밋 `2553021` · Orca `msg_8b926d4d076d`

**판정 — 통과.** 대기 확인의 적용과 취소가 저장 범위 및 링크·범위·소유자 권한 세대를 증명한 뒤에만 행을 종결합니다. 세대 증명 전 `expired`·`stale`·`conflict`가 확인 상태와 계획을 지우던 F282-1을 다시 대조했습니다. [수정 인계](T282-F1-REA-PENDING-AUTHORITY-BEFORE-RETIRE.md) · [원 검수](T282-R-REA-RECEIPT-AUTHORITY-GENERATIONS-REVIEW.md)

| 독립 합성 SQLite 대조 | 결과 |
| --- | --- |
| 대기 확인 적용과 취소 | 만료·분석 ID 변경·CAS 불일치 각각에서 현재 세대 누락, 형식 오류, 링크·범위·소유자·복원 세대 불일치, 구 권한 기준 두 형태를 대조했습니다. 24개 적용·취소 조합이 모두 `unavailable`이었고 `status`, `state_json`, `plan_json`과 전체 DB 논리 스냅샷이 같았습니다. |
| 세대가 입증된 종결 | `expired`, `stale`, `conflict`, `cancelled`는 이전대로 종결됐습니다. 관련 확인 행만 바뀌고 상태 JSON 및 계획이 지워졌습니다. 타임라인·워크플로·활동 기록에는 새 쓰기가 없었고 영수증도 발급되지 않았습니다. |
| 완료 v2 조회·재전송 | 링크·범위·소유자·복원 세대 변경, 조회권 미확인·거절, 세대 누락·잘못된 값, 재승인과 v1 종결을 모두 거절했습니다. 영수증 읽기와 완료 확인 재전송 두 경로의 전체 DB 상태가 같았습니다. |
| 동일 세대 응답 유실 | 별도 프로세스가 적용 응답을 버렸고, 다른 프로세스가 실행 만료 뒤 원래 영수증을 회수했습니다. 완료 시각 포함·보존 기한 제외, 공개 필드, 이후 타임라인 변경 뒤 동일 영수증을 확인했습니다. `no_change`도 타임라인 저장 없이 회수됐습니다. |

[대기 적용 및 취소](../../lib/reference-analysis/synthetic-apply-store.ts#L123) · [완료 영수증 판정](../../lib/reference-analysis/apply-lifecycle.ts#L90) · [회귀 시험](../../tests/reference-analysis/atomic-apply.test.ts#L293)

- 집중 3개 파일 **31/31**, 네이티브 REA와 `p2-3b-timeline`, `p2-5a-audio` **17개 파일 207/207** 통과.
- `tsc -p tmp/t279-rea-typecheck.json`, 변경 TypeScript ESLint `--max-warnings 0`, REA 범위 `git diff --check` 통과.
- 임시 합성 자료와 격리 SQLite를 사용했습니다. 운영 DB·실제 권한 경합 및 제품 타임라인 연결은 후속 범위입니다.

**Master 전달문** — T282-F1-R 통과. 세대 미증명·불일치·구 권한의 24개 적용·취소 조합에서 전체 DB와 확인 계획을 보존했습니다. 정상 종결·완료 v2 양 경로·별도 프로세스의 유실 복구를 확인했고 207/207 회귀·범위 타입·린트가 통과했습니다.
