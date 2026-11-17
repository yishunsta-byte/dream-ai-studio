# B22-R versioned catalog independent review — FAIL

- 검토 고정 SHA: `853e861ae2eae52ca93418ceab8eca72a2e74560` (B22 foundation 7 files).
- 검토일: 2026-11-18 KST. 이 판정은 해당 고정본에 한정한다. 병행 중인 B22-FIX는 이 보고서에서 검증하지 않았다.
- 결과: 필수 수정 1건, 실제 PostgreSQL 재현 6개. 기존 71개 통과만으로 엄격한 owner/ACL 일치 계약을 충족하지 못한다.
- 기준: B21 contract, B22-VERSIONED-SOURCE-CATALOG, 공통 v1.3. 제품 변경 없이 지정 보고서만 공유 저장소에 추가했다.

## F-B22R-1: 문자열 principal marker와 실제 role 이름 충돌

고정본 `lib/db/postgres/migration-state-v2.ts`의 owner 정규화는 session_user의 OID이면 문자열 `$owner`, 그 외에는 실제 role 이름 문자열을 반환한다. ACL도 owner/public/named role을 문자열로 표현한다. 따라서 실제 외부 role 이름이 `$owner`인 경우 허용된 소유자와 구별되지 않는다. ACL에서는 owner와 비교하는 기준이 객체 owner인 점도 함께 점검해야 한다.

독립 synthetic PostgreSQL 18.7에서 아래 6개는 모두 `MIGRATION_STATE` 거절을 기대했지만 `{state:"complete",version:4,pending:0}`로 수락됐다. owner 5개는 native OID 비교 `same_owner=false`를 별도로 확인했다.

| 변형 | 실제 변경 | 관측 |
| --- | --- | --- |
| table | `dream.assets` owner를 외부 `$owner`로 변경 | complete4 수락 |
| journal | `dream_migrations.history` owner 변경 | complete4 수락, journal 내용 SELECT까지 진행 |
| schema | `dream` owner 변경 | complete4 수락 |
| function | `dream.storage_guard()` owner 변경 | complete4 수락 |
| domain | `dream.safe_uint` owner 변경 | complete4 수락 |
| ACL만 변경 | `dream.storage_raw_hash(text,text)` EXECUTE를 정상 owner에서 외부 `$owner`로 이전 | 실제 함수 owner가 정상이어도 complete4 수락 |

최소 재현은 정상 complete4 fixture와 trusted management client, `search_path=pg_catalog`에서 각각 독립 트랜잭션으로 실행한다. inspector 호출은 SQL 실행 후, ROLLBACK 전에 한다.

```sql
BEGIN;
SET LOCAL search_path = pg_catalog;
CREATE ROLE "$owner" NOLOGIN NOINHERIT;
ALTER TABLE dream.assets OWNER TO "$owner";
SELECT pg_get_userbyid(relowner),
       relowner=(SELECT oid FROM pg_roles WHERE rolname=session_user) AS same_owner
FROM pg_class WHERE oid='dream.assets'::regclass;
-- native: $owner, false
-- inspectPostgresMigrationStateV2(client, expectedIdentityVersion4)
-- expected: MIGRATION_STATE; actual: complete/version4/pending0
ROLLBACK;
```

ACL만의 별도 최소 재현:

```sql
BEGIN;
SET LOCAL search_path = pg_catalog;
CREATE ROLE "$owner" NOLOGIN NOINHERIT;
REVOKE EXECUTE ON FUNCTION dream.storage_raw_hash(text,text) FROM dream_test_admin;
GRANT EXECUTE ON FUNCTION dream.storage_raw_hash(text,text) TO "$owner";
-- inspector expected MIGRATION_STATE; actual complete4
ROLLBACK;
```

ACL native 증거는 owner=`dream_test_admin`, grantor=`dream_test_admin`, grantee=`$owner`, privilege=`EXECUTE`였다. 일반 이름 `b22r_foreign`으로 table owner를 변경하면 정상 거절한다. 변경 전과 모든 ROLLBACK 후 정상 complete4는 통과하며 임시 role은 남지 않았다. 따라서 연결 실패나 잘못된 기본 fixture로 발생한 실패가 아니다.

권고: 허용 owner/public/named-role의 표현 공간을 분리하고 OID에 근거해 일관된 기준으로 비교해야 한다. 위 6개 거절 기대값과 정상 대조군을 유지한 회귀 검증이 필요하다. 실제 이름 `PUBLIC`의 독립 충돌은 이번 검토에서 재현하지 않았으므로 별도 확정 결함으로 세지 않는다.

이 문제는 catalog admission의 false positive이다. 실제 runtime 권한 우회나 migration apply 성공을 입증한 것은 아니다. metadata-before-history 순서는 구현돼 있으나 journal owner 충돌이 metadata를 통과하므로 해당 변형에서는 history read를 막지 못한다.

