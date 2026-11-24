# T278-F1-R REA 적용 준비 롤백 독립 재검수

2026-11-19 KST · Codex(Tester) · 고정 커밋 `843be5c86265bd17b96cac43ccdef8b8f06b7e27` · Orca `msg_65d5dfebfadd`

**판정 — 통과.** F278-1의 잘못된 장면 요청을 다시 실행해 분석과 이전 확인이 모두 보존됨을 확인했습니다. 분석 게시와 확인 생성은 같은 SQLite 쓰기 트랜잭션에서 수행됩니다. 예상된 거절은 롤백 뒤 `unavailable`로 반환되고, 예외는 롤백 뒤 호출자에게 전파됩니다. [수정 인계](T278-F1-REA-PREPARE-NO-MUTATION.md) · [원래 검수](T278-R-REA-ISOLATED-END-TO-END-REVIEW.md) · [트랜잭션](../../lib/reference-analysis/synthetic-apply-store.ts#L76)

## 독립 합성 대조

기존 회귀와 별도로 500ms 컷이 있는 30fps 합성 MP4를 S4 SQLite 복제본에 등록했습니다. 저장된 사본 해시와 컷을 확인한 뒤, 각 실패 전후로 모든 사용자 테이블의 행에서 계산한 논리 해시를 비교했습니다.

| 경로 | 관찰 결과 |
| --- | --- |
| 타임라인에 없는 대상 장면 | 유효 UUID의 대상 장면이 `unavailable`로 거절됐습니다. 전체 논리 스냅샷과 활성 분석이 동일했습니다. |
| 분석 임시 게시 직후 예외 | 트랜잭션 안에서 활성 분석이 교체된 것을 확인한 뒤 시계 예외를 발생시켰습니다. 원래 예외 객체가 전달됐고 전체 논리 상태가 복원됐습니다. |
| 확인 INSERT 직후 SQLite 오류 | 임시 `AFTER INSERT` 트리거에서 새 확인과 교체 분석의 ID가 일치하고 옛 확인이 함께 존재함을 SQL로 확인한 뒤 `RAISE(FAIL)`을 발생시켰습니다. `SQLITE_CONSTRAINT_TRIGGER`가 전달됐고 두 쓰기가 모두 롤백됐습니다. 삽입 변경 건수가 0인 경우도 `unavailable`과 전체 롤백을 확인했습니다. |
| 기존 확인의 적용 | 실패 대조를 끝낸 뒤 최초 확인을 적용해 타임라인 리비전 한 건과 영수증 한 건이 생성됐습니다. |
| 정상 교체 | 두 번째 정상 준비에서 활성 분석과 새 확인이 함께 저장됐습니다. 이전 확인은 `stale`이 됐고 새 확인이 한 번 적용됐습니다. |
| 경쟁 타임라인 저장 | 별도 SQLite 연결이 새 준비 트랜잭션 직전에 저장했습니다. 새 준비는 거절됐고 DB 논리 상태는 경쟁 저장 직후와 같았습니다. 이전 확인의 후속 적용은 `conflict`였으며, 해당 확인 행만 종결되고 타임라인 추가 저장이나 영수증 발급은 없었습니다. |

[격리 게시 경로](../../tests/reference-analysis/isolated-rea-fixture.ts#L150) · [전용 통합 회귀](../../tests/reference-analysis/isolated-rea.test.ts#L231)

## 재실행 결과와 범위

- 전용 통합 **9/9** 통과. 기본 REA **100 통과, 60 건너뜀**. `DREAM_REA_NATIVE_TEST=1`에서 REA와 타임라인·오디오 회귀 **16개 파일 196/196** 통과.
- `tsc -p tmp/t278-rea-typecheck.json`과 변경된 TypeScript 파일 3개의 ESLint `--max-warnings 0` 통과.
- 검수는 Windows 로컬 합성 파일과 격리 SQLite에 한정했습니다. 실제 Auth와 운영 저장소 및 제품 라우트 연동은 이번 판정 범위 밖입니다.

**Master 전달문** — T278-F1-R 통과. 잘못된 대상, 분석 게시 직후 예외, 확인 INSERT 직후 SQLite 오류, 삽입 0건에서 전체 논리 상태와 이전 확인을 보존했습니다. 정상 교체와 경쟁 저장을 각각 독립 확인했고, 전용 9/9·네이티브 196/196·범위 타입 및 린트를 통과했습니다.
