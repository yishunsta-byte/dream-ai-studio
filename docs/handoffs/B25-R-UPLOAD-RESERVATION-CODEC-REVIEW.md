# B25-R reserved upload codec independent review — PASS

고정 SHA `da0f7407e194a0dc84c612b44fb98aa43f2efc2a`, Master 배정 `msg_dde6a31e68b3`, 착수 `msg_72ccd5753e1c`. T234 최종 반환과 브라우저/서비스 종료 뒤 단일 활성 검수로 전환했다. B25 handoff, B19-FIX4/accepted model의 checkedModel·reserveUpload·schema, SQL4 및 v1.4를 읽었다.

**판정 PASS: pristine-reserved-only 순수 codec의 지정 범위를 수락한다.** 원본86개와 추가49개가 첫 실행에서 모두 통과했다. raw UTF-8/semantic hash·snapshot consistency·정확한 시간·fixed SQL parameter/row projection·소유 synthetic PG roundtrip/rollback을 검증했다. 이 결과는 인증된 owner·live policy·production reservation transaction·least privilege·Storage 개통의 수락이 아니다.

공유 쓰기는 이 고유 보고서뿐이다. 제품 수정, 새 agent/window/worktree, browser, production build/deploy, 실 env/managed/SSL/Storage/API/공유.next/3013 조작은 없다. T236 후속 배정은 수신했지만 B25 최종 반환 전에 병렬 착수하지 않았다.

## 고정 입력·출처

- 새 archive `D:/starwork/b25r-source.zip`, owned copy `D:/starwork/b25r-codec-da0f740`. LF 보존 archive와 물리 복사 deps/PG 도구를 사용했다. 실행 전후 tracked1,036개 blob이 모두 고정 SHA와 일치했다.
- codec LF SHA256: `761f416fd90640e557ff978613dee274c3e9e47f4331946d072186a9e16133b2`, 요청값과 일치.
- candidate commit은 codec/test/local runner/handoff 신규4파일뿐이다. 기존 SQL1–4/B19/v1/target/connection/catalog/runner/CLI/runtime/package/계약은 변경하지 않았다. 보호20경로 diff와 source 감사는 통과했다.
- SQL1–4 canonical hash/LF-only, SQL4=draft bytes, fixed manifest 및 descriptor source를 재검증했다. SQL4 SHA256 `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`. reference SHA256 `afb334759c3073f0144883dc9a2b70ab431d7dd12fb5283b4286c7a91e3f17cd`도 일치했다. 전체 근거는 evidence/provenance-audit.json이다.

## 구현 계약 검토

encode는 두 key(model/requestJson)만 받고 accepted plain-data parser와 checkedModel을 사용한다. 원 envelope에서 reserveUpload로 pristine 모델을 재구성한 뒤 전체 canonical 모델과 비교한다. lifecycle reserved라는 표지만 믿지 않고 이미 capability가 발행된 evolved reserved 모델도 거절한다. 입력을 동결/변경하지 않고 detached frozen 결과를 반환한다.

codecVersion1 envelope는 원 requestId/maxBytes/reservedAt와 owner/object/asset/intent/time/정책 epoch·digest/순서 있는 authority arrays/incoming bucket·key·nullable providerVersion을 담는다. SQL에 별도 열이 없는 초기 policy·incoming version도 영구 raw envelope에 보존한다. 누락한 snapshot을 추측하거나 현재 policy로 대체하지 않는다.

bounded raw scanner가 JSON.parse 전에 duplicate decoded key, unsafe/분수/지수/음수/negative-zero numeric token 및 NUL/unpaired surrogate를 거절한다. valid whitespace/key ordering/string escape는 허용한다. exact raw JSON은 재직렬화하지 않고 UTF-8 SHA256으로 보존한다. semantic fingerprint는 accepted domain `upload-reservation-request:v1`과 canonical sorted-key JSON을 사용한다. 따라서 동일 Unicode의 escape/format 변형은 semantic hash가 같고 raw hash가 다르다. Unicode normalization이나 upstream network byte 보존까지 보장하는 것은 아니다.

owner/authority는 기존 lowercase general UUID, object/asset/intent/request는 UUIDv7이다. codec이 새 UUID 권한 범위를 만들지 않았다. model/raw/분리된 row owner·ID·policy·time·limits·incoming 값을 대조하며 배열의 순서와 허용 duplicate를 그대로 보존한다. model의 negative zero와 비정상 row representation은 복구하지 않고 거절한다.