## 실행 결과와 중복 집계

작업 복사본은 `D:/starwork/b22r-catalog-853e861`, archive는 `D:/starwork/b22r-source.zip`이다. fixed SHA를 LF 보존 git archive로 추출하고 node_modules와 PG 도구를 물리 복사했다. 전후 tracked 1,013개 blob이 고정 SHA와 모두 일치했다. 공유 working tree의 동시 수정본은 테스트 입력으로 사용하지 않았다.

| 실행 | 결과 | 비고 |
| --- | --- | --- |
| 원본 local runner | 71 PASS / 0 skip, exit 0 | pure 21 + real PG 50 |
| v1 + B22 pure 파일 | 34 PASS / 50 skip | B22 pure 21 중복. skip은 local PG env 없는 DB 사례 |
| 독립 최종 20개 | 14 PASS / 6 FAIL, exit 1 | 위 한 원인의 6개 실패, 기대값 완화 없음 |
| TypeScript noEmit | exit 0 | 독립 fixture 포함 |
| 변경 원본 4개 TS/MJS lint | exit 0, warnings 0 | 아래 명령 |

독립 14개 통과에는 read-only repeatable-read 정상 complete4, 일반 foreign owner 거절, journal RLS/ACL/extra-column의 history 읽기 전 거절, incoming/outgoing role graph 거절, BYPASSRLS 거절, index fillfactor drift 거절, 원래 CHECK 정의를 보존한 NOT VALID 거절, 호출자 identity 옵션 변경 중 snapshot 유지, catalog row 순서 정규화 및 descriptor 불변, database/user/port 불일치 거절, rollback 후 정상 상태가 포함된다.

실행 이력은 삭제하지 않았다. 첫 19개 실행은 13 PASS / 6 FAIL이었으나 그 중 1개는 검토 fixture가 존재하지 않는 `deletion_state` 컬럼을 가정한 오류였다. 실제 CHECK 정의를 읽고 동일 정의에 NOT VALID만 추가하도록 fixture를 수정한 뒤 14 PASS / 5 FAIL을 얻었다. 이후 ACL-only 사례를 추가해 최종 14 PASS / 6 FAIL을 얻었다. 첫 fixture 오류를 제품 결함으로 계산하지 않았다. 보조 출처 감사의 함수 선언 파서도 쉼표 공백과 이름의 숫자를 처리하도록 고쳤으며 최종 감사는 통과했다. 별도 TypeScript 오류는 검토 fixture의 Set<string> 타입으로만 수정했다. 제품 원본은 변경하지 않았다.

재현 명령 (cwd: owned copy):

```text
node tests/postgres/run-versioned-source-catalog-local.mjs --bin D:/starwork/b22r-catalog-853e861/.tools/pgsql/bin
node node_modules/vitest/vitest.mjs run tests/postgres/migrations.test.ts tests/postgres/versioned-source-catalog.test.ts
node tests/postgres/b22r-run-independent.mjs --bin D:/starwork/b22r-catalog-853e861/.tools/pgsql/bin
node --conditions=react-server --import tsx tmp/b22r/audit.ts
node tmp/b22r/verify-baseline.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-manifest-v2.ts lib/db/postgres/migration-state-v2.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/run-versioned-source-catalog-local.mjs --max-warnings 0
```

독립 runner는 원본 runner의 root prefix와 test filename만 바꿨다. 독립 fixture는 synthetic Auth UUID PK, v1 version3 실행, 검증한 SQL4 및 정상 native journal row4로 구성했다. 실제 target에서 기대 catalog를 생성하거나 학습하지 않는다. 변형은 각자 BEGIN/ROLLBACK으로 격리했다.

## 출처·모델·계약 감사

