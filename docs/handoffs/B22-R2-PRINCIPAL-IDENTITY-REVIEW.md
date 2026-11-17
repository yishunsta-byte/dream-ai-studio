# B22-R2 principal identity independent review — PASS

검토 고정 SHA는 `f5d009ec72ce9411eeda322fa1ca12b2345dbe65`이다. 2026-11-18 KST, Master 배정 `msg_a7791c60b99f`에 따라 기존 Tester 세션에서 독립 재검수했다. 검토 기준은 B21/B22 foundation 계약, B22-FIX-PRINCIPAL-IDENTITY 및 원 B22-R 보고서 commit `b4d9d4f7e891fe1d6e7b48ac4bc5976404383ba2`이다.

**판정 PASS: 이 고정본에서 F-B22R-1 principal marker 충돌이 해소됐다.** 원본 88개, 기존 독립 20개, 추가 독립 25개가 모두 통과했다. 이전 6개 STATE 거절 기대값을 그대로 유지했으며 native owner/ACL 증거도 유지됐다. 이는 caller-owned SELECT-only catalog foundation의 제한된 수락이며 apply/CLI/실환경 운영 수락은 아니다. 원 `853e861`의 FAIL 기록은 변경하지 않았다.

## 원인 수정과 독립 확인

기존 문자열 `$owner`/`PUBLIC`/role name을 다음의 분리된 JSON 값으로 바꿨다.

```json
{"kind":"owner"}
{"kind":"public"}
{"kind":"role","name":"$owner"}
```

owner는 native OID가 session_user OID와 같을 때, public은 ACL grantee 또는 policy role OID0일 때 생성된다. 실제 role 이름은 항상 role/name 값이며 JSON처럼 보이는 이름을 파싱하지 않는다. 객체 owner가 임의 외부 role이어도 ACL grantor/grantee의 owner 판정 기준은 session_user OID로 일관된다. 이름 블랙리스트는 추가하지 않았다.

수정된 모든 의미 principal 위치를 읽고 실 PG로 확인했다: schema/relation/function/domain owner, schema/relation/column/function/domain ACL grantor·grantee, policy roles. 기대 descriptor는 고정 literal이며 runtime target의 데이터를 기대값으로 학습하거나 재생성하지 않는다. metadata 검사가 journal 내용 SELECT보다 먼저 수행되는 구조와 frozen descriptor, native journal/identity/Auth/권한/role graph 검사는 유지된다.

원 6개 변형의 결과는 모두 `MIGRATION_STATE`이고 `historyRead=false`다. owner 5개는 native `same_owner=false`, ACL-only는 실제 함수 owner가 정상인 채 외부 `$owner`에 EXECUTE가 이전된 상태를 확인했다.

| 기존 실패 변형 | 수정본 결과 |
| --- | --- |
| `dream.assets` foreign `$owner` | STATE, history 미독출 |
| `dream_migrations.history` foreign `$owner` | STATE, history 미독출 |
| `dream` schema foreign `$owner` | STATE, history 미독출 |
| `dream.storage_guard()` foreign `$owner` | STATE, history 미독출 |
| `dream.safe_uint` domain foreign `$owner` | STATE, history 미독출 |
| `storage_raw_hash(text,text)` 정상 owner + foreign EXECUTE grantee | STATE, history 미독출 |

실제 기록은 원본 runner root의 `owner-observations.jsonl`에 있다. 기존 독립 20개 파일도 이전 owned copy에서 바이트 그대로 복사해 다시 실행했다. 실패를 통과로 바꾸거나 assertion을 삭제/skip하지 않았다.

## 독립 환경과 결과

새 owned archive는 `D:/starwork/b22r2-source.zip`, 복사본은 `D:/starwork/b22r2-principal-f5d009e`다. `git -c core.autocrlf=false archive`로 고정 SHA를 추출하고 deps와 PostgreSQL 전체 도구를 물리 복사했다. 실행 전후 tracked 1,015개 blob이 고정 SHA와 일치했다. 원본 제품 파일 수정은 없다. runner는 postgres/initdb/pg_ctl/createdb의 유효 EnterpriseDB 서명 및 실제 PostgreSQL 18.7을 확인했다. 모든 DB는 owned loopback synthetic cluster다.

