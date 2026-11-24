# T261-F1-R 스테이징 체크리스트 보완 독립 확인

**판정. T261-R의 문서 보완사항을 충족한다. 실제 시험 착수는 보류다.** 승인된 별도 Supabase 시험 대상과 그 대상만 사용하는 보호 Vercel Preview의 매핑은 기존 기록에서 입증되지 않았다. 보완한 절차는 해당 매핑과 실행 범위가 확인된 뒤 읽기 전용 사전점검에 사용할 수 있다. opt-in은 실제 보호 런타임에서 제한 API 연결의 TLS 증거를 확보한 뒤에만 진행한다.

대상 `e631908d1a855ee6f213d8d7b499c4b63ff00003`, 전 버전 `1b42550a128dd41cacb48864ae45ac2142b966cf`. 두 커밋 사이 변경은 체크리스트 한 파일이다. 작업본 SHA-256 `555180292497c85d6909ecf66f6de1f88df5c411cad28a1ccfcc0619f24c8e11`과 결과 경로의 점유 충돌 없음을 확인해 Orca `msg_cbb5640bc1cc`로 수락했다. 제품 코드나 SQL은 변경하지 않았고 외부 접속·DB 명령·설정·비밀 조회·배포를 수행하지 않았다. [보완 체크리스트](T261-MANAGED-PG17-STAGING-CHECKLIST.md) · [이전 독립 검토](T261-R-MANAGED-PG17-STAGING-CHECKLIST-REVIEW.md)

## 보완사항 대조

| 항목 | 판정과 근거 |
| --- | --- |
| 비지연 FK 적격성 | **문서 충족.** 같은 migration login으로 `READ ONLY` 트랜잭션에서 대상 테이블의 카탈로그만 읽는다. `auth.users.id`의 정상 컬럼·UUID·NOT NULL과 단일 키·유효·고유·비부분·비표현식 조건에 `pg_index.indimmediate`를 추가했다. boolean 한 값을 반환하고 ROLLBACK한다. false이면 중단한다. 현재 v2의 검사 강화를 뜻하지 않으며, 별도 조회가 실제 승인 대상에서 통과해야 한다. 기존 PG17 major·서버 식별·역할·권한 확인도 유지됐다. [v2 검사](../../lib/db/postgres/migration-state-v2.ts) |
| opt-in 전 실제 제한 런타임과 양 구간 TLS | **문서 충족, 실행 수단 미지정.** 제품 GET은 읽기 opt-in이 꺼져 있으면 pg 풀까지 가지 않는다. 보완안은 같은 보호 Preview Node 런타임, 고정 SHA·Preview ID·리전·제한 API 대상과 동일한 앱 풀 및 신뢰 설정에서 비공개 일회성 읽기를 요구한다. 같은 client에서 인증서·CA와 호스트 검증을 남기고, 같은 읽기 SQL 세션에서 자체 `pg_stat_ssl` 정확히 1행·`ssl=true`를 요구한다. false·NULL·0행은 분리하고 연결을 닫는다. 도구나 실행 경로가 승인·지정되기 전 플래그를 열지 않는다. opt-in으로 배포 ID나 세션 조건이 바뀌면 그 대상에서 증거를 다시 수집한 뒤 A/B를 판정한다. [프로젝트 읽기 요청](../../lib/services/postgres/project-read-request.ts) · [런타임 풀](../../lib/services/postgres/project-read-pool.ts) · [TLS 설정](../../lib/db/postgres/connection.ts) |
| 신뢰 origin과 콜백 | **문서 충족.** 실제 Preview의 HTTPS origin을 `DREAM_SITE_URL` 및 앱이 읽는 Vercel URL에서 나온 신뢰 목록과 대조한다. 공식 로그인 요청은 같은 origin을 사용하고, 가입·복구 흐름을 사용할 때는 시험 프로젝트의 정확한 `/auth/callback`과 예정 반환 경로를 확인한다. 다른 호스트로 이동하면 중단한다. 이는 앱의 origin 검사와 콜백 흐름을 따른다. [신뢰 origin](../../lib/auth/config.ts) · [Auth 콜백](../../app/auth/callback/route.ts) |
| 유효 세션의 보호 GET 403 | **문서 충족.** 허용 상태에서 실제 시험 세션을 얻고, 지정 담당자가 보호 Preview 범위에서만 해당 계정을 한시 제외한다. 동일한 보호 origin의 `getUser`가 계속 유효한 상태에서 `403 AUTH_FORBIDDEN`과 `no-store`를 대조하고 목록을 복원한다. POST 로그인은 세션 발급 전 `400 INVALID_CREDENTIALS`를 반환하는 별도 시험이다. Preview 보호 응답, 앱 403, 갱신 후 실제 세션이 끊긴 401도 서로 구별한다. 승인된 부정 시험 상태를 만들 수 없으면 403을 미검증으로 남긴다. [로그인 POST](../../app/api/auth/login/route.ts) · [서버 인증 판정](../../lib/auth/resolve.ts) · [Preview 앞의 앱 인증 분기](../../proxy.ts) |
| 불확실 COMMIT과 복구 | **문서 충족.** 이관은 저널·카탈로그, 프로비저닝은 역할쌍과 grantor·ADMIN/INHERIT/SET, fixture는 범위에 고정한 합성 owner·프로젝트·종속 행을 각각 새 읽기 접속에서 사전·기대 상태에 대조한다. 분류 전 재실행·자격 발급·보상 DDL·재시드·계정 폐기를 보류한다. 확정 롤백의 4·5단계 대조도 유지됐다. 정리 시 `auth.users`의 `ON DELETE RESTRICT`를 반영해 종속 자료를 먼저 정리하고 남은 참조 0을 확인한다. 스키마 불변 규칙이나 시험 범위 때문에 안전하게 정리할 수 없으면 사전 합의한 시험 DB 복구로 전환한다. [이관 COMMIT 처리](../../lib/db/postgres/migration-runner-v2.ts) · [프로비저닝](../../lib/db/postgres/provision-template.ts) · [소유 관계](../../lib/db/postgres/0001_schema.sql) · [불변 규칙](../../lib/db/postgres/0002_invariants.sql) |