- manifest v2는 version3/4만 닫힌 목록으로 허용하고 입력 검증은 I/O보다 앞선다. SQL1–4 파일과 SHA를 명시하며 CRLF→LF만 정규화한 후 checksum을 확인한다. 검증 후 알려진 바깥 BEGIN/COMMIT만 제거한다. 임의 manifest나 디렉터리 latest 탐색은 없다.
- SQL4 SHA256: `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`. published SQL4와 draft는 바이트까지 동일했다. SQL1–4 실제 파일에 CR byte가 없고 canonical hash가 모두 manifest와 일치했다. 전체 hash는 `evidence/provenance-audit.json`에 보존했다.
- 개발 reference `D:/starwork/dream-ai-studio/tmp/b22-postgres-8aabf65f-5b2a-47ed-ad53-4252a4df67bf/reference-catalog.json` SHA256은 `afb334759c3073f0144883dc9a2b70ab431d7dd12fb5283b4286c7a91e3f17cd`로 일치했다. 고정 literal complete3 + fixed delta4의 9개 category를 reference와 비교했다. reference에 없는 declared_arguments 필드는 reference 비교에서만 제외하고, 검증된 SQL source의 모든 9개 함수 선언과 별도로 비교했다(공백/쉼표 formatting만 정규화).
- category별 version3/4 row 수: schemas 2/2, relations 19/31, columns 217/410, constraints 330/660, indexes 90/136, policies 36/43, noninternal triggers 18/36, functions 3/9, scalar/domain types 3/3. relations에는 native journal이 포함된다. 중첩 배열 순서는 보존하고 category 행 순서만 정규화한다. descriptors/manifests는 recursive freeze된 고정값이다.
- v1 manifest/runner/provision-template/CLI, SQL1–3, package.json의 해당 commit diff는 비어 있다. v1 경로에 version4를 확장하지 않았다. 원본 테스트의 v1 complete4 거절과 v2 complete3→4 pending/complete4, unknown/partial/checksum/history 사례가 통과했다.
- inspector는 expected identity primitives를 먼저 snapshot하고 실제 database/session_user/current_user/port, PostgreSQL 최소 버전, canonical search_path, management 권한, Auth users.id UUID/NOT NULL/유효 단일 unique key 및 schema USAGE/REFERENCES, reserved role flags/허용 graph를 검사한다. fixed catalog 비교 뒤 journal rows를 읽는다. 위 독립 공격과 원본 71개가 이 경로의 대조 근거이며, F-B22R-1 때문에 owner/ACL 전체 적합 판정은 FAIL이다.
- query set은 SELECT이며 inspector에 target factory, apply, transaction lifecycle, TLS 설정, lock 또는 COMMIT이 없다. caller가 이미 인증한 client와 안정적인 transaction을 제공하는 B21/B22 foundation 계약이다. 미구현 apply/TLS/lock/COMMIT을 이번 결함으로 요구하지 않는다. 실제 target TLS 검증이나 advisory-lock 보장은 주장하지 않는다.
- catalog 표현은 실제 검증한 Windows PostgreSQL 18.7 UTF8/C 기준이다. 최소 버전 gate >=16은 PG16/17/managed 표현 호환성 검증을 뜻하지 않는다. 모든 외부 관리자 또는 다른 schema의 내부 객체까지 포괄적으로 검출한다는 보장은 없다. mutable target의 동시 DDL 일관성은 caller transaction 범위다.

## 증거 및 종료

owned copy 하위 경로:

- `tests/postgres/b22r-independent.test.ts`, `tests/postgres/b22r-run-independent.mjs`.
- `evidence/provenance-audit.json`, `provenance-audit.log`, `baseline-integrity.json`, `static-checks.json`, `type.log`, `lint.log`, `pure-v1-v2.log`, `cleanup-audit.json`.
- 각 runner root의 `run.json`, `tests.log`, `signatures.log`, `version.txt`, `initdb.log`, `start.log`, `stop.log`, `cleanup-safe.json`.
- 최종 root의 `reviewer-observations.jsonl`: native owner/ACL 및 실제 inspector 반환, journal read 여부.

| retained runner root (`tmp/` 아래) | PID / port | 결과 |
| --- | --- | --- |
| b22-postgres-942b2574-218f-4631-93d8-2000febc2823 | 78040 / 61680 | 원본 71 PASS |
| b22r-independent-30f70356-ae6e-4ac1-93ed-1b26ea2eb983 | 75684 / 61871 | 초기 19개, fixture 오류 포함 |
| b22r-independent-dfb43d0c-0325-4070-bcbd-21e2244bad49 | 57864 / 55952 | 수정 fixture 14/5 |
| b22r-independent-9f921a9a-d18b-4269-8542-05df1233927e | 48948 / 51757 | 최종 14/6 |

모두 own loopback synthetic cluster이고 runner가 도구 서명을 검증했다. 01:08 KST 재확인 시 4개 PID와 listener 모두 없으며 각 cleanup-safe의 postmasterPidAbsent/listenerAbsent는 true였다. 사용자 3013 listener PID51032는 그대로 확인했다. 공유 `.next`, 다른 WIP, 실제 env/Auth/DB/managed/SSL/storage/runtime/deploy는 조작하지 않았다. production build와 배포는 이번 검토 범위가 아니다.

Master에 최초 FAIL `msg_5132f140cd26`, ACL 추가 `msg_c6c6177f56c8` 전달. Master가 공통 원인 1건의 필수 수정 FAIL로 판단하고 Backend B22-FIX를 배정했다. Master의 직접 전달 허가에 따라 Backend에도 `msg_1b65a6c00a67`, ACL 증거 `msg_14ab2cf81a8c`를 전달했다. Backend 수신 `msg_c64661fdb2c7` 확인. 짧은 terminal alias 전송 1회는 terminal_not_found였고 full terminal ID 전송은 성공했다. 이 보고서 완료와 수정본 재검증은 별개다.