SQL은 fixed INSERT2개/owner-bound SELECT2개이며 입력은 values에만 들어간다. 객체의 pristine null/false/0 groups와 intent open/0 groups는 명시적이다. pool/환경/Auth/provider API/statement 실행/BEGIN/COMMIT/grant/outbox/업로드 capability는 없다. owner-bound WHERE는 parameter binding이며 인증된 actor나 RLS 권한의 증명이 아니다.

시간은 bigint millisecond를 UTC integer days와 나머지로 나눠 SQL interval로 변환한다. JS Date/float epoch seconds를 사용하지 않는다. SELECT는 bigint/UUID 및 epoch*1000을 text로 투영하며 sub-ms 소수부를 bigint로 반올림하지 않는다. decoder는 완전한 projected rows, 모든 pristine/null groups와 정확한 text counter/time을 요구한다. 일반 SELECT* Date rows·누락·unknown field·coerced number·비영 소수 ms는 거절한다.

## 실행 결과와 중복

| 실행 | 결과 | 범위 |
| --- | --- | --- |
| 원본 owned runner | **86 PASS /0 skip**, exit0 | pure74 + 실제 PG12 |
| 추가 독립 owned runner | **49 PASS /0 skip**, exit0 | pure37 + 실제 PG12 |
| B19+codec pure 회귀 | **130 PASS /12 skip**, exit0 | B19 original56 + codec pure74, DB12는 이 명령에서 미실행 |
| TypeScript noEmit | exit0 | reviewer fixture/감사 포함 |
| original targeted ESLint | exit0, warnings0 | codec/original test/local runner |

pure74는 원본86과 중복이며 다시 가산하지 않는다. 49도 별도 test case 수이고 원본과 일부 검증 경로가 겹친다. 기존 real PG suite나 작성자의 과거 반복 실행을 이번 새 coverage로 계산하지 않는다. 이번 원본/추가 suite는 기대값 완화·skip·제품 수정 없이 처음 실행부터 통과했다.

원본74에서 source/model immutable·semantic/raw hash·snapshot 불일치·evolved reserved·중복 key/숫자 lexeme/NUL/surrogate/-0/getter·row mismatch/partial/unknown/null/text coercion을 재현했다. 원 PG12는 committed roundtrip, MAX_SAFE3timezone, epoch0/DST, hostile string, mid-insert FK rollback, AuthFK/rawSHA/2GiB DB constraint, sub-ms rejection, API role42501, 최대 metadata, permanent request uniqueness를 포함한다.

추가 pure37의 정확한 구성:

- 숫자 lexeme8: `+1000`, leading0, leading dot, exponent, underscore, NaN, Infinity, comment. 모두 raw에서 거절.
- nested decoded duplicate3: ownerId의 escaped alias, incoming bucket의 escaped alias, policyEpoch 중복.
- UUID6: object/asset/intent/request에 general UUID를 잘못 사용, uppercase owner, newline owner 거절.
- object pristine null group13개 각각 nonnull 거절.
- intent numeric projection3개: 비영 sub-ms, negative-zero text, leading-zero counter 거절.
- astral Unicode escape semantic/raw 구분1, 순서·duplicate authority 보존과 fingerprint 변화1, coherent rehash 일관성/권한 한계1, fixed4 SQL/immutable owner parameters/hostile text1.

추가 실제 PG12:

| 사례 | 실제 관측 |
| --- | --- |
| UTC day carry ×UTC/New_York/Auckland (3개) | created86399999, issue86400000, expiry86400001ms가 세 timezone 모두 동일한 exact projection/model로 복원 |
| MAX_SAFE whole-day carry ×동일3timezone (3개) | created9007199168340990, expiry9007199254740991ms의 text `.000000`와 모델/reencode params가 정확히 일치 |
| owner-bound SELECT (1개) | 두 fixed SELECT에서 다른 owner parameter는0행, 올바른 owner는 exact model |
| intent sub-ms decode 실패 (1개) | test-only SQL timestamp1µs 추가 후 3000.001000ms가 투영되어 decoder 거절. caller transaction rollback 후 object/intent 모두0행 |
| second INSERT raw SHA 실패 (1개) | 첫 object가 native1행임을 확인하고 두 번째 INSERT23514. rollback 후 새 object0, 기존 committed raw row 바이트 보존 |
| hostile Unicode/epoch0 (1개) | quoted SQL-looking/newline/emoji/한글 providerVersion과 raw JSON exact roundtrip/native SHA 일치, assets table 유지 |
| authority100/minBytes1/MAX_SAFE policy (1개) | 배열 순서·duplicate, policy epoch와 raw metadata 복원 |
| permanent request duplicate (1개) |23505, 새 object rollback, 먼저 저장한 원문 보존 |

