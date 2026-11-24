# 로컬 PG 렌더 실행 커밋 전체 회귀

고정 기준 d67a9d3206284011ad658e6c09dd9c161abbb58e. 추적 파일 Git 아카이브로 격리했고 고정 의존성과 기존 FFmpeg 도구를 읽는 연결을 사용했다.

- npm.cmd run typecheck 종료 0. 경로 타입 생성과 TypeScript 통과.
- npm.cmd test 종료 0. 2,981건 통과, 390건 제외, 실패 0건. 실행 파일 157개 통과, 17개 제외, 72.76초.
- 첫 실행에서는 사본의 .tools 연결이 빠져 비공개 저장소 시험 54건의 준비가 실패했다. 이 시험이 사용하는 고정 경로를 연결한 뒤 해당 54건 단독과 위 전체 실행이 통과했다.

이번 실행은 Vitest 기본 회귀다. 명시 실행 외부 경로는 별도 실제 Next·PG17 독립 검수에서 확인됐다. 이후 PNG 장면 등록 등은 새 커밋의 검증 대상이다. 로컬 로그는 D:/starwork/p2-regression-d67a9d3/regression-with-tools.log에 있다. [실제 PG 렌더 검수](FIRST-WORK-PG-RENDER-EXECUTION.md)

> 플래너 전달문 — d67a9d3의 기본 전체 회귀 2,981건 통과, 390건 제외, 실패 0건과 타입 검사 통과를 확인했습니다.