## 실제 착수 전 남은 전제

1. **승인 매핑과 대상 식별.** Master가 별도 시험 Supabase 프로젝트·Auth/DB와 보호 Vercel Preview의 ID·고정 SHA·환경 스코프를 같은 승인에 연결해야 한다. 기존 B7의 Preview 표시는 환경 이름 관측이다. B8/B11은 과거 운영 연결이므로 이 매핑의 근거로 사용할 수 없다. 시험 대상이 확정된 후 승인 범위에서만 이관 역할의 읽기 전용 2~3단계를 시작한다. [B7 환경 기록](B7-MANAGED-ENVIRONMENT-CHECK.md) · [B8 운영 연결 관측](B8-MANAGED-CONNECTION-DIAGNOSIS.md) · [B11 SSL 기록](B11-SSL-CHANGE-READINESS.md)
2. **단계별 실행 영수증.** 승인 대상의 이관 CA/호스트 검증과 backend TLS, 권한·비지연 키·fresh/정확한 schema 3 상태를 실제로 기록해야 한다. 이관 후 역할쌍·제한 로그인과 Preview 전용 비공개 읽기 방법을 확정하고, opt-in 전 제한 런타임의 두 TLS 구간 증거를 수집한다. 기존 CLI의 target/approval hash와 로컬 합성 시험은 실행 대상의 매핑이나 관리형 TLS를 대신하지 않는다.
3. **실제 Auth와 복귀 범위.** Preview origin에서 유효한 A/B 세션, 403을 낼 승인된 allowlist 변경·복원 절차, 시드·폐기 범위와 시험 DB 복원 기준을 확정해야 한다. 관리형 실행, 운영 변경과 `DEC-SSL-01`은 기존 대기 상태다.

## Master 전달용

> T261-F1-R 독립 확인 완료. e631908의 단일 문서 diff가 T261-R의 비지연 FK 조회, opt-in 전 같은 제한 Preview 런타임의 양 구간 TLS, 신뢰 origin·콜백과 유효 세션 GET 403, 불확실 COMMIT·fixture 복구 보완을 충족합니다. 승인된 별도 Supabase–보호 Preview 매핑과 실제 실행 증거가 없어 시험 착수는 보류입니다. 매핑 및 실행 범위 확인 후 읽기 전용 2~3단계부터 진행하며, opt-in 전에 비공개 점검 수단과 TLS 증거를 확보해야 합니다. 결과는 `docs/handoffs/T261-F1-R-MANAGED-PG17-STAGING-CHECKLIST-REVIEW.md`입니다. 외부 접속·DB 명령·설정/배포 변경 없이 검수 문서만 추가했습니다.