| 실행 | 결과 | 집계 주의 |
| --- | --- | --- |
| 수정본 원본 runner | 88 PASS / 0 skip, exit0 | 원71 + 기존 결함6 + Backend 추가11; pure22 + real PG66 |
| 원 독립 fixture | 20 PASS / 0 skip, exit0 | 원 B22-R의 기대값 그대로; 원본과 중복 경로 포함 |
| R2 추가 독립 fixture 최종 | 25 PASS / 0 skip, exit0 | 아래 구체적 사례 |
| v1 + B22 pure 파일 | 35 PASS / 66 skip, exit0 | v1 pure13 + B22 pure22; 66 DB 사례는 owned runner에서 통과 |
| TypeScript noEmit | exit0 | 최종 독립 fixture 및 보조 감사 포함 |
| targeted ESLint | exit0, warnings0 | 수정된 원본 state와 원본 test |

이 숫자는 각 명령의 실제 테스트 수다. pure 반복, 회귀 사례와 이전 실행을 더해 고유 coverage 총수로 표현하지 않는다.

추가 25개 구성:

- ACL grantee 7개: dream schema, journal schema, assets table, history table, title column, domain, function. native role이 관측 catalog의 role/name 값으로 나타나며 모두 history 읽기 전에 거절된다.
- policy 7개: foreign `$owner`, `PUBLIC`, JSON owner형, JSON public형 각각 1개; OID0 public, 실제 session owner, 두 named-role 및 PostgreSQL의 PUBLIC 목록 정규화 1개. raw polroles와 관측 tags를 함께 대조했다. 변경 policy는 모두 history 읽기 전에 거절된다.
- 실제 foreign grantor 2개: table 및 column 권한의 SQL grant-option delegation. native grantor OID와 JSON형 실제 이름이 role/name으로 관측됨을 확인했다. 모두 history 읽기 전에 거절된다.
- foreign table owner 4개: `PUBLIC`, `{"kind":"owner"}`, `{"kind":"public"}`, `{"kind":"role","name":"dream_api"}`. 실제 다른 OID를 확인했고 모두 role/name으로 표현되어 history 읽기 전에 거절된다.
- 실제 session owner 정상 4개: `$owner`, `PUBLIC`, JSON owner형, JSON named-role형. explicit project objects만 소유권 이전하고 LOCAL SESSION AUTHORIZATION을 변경해 native session/current user를 확인했다. complete4/pending0, inspector SELECT-only, descriptor 불변을 확인했다. system/bootstrap ownership은 이전하지 않았다.
- 최종 rollback 대조 1개: 원 owner의 정확한 complete4, read-only transaction, 임시 role 없음.

추가 최초 실행은 24 PASS / 1 FAIL이었다. 검토 fixture가 `ALTER POLICY ... TO PUBLIC,"PUBLIC"` 결과에 role 2개가 남는다고 잘못 가정했다. 실제 PostgreSQL의 native polroles가 `[0]` 하나로 저장되는 것을 별도 확인했다. fixture는 두 named-role 조합을 별도로 확인하고, PUBLIC 포함 조합은 native `[0]`과 public tag가 일치하는지 확인하도록 수정했다. 두 경우 모두 제품의 STATE 거절 및 history 미독출 기대값은 유지했다. 최종 25 PASS이며 최초 오류를 제품 결함으로 세지 않는다. 최초 로그도 보존했다.

## 출처와 불변 범위

state 파일의 실제 LF SHA256은 요청값과 일치한다: `c51745a4c482732a428374831690ebd1eb5ee310487221cf9a95858465c77f70`.

원 개발 reference JSON의 SHA256 `afb334759c3073f0144883dc9a2b70ab431d7dd12fb5283b4286c7a91e3f17cd`를 다시 검증했다. 파일은 `D:/starwork/dream-ai-studio/tmp/b22-postgres-8aabf65f-5b2a-47ed-ad53-4252a4df67bf/reference-catalog.json`이다. 알려진 정상 synthetic owner로 생성된 해당 reference의 의미 principal 필드(owner/ACL 첫 두 값/policy roles)만 독립 보조 감사에서 tagged 형식으로 변환했다. 다른 값과 순서는 보존했다. target query 결과를 변환해서 기대값으로 사용한 것이 아니다. version3/4 literal의 9개 category가 변환된 reference와 일치했다. reference에 없는 declared_arguments는 그 비교에서만 제외하고 검증된 SQL의 모든 9개 함수 선언과 별도로 일치 확인했다(공백/쉼표 형식만 정규화).

category row 수 version3/4: schemas 2/2, relations 19/31, columns 217/410, constraints 330/660, indexes 90/136, policies 36/43, noninternal triggers 18/36, functions 3/9, types 3/3. nonprincipal catalog 내용과 source는 바뀌지 않았다.

