# T293-F1 PostgreSQL 게시 실행기의 시험 환경 타입

기준 `3af0596` · Backend 자체 검증

자식 프로세스가 받는 환경 허용 목록에 격리 실행값 `NODE_ENV: "test"`를 명시했습니다. 기존 허용 변수와 자식 프로세스별 설정을 유지하면서 Next가 확장한 `NodeJS.ProcessEnv`를 충족합니다. [실행기](../../tests/public-showcase/t293-admin-publication-native.ts)

## 검증

- `git archive 3af0596`을 새 임시 디렉터리에 풀고 기존 설치 의존성을 연결했습니다. `next typegen`으로 `next-env.d.ts`가 가져오는 타입을 생성한 뒤, 저장소의 전체 `tsc --noEmit --incremental false`를 실행했습니다. 고정본은 `TS2769`, `TS2339`, `TS7006`으로 종료 코드 2였습니다. 같은 사본에서 이 실행기 파일만 교체하자 전체 타입 검사가 종료 코드 0으로 통과했습니다. 임시 소스와 의존성 연결을 정리했습니다.
- 실행기와 어댑터의 집중 ESLint `--max-warnings 0`, `git diff --check`를 통과했습니다.
- `node --conditions=react-server --import tsx tests/public-showcase/t293-admin-publication-native.ts`를 실제 루프백 PostgreSQL 17.12에서 재실행했습니다. 권한 분리, 한 트랜잭션 게시·감사·원장, 동시 실행, 롤백·응답 유실과 철회 검사가 통과했습니다. 실행 종료 후 소유 리스너와 임시 클러스터 제거를 확인했습니다.

## 인계

T293-F1 보완을 완료했습니다. 독립 재검수에서는 Next 타입을 생성한 깨끗한 사본의 전체 타입 검사와 실제 격리 PG17 실행을 대조해 주세요. SQL·제품·운영·배포 변경은 없었습니다.
