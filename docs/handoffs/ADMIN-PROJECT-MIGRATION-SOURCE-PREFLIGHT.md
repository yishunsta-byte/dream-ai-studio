# 기존 프로젝트 이전 원본과 운영 연결 확인

2026-11-20 · 기존 PC 프로젝트를 현재 Dream AI Studio Supabase로 옮기라는 사용자 지시 · Master 확인 `msg_d92a26b18fdf`.

## 원본 찾기

| 확인 대상 | 결과 |
| --- | --- |
| 현재 작업실 `data/app.db` | 읽기 전용 트랜잭션에서 프로젝트·첨부·타임라인·렌더 각 0건, `quick_check=ok`, 외래 키 위반 0건. 다른 기본 작업실이나 백업 루트 설정은 없었다. |
| 자동 백업 ZIP 4개 | 각 DB 사본의 바이트 수·SHA-256과 보관 파일 수가 매니페스트와 일치했다. 네 사본 모두 프로젝트·첨부·Storage 파일 0건이며 DB 무결성 점검을 통과했다. 등록된 외부 위치 백업은 없었다. |
| 유지보수 DB 사본 2개 | 두 파일 모두 프로젝트·첨부 0건, DB 무결성 점검 통과. |
| P1-9 복원 폴더 | 2프로젝트·13자료로 [P1-9 가상 fixture 검증](P1-9.md)과 일치한다. 실제 프로젝트 이전 원본에서 제외했다. |

실제 프로젝트가 있는 작업실 경로나 백업 ZIP이 필요하다. 원본을 받으면 프로젝트별 소유 계정과 파일 범위를 맞춘 뒤 별도 사본에서 UUID, 승인·리비전, 원본 파일 해시와 복원 결과를 비교할 수 있다. 현재 인벤토리로는 복사 건수를 만들거나 소유 계정을 정할 수 없다.

## 기존 운영 대상과 읽기 확인 경로

- Master의 기존 SQL Editor 관측에서 PG17.12와 기반 3표, 읽기 스키마 2개, `dream_api`·`dream_worker`가 부재였다. 기존 운영 Data API는 `project_read`를 미노출로 응답했다. [기반 적용 순서](ADMIN-PROJECT-PG17-FOUNDATION-PLAN.md) · [Data API 실측](ADMIN-PROJECT-PRODUCTION-READ-PREFLIGHT.md)
- 이 PC에서 같은 공개 프로젝트를 기준으로 Direct DNS와 TCP만 확인했다. 12:23:47 KST에 A 0, AAAA 1, IPv6 TCP 5432 `ENETUNREACH`였다. DB 인증 및 SQL은 실행하지 않았다. 승인된 제한 또는 마이그레이션 연결 프로필은 이 세션에서 사용할 수 없다.
- 기존 승인 SQL Editor의 [읽기 전용 상태 쿼리](ADMIN-PROJECT-PG17-EDITOR-PREFLIGHT.sql)로 서버 버전·인코딩, role flags, DB `CREATE`·`CREATEROLE`, `auth.users(id)` 타입·UNIQUE·REFERENCES, `auth.uid()`, 게이트웨이 SET 권한, 예약 스키마·이력·역할과 기본 권한을 확인할 수 있다. 현재 DB 세션의 SSL 값은 별도 관측이다. SQL Editor 역할과 이관 CLI 연결의 역할이 같아야 그 권한을 이관자에게 적용할 수 있다.
- CLI는 승인된 운영 `managed-session-live` 연결의 기존 프로젝트 ref, 대시보드 Connect의 정확한 Session host·5432·DB·`role.ref` 사용자와 실제 예상 DB 역할, 검증된 CA, 보안 채널을 통한 연결 자격으로 실행한다. Direct만 선택한다면 운영 전용 Direct 입력 계약과 IPv6 실행 환경이 필요하다. 현 CLI의 Direct `managed-staging`을 운영으로 표기하거나 Transaction pooler에 적용하지 않는다. 일반 `DATABASE_URL`과 `.env.local` 값을 자동으로 채택하지 않는다. [대상 확인 코드](../../lib/db/postgres/migration-target.ts)
- 같은 연결에서 `fingerprint --schema 3 --mode dry-run`의 대상·승인 해시를 지정한 뒤 `dry-run --schema 3`으로 `pending=3`을 확인한다. 승인되고 적용할 때는 apply 모드의 별도 승인 해시가 필요하다. SQL Editor 카탈로그 진단과 별도로 CLI는 대상·연결자·포트·TLS·고정 파일·이력 상태를 한 연결에서 확인한다. [v2 CLI](../../scripts/postgres/migrate-v2.ts)

읽기 쿼리를 T358의 소유 PG17.12에서 실행해 읽기 전용 트랜잭션, `CREATE`, Auth UNIQUE, 게이트웨이 SET, 조회 스키마와 이력 확인을 검증했다. 기존 T358 검증·복귀와 임시 자원 종료까지 exit 0이었다. 운영 SQL Editor 실행은 승인된 세션의 판정을 기다린다.

**Master 전달문** · 현재 활성 원본과 백업 6개에서 이전할 실제 프로젝트가 확인되지 않았습니다. 별도 복원 2건은 검수 가상 자료입니다. 실제 백업 위치를 요청했습니다. 기존 운영 SQL Editor에 전달한 읽기 쿼리로 권한과 부재 상태를 확인할 수 있지만, 이 PC의 Direct 경로는 도달하지 않고 승인된 Session CLI 입력은 없습니다. 운영 데이터·DDL을 변경하지 않았습니다.
