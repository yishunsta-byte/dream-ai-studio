# T293-F1-R PG17 실행기 환경 타입 독립 재검수

2026-11-19 KST · Codex(Tester) · 고정 커밋 `2ed6db8d392457e9460ea8ea4113a84912f93afa` · 배정 `msg_0fe818928148`

**판정 · 통과.** F293-1의 저장소 타입 오류가 해소됐습니다. 깨끗한 고정 사본의 전체 타입 검사와 실제 루프백 PostgreSQL 17.12 테스트가 모두 통과했습니다.

| 항목 | 독립 검증 결과 |
| --- | --- |
| 코드 변경 | [`t293-admin-publication-native.ts:22`](../../tests/public-showcase/t293-admin-publication-native.ts#L22)의 기존 OS 허용 목록을 유지하고 `NodeJS.ProcessEnv`에 `NODE_ENV: "test"`를 명시했습니다. 고정 T253 SQL과 어댑터는 같은 내용으로 사용했습니다. |
| 저장소 전체 타입 | `git archive 2ed6db8`로 만든 임시 사본에 설치된 의존성을 연결했습니다. 초기 `.next` 부재를 확인한 뒤 `node node_modules/next/dist/bin/next typegen`으로 라우트 타입을 생성했습니다. 같은 사본에서 `node node_modules/typescript/bin/tsc --noEmit --incremental false`가 종료 코드 0이었습니다. 실행기와 어댑터 ESLint `--max-warnings 0`도 통과했습니다. |
| 자식 프로세스 환경 | 고정 실행기의 코드를 바꾸지 않고 Node 사전 로드 계측으로 `postgres.exe`, `initdb.exe`, `pg_ctl.exe` 및 PowerShell의 호출 옵션을 확인했습니다. 부모에 `NODE_ENV=production`과 합성 접속 설정을 넣어도 모든 계측 호출은 `NODE_ENV=test`였습니다. OS 허용 목록과 PowerShell 호출별 검사 인자만 전달됐으며 부모의 합성 PG·DREAM·Supabase·Vercel·DB 환경 표식은 제거됐습니다. |
| 실제 루프백 PG17 | 고정 사본의 실행기가 A/B 및 목록·표지 권한, 고정 T253과 앱·원장·감사 원자성, 동일 UUID와 경쟁, 커밋 응답 유실·롤백·재시도, 철회 범위를 다시 통과했습니다. 실제 시험 종료 후 소유 리스너와 임시 클러스터가 제거됐습니다. |

새 임시 사본은 Git worktree를 추가하지 않고 만들었고, 계측 파일과 PG 도구 복사본을 포함해 제거했습니다. 전체 빌드·운영 DB·운영 자격·배포는 검수 범위 밖입니다.

**Master 전달 문구** · T293-F1-R `2ed6db8` 통과. 깨끗한 고정 사본의 Next typegen과 전체 tsc 종료 코드 0, 집중 ESLint 통과. 실제 루프백 PG17 17.12 재실행과 정리 확인. 시작·종료를 포함한 자식 호출은 `NODE_ENV=test`와 허용 변수만 받았습니다.