sub-ms 실험은 정상 fixed codec SQL을 바꾼 제품 변경이 아니라, 별도 test query로 비표현 가능 DB row를 만들어 decoder 거절을 확인한 fault fixture다. atomicity는 **test caller가 제공한 transaction**의 결과이며 codec 자체가 자동 transaction을 제공한다고 주장하지 않는다.

## 권한·신뢰 한계

coherent policy epoch/digest와 unkeyed hash를 함께 재작성한 입력은 일관된 데이터로 받아들여진다는 독립 양성 대조도 통과했다. 이것은 취약점 재현이 아니라 명시된 trust boundary다. codec은 원 데이터만으로 실제 actor·현재 trusted policy·provider state·서명·byte receipt를 증명하지 않는다. decoded data를 VerifiedActor나 trustedPolicy로 branding하지 않는다.

test admin으로 INSERT/SELECT가 된 것은 production 예약 권한이나 least-privilege 설계 수락이 아니다. 원 API role의 거절은 유지된다. 실제 예약 transaction/idempotent lookup/정책 lock/CAS/lease/fencing/outbox/IO/Storage 한도·개통은 별도 구현·검수 대상이다. stored maxBytes는 실제 provider plan 한도를 우회하는 허가가 아니다.

## 명령·증거·종료

cwd `D:/starwork/b25r-codec-da0f740`:

```text
node tests/postgres/run-upload-reservation-local.mjs --bin D:/starwork/b25r-codec-da0f740/.tools/pgsql/bin
node tests/postgres/b25r-run-independent.mjs --bin D:/starwork/b25r-codec-da0f740/.tools/pgsql/bin
node node_modules/vitest/vitest.mjs run tests/storage-upload-protocol.test.ts tests/postgres/upload-reservation-codec.test.ts
node --conditions=react-server --import tsx tmp/b25r/audit.ts
node tmp/b25r/verify-baseline.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/db/postgres/upload-reservation-codec.ts tests/postgres/upload-reservation-codec.test.ts tests/postgres/run-upload-reservation-local.mjs --max-warnings 0
```

독립 `tests/postgres/b25r-independent.test.ts`는 원 fixture/setup/insert/select helper를 재사용하고 별도 assertions/경계 사례를 작성했다. 독립 local runner는 원본 runner의 root prefix/test filename만 변경했다. actual SQL1–4 setup은 accepted v2 runner로 자기 synthetic Auth/cluster에만 수행했다.

owned evidence에는 original-run.log, independent-run.log, pure-regression.log, type.log, lint.log, static-checks.json, baseline-integrity.json, provenance-audit.json/log, cleanup-audit.json이 있다. 각 runner root에는 run.json/tests.log/signatures.log/version.txt/start.log/stop.log/cleanup-safe.json이 있고 독립 root의 reviewer-observations.jsonl에 native times 및 rollback 대조를 보존했다.

| owned `tmp/` root | PID / port | 결과 |
| --- | --- | --- |
| b25-postgres-e410e8d0-131d-4819-b2cc-cc783abfaeb2 | 69584 / 59719 | 원본86 PASS |
| b25r-independent-3832f174-c29d-40ea-9aa2-ea9b4bfca2f7 | 11272 / 61466 | 추가49 PASS |

03:07 KST 전후 재확인에서 두 PID/listener가 없고 cleanup-safe의 postmasterPidAbsent/listenerAbsent는 true였다. signed EnterpriseDB 도구4개/actual PG18.7/owned loopback 확인 로그를 남겼다. 사용자3013 PID51032 유지, 정리 증거는 cleanup-audit.json이다. 증거 디렉터리는 삭제하지 않았다.

실제 호환성은 Windows/Node26/PG18.7 synthetic이다. 다른 PG16/17/locale/managed/실제 권한·네트워크/provider는 새로 검증하지 않았다. 공통 model의 bounded consistency 한계를 확대하지 않는다. 테스트 raw string 보존은 upstream이 원 network bytes를 보존했다는 증거가 아니다.

중간 결과 `msg_762033bd77fc`를 Master에 전달했다. 이 보고서만 선택 commit하고 final SHA/수량/한계/cleanup/commit을 실제 Orca로 반환한다. 이후 T236은 별도 fixed 후보와 browser 독점 조정으로 착수한다.
