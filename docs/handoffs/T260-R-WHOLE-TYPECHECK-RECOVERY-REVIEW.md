# T260-R 전체 타입 검사 복구 독립 검수

**판정. `aa79427`의 전체 타입 검사 복구를 수용한다.** 깨끗한 격리 사본에서 수정 전에는 T257·T258 진단 실행기에 총 18개 오류가 남았다. 수정본의 전체 타입 검사와 두 실행기 범위 린트는 통과했다. 공유 `.next`의 기존 validator와 프로젝트 설정 파일은 해시가 유지됐다.

대상 `aa79427f8eb1c85f8f260730b71e17ea6cc1c682`, 비교 기준 `e5e986971b6b400e541606c1cf365c204ff732b0`. Orca 배정 `msg_d2f668fcc725`을 확인하고 결과 문서의 점유 충돌이 없어 `msg_7909475cd7d8`로 수락했다. 제품 소스·SQL·프로젝트 설정을 수정하거나 PostgreSQL을 실행하지 않았다. [작업자 보고](T260-WHOLE-TYPECHECK-RECOVERY.md)

## 변경 및 원본 보존

- 두 고정 커밋 사이에는 작업자 보고, 기존 미추적 T257 실행기의 등록, 기존 T258 실행기의 변경만 있다. T257의 보관 원본을 바이트 단위로 확인했고 SHA-256 `8cf07494fb504affbeb0f0709107c9a0caec0a8c8a50e4b4bd333c710aa1d4e3`가 기존 T257 보고와 일치했다. 보관한 당시 PG17의 preflight·dry-run·apply·catalog·cleanup 파일도 5개 모두 기존 SHA-256과 일치했다. [T257 원래 실행 보고](T257-PG17-SCHEMA3-DIAGNOSTIC.md)
- T257 보관 원본과 T258의 기준 커밋을 각각 대조했다. 줄바꿈을 정규화한 전체 소스는 `childEnv` 블록 한 곳만 바꾸면 고정 커밋과 정확히 일치했다. `NodeJS.ProcessEnv` 타입과 고정 `NODE_ENV: "test"`를 추가했고, OS 환경 allowlist와 대상별 환경 제거, 서명·버전·경로·PID·루프백·종료 가드는 모두 동일했다. T257은 원래 제품 blob에 고정된 역사적 진단 실행기다. 현재 코드에서 제품 blob이 달라졌으면 실행을 거절하는 가드를 그대로 두었다. [T257 실행기](../../tests/postgres/run-t257-pg17-schema3-diagnostic.ts) · [T258 실행기](../../tests/postgres/run-t258-pg17-schema3-local.ts)
- 타입 표기는 런타임에서 지워진다. 새 `NODE_ENV` 값은 허용된 OS 변수로 조립하는 자식 환경에만 들어간다. 부모의 `process.env.NODE_ENV`를 변경하지 않고, 부모의 DB·앱 환경 변수를 자식에게 새로 상속시키지 않는다. 두 환경 표현식을 실제 값 대신 모의 입력으로 평가해 이 동작을 확인했다. 대상 자식은 무프로필·비대화형 PowerShell과 PostgreSQL 도구이며, 기존 도구 호출의 경로·인자·시간 제한은 유지됐다. 수정본의 실제 DB 실행은 이번 검수 범위 밖이다.

## 전후 증거와 독립 재현

작업자 증거 `tmp/t260-typecheck-64ce5c8d2ab144209d9fcd7ddaba20fb/evidence/`의 종료 파일 6개와 로그를 확인했다. 독립 검수는 `D:/starwork/t260-r-typecheck-1331bdf7/` 아래 두 `git archive` 사본에서 진행했다. 기준 사본에는 검증한 T257 원본만 복사했다. 두 사본은 기존 로컬 `node_modules`를 읽어 사용했고 Next 생성 파일은 사본 내부에서만 만들었다. 환경은 Node 26.13.0, Next 16.4.6, TypeScript 6.0.3이다.

| 검사 | 독립 실행 결과 |
| --- | --- |
| 수정 전 `next typegen` | 종료 0. 새 validator는 `app/(public)/page.js`를 참조했고 이전 `app/(studio)/page.js` 참조와 오래된 개발 validator는 없었다. |
| 수정 전 전체 `tsc --noEmit --incremental false` | 종료 2. T257·T258 파일 각 9개로 총 18개였다. 작업자 보존 로그의 오류 위치 분류와 동일했다. 기존 4개 Next 생성 타입 오류는 깨끗한 사본에서 재현되지 않았다. |
| 수정 후 `npm.cmd run typecheck` | 종료 0. 패키지 명령의 `next typegen && tsc --noEmit` 모두 통과했다. 새 validator는 현재 공개 홈을 참조했다. |
| 수정 후 별도 전체 `tsc --noEmit --incremental false` | 종료 0. 오류 출력 없음. |
| 수정 후 두 실행기 `eslint --max-warnings 0` | 종료 0. 경고·오류 출력 없음. |

생성된 validator 오류 4개와 소스 타입 오류 18개는 원인이 달랐다. 전자는 공유 폴더에 남은 이전 라우트의 생성 기록이었다. 후자는 `ProcessEnv`가 요구하는 `NODE_ENV`를 제한된 자식 환경에서 누락해 `execFile`·`spawn` 타입 검사가 실패한 경우였다. 공유 `.next/types/validator.ts`, `.next/dev/types/validator.ts`, `next-env.d.ts`, `tsconfig.json`의 SHA-256은 작업자 전후 기록과 이번 검수 전후 모두 일치했다. 공유 폴더의 오래된 validator는 이번 작업으로 재생성되지 않았다.

## Master 전달용

> T260-R 독립 검수 완료. aa79427의 세 경로와 T257 보관 원본 SHA-256, 기존 실행 증거 5개를 대조했습니다. 두 로컬 아카이브에서 수정 전 18건과 수정 후 전체 패키지 타입 검사·별도 무증분 tsc·범위 린트 종료 0을 재현했습니다. 새 validator는 공개 홈을 참조했고 공유 .next 및 설정 파일 4개 해시는 유지됐습니다. 두 실행기의 유일한 변경은 자식 환경 타입과 NODE_ENV=test이며 기존 안전 가드는 그대로입니다. 로컬 타입 복구를 수용합니다. PostgreSQL 실행·운영 접속 없이 결과 `docs/handoffs/T260-R-WHOLE-TYPECHECK-RECOVERY-REVIEW.md`만 추가했습니다.