SQL1–4는 LF-only이며 manifest의 canonical checksum과 모두 일치했다. SQL4는 draft와 바이트까지 같고 SHA256은 `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`다. 수정 commit의 tracked 변경은 state, 기존 B22 test, 고유 Backend 보고서 3개뿐이다. v1/SQL1–4/B19/runtime/manifest/package/원 B22-R 보고서의 변경은 없다. 독립 감사의 protected diff도 비어 있다. 보조 감사 초기에 원 보고서가 아직 없던 853e861을 diff 기준으로 잡아 assertion이 발생했으나, 그 보고서를 포함하는 b4d9d4f 기준으로 수정해 실제 불변 여부를 확인했다. 제품 오류가 아니다.

## 명령과 retained evidence

다음은 owned copy cwd에서 실행했다.

```text
node tests/postgres/run-versioned-source-catalog-local.mjs --bin D:/starwork/b22r2-principal-f5d009e/.tools/pgsql/bin
node tests/postgres/b22r-run-independent.mjs --bin D:/starwork/b22r2-principal-f5d009e/.tools/pgsql/bin
node tests/postgres/b22r2-run-extra.mjs --bin D:/starwork/b22r2-principal-f5d009e/.tools/pgsql/bin
node node_modules/vitest/vitest.mjs run tests/postgres/migrations.test.ts tests/postgres/versioned-source-catalog.test.ts
node --conditions=react-server --import tsx tmp/b22r2/audit.ts
node tmp/b22r2/verify-baseline.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/migration-state-v2.ts tests/postgres/versioned-source-catalog.test.ts --max-warnings 0
```

독립 runner는 원본 runner에서 root prefix와 test filename만 변경했다. `tests/postgres/b22r-independent.test.ts`는 원 독립20 그대로, `tests/postgres/b22r2-extra.test.ts`는 추가25다. fixture는 synthetic Auth/v1 version3/검증된 SQL4/native journal row4를 설정하고 변형마다 BEGIN/ROLLBACK한다. 추가 정상 owner 실험도 같은 rollback 범위다.

owned `evidence/`에 original-run.log, prior-independent-run.log, extra-run.log, extra-final-run.log, pure-v1-v2.log, provenance-audit.json/log, baseline-integrity.json, static-checks.json, type.log, type-final.log, lint.log, cleanup-audit.json을 보존했다. 각 runner root에는 run.json/tests.log/signatures.log/version.txt/start.log/stop.log/cleanup-safe.json이 있다. 원본 root의 owner-observations.jsonl과 독립 root의 reviewer-observations.jsonl에 실제 결과가 있다.

| owned `tmp/` retained root | PID / port | 결과 |
| --- | --- | --- |
| b22-postgres-3efa608a-3524-4f50-aa96-51d306dced4b | 56572 / 61046 | 88 PASS |
| b22r-independent-27147fcb-f458-401c-8c74-d9b96ed91bea | 69284 / 61070 | 20 PASS |
| b22r2-extra-921647fb-a627-4839-897d-642aff948ab0 | 75044 / 53728 | 최초 추가25, reviewer fixture 오류1 |
| b22r2-extra-7d2a560a-8a7d-44d1-8264-6bd75e548433 | 67272 / 49185 | 최종 추가25 PASS |

01:18–01:19 KST 재확인에서 4개 PID/listener 모두 없고 각 cleanup-safe postmasterPidAbsent/listenerAbsent가 true였다. owned path를 명령행에 포함하는 node/postgres 프로세스도 없었다. 사용자 3013 listener PID51032는 그대로였다. 공유 `.next`, 실 env/Auth/DB/managed/SSL/Storage/API/배포는 조작하지 않았다. 공유 쓰기는 이 지정 보고서뿐이다. 추가 agent/window/scheduler를 만들지 않았다.

## 수락 한계와 전달

검증 환경은 Windows signed PostgreSQL 18.7 UTF8/C다. PG16/17/managed/collation별 표현 호환성은 추가 수락하지 않는다. inspector는 이미 신뢰된 client와 caller-owned 안정적 transaction 안의 SELECT-only foundation이다. 자체 connection authority/TLS 검증, apply/CLI, lock/COMMIT 구현이나 concurrent DDL 전체 보장은 범위 밖이며 그 미구현 자체를 이번 FAIL로 혼입하지 않았다. 운영 배포, 실제 Auth/Storage 또는 provider 동작도 검증하지 않았다. 전체 관리자·다른 schema 내부 객체를 포괄 검출한다는 주장도 없다.

착수 회신 `msg_6fd6d673e4aa`, 중간 결과 `msg_77832dffbd9e`를 기존 Master terminal에 실제 전달했다. 본 보고서만 선택 commit하여 최종 판정·commit·증거 경로를 다시 전달한다. 이 PASS는 고정 f5d009e의 F-B22R-1 수정 재수락이며 다음 apply/운영 작업의 자동 승인이 아니다.
