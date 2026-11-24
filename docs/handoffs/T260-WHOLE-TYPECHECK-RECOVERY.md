# T260 전체 타입 검사 복구

2026-11-18 KST · Codes(Backend) · 결과 반환

기준 `e5e986971b6b400e541606c1cf365c204ff732b0`, 배정 `msg_c3ae37c80c71`, 수락 `msg_65d3b87eb6e7`. [T259-R](T259-R-PG17-READ-ROLE-VALIDATION-REVIEW.md)의 전체 타입 검사 잔여 항목을 확인했다. 깨끗한 격리 사본에서 `npm.cmd run typecheck`와 두 실행기의 ESLint가 통과했다.

## 진단과 수정

| 항목 | 확인 결과 |
| --- | --- |
| 기존 Next validator 4건 | 공유 `.next/types/validator.ts`와 `.next/dev/types/validator.ts`에 이미 이동한 `app/(studio)/page`를 참조하는 기록이 남아 있었다. 기준 커밋에는 `app/(public)/page.tsx`가 있다. 기준 커밋과 원본 T257 실행기만 있는 깨끗한 사본에서 Next 타입을 다시 생성하자 현재 공개 홈을 참조했고, 기존 validator 오류 4건은 재현되지 않았다. |
| 나머지 타입 오류 18건 | 수정 전 격리 타입 검사에서 T257/T258 두 실행기에 각각 9건이 남았다. Next 타입 선언이 요구하는 `ProcessEnv.NODE_ENV`를 운영체제 변수의 allowlist로 조립한 자식 환경에서 빠뜨려 `execFile`과 `spawn` 오버로드 및 후속 타입 오류가 발생했다. |
| 수정 | [T257 실행기](../../tests/postgres/run-t257-pg17-schema3-diagnostic.ts)와 [T258 실행기](../../tests/postgres/run-t258-pg17-schema3-local.ts)의 자식 환경에만 `NodeJS.ProcessEnv` 타입과 고정 `NODE_ENV: "test"`를 명시했다. 기존 OS 변수 allowlist, PG·운영 변수 제거, 경로·서명·버전·PID 확인과 종료 절차를 유지했다. |

## 검증과 보존

Node 26.13.0, Next 16.4.6, TypeScript 6.0.3을 사용했다. 기준 커밋의 `git archive`를 공유 `.next`가 없는 로컬 임시 사본에 풀고, 이미 설치된 `node_modules`를 사용했다. 현재 작업본의 다른 수정은 옮기지 않았다. 처음에는 원본 T257을 넣어 수정 전 대조를 실행했고, 이후 두 실행기만 새 파일로 바꿔 검증했다.

| 검사 | 종료 코드 및 결과 |
| --- | --- |
| 수정 전 `next typegen` | 0. 공개 홈 참조 생성, 이전 홈 validator 오류 0건. |
| 수정 전 전체 `tsc --noEmit --incremental false` | 2. 두 진단 실행기 18건. |
| 수정 후 `next typegen` 및 전체 `tsc --noEmit --incremental false` | 각각 0. |
| 수정 후 두 실행기 ESLint `--max-warnings 0` | 0. |
| 수정 후 저장소의 `npm.cmd run typecheck` | 0. `next typegen && tsc --noEmit` 전체 통과. |

- 증거 경로는 `tmp/t260-typecheck-64ce5c8d2ab144209d9fcd7ddaba20fb/evidence/`다. 원본 archive, 수정 전후 typegen·typecheck·lint 로그와 종료 코드, 공유 파일의 전후 SHA-256을 보관했다.
- T257 작업 파일을 수정하기 전에 바이트 그대로 `evidence/run-t257-pg17-schema3-diagnostic.original.ts`에 보존했다. SHA-256은 [당시 보고서](T257-PG17-SCHEMA3-DIAGNOSTIC.md)의 `8cf07494fb504affbeb0f0709107c9a0caec0a8c8a50e4b4bd333c710aa1d4e3`와 일치한다. T257 원래 DB 증거 경로의 preflight·dry-run·apply·catalog·cleanup 파일 5개도 이전 보고서의 해시와 일치했다.
- 공유 `.next` validator 두 개와 현재 작업본의 `next-env.d.ts`, `tsconfig.json`은 전후 해시가 같았다. 공유 폴더의 오래된 validator는 남아 있으므로 그 폴더에서 그대로 실행한 타입 검사의 결과와 깨끗한 사본의 결과를 구분한다. 프로젝트 설정·제품 코드·SQL·인증·관리형 설정 변경, DB 실행·운영 접속·배포는 없었다.

Master 전달문 — T260 완료. 공유 validator 4건은 이전 홈 경로를 가리키는 생성 산출물이었고 깨끗한 사본에서는 사라졌습니다. T257/T258 자식 환경 타입만 보완해 격리 사본에서 수정 전 18건이 수정 후 0건, 저장소 `npm.cmd run typecheck`와 범위 lint가 모두 exit 0입니다. T257 원본 바이트와 당시 증거를 보존했고 공유 산출물 해시는 유지했습니다.
