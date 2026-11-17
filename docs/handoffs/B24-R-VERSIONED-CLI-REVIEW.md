# B24-R versioned CLI independent review — PASS

검토 고정 SHA: `eccac352d1ab8c34f5ee3ba8e5f4a65bbac8777c`. Master 배정 `msg_e7fc71f43d83`, 착수 회신 `msg_5962743c130f`. 2026-11-18 KST, 기존 Windows Tester 세션에서 지정 신규4파일/B24 handoff/B23 수락 보고/공통 v1.4를 읽고 독립 검수했다.

**판정 PASS: 별도 opt-in v2 CLI의 지정 synthetic 범위를 수락한다.** 원본59개 및 추가 독립43개가 통과했다. 최종 실제 자식 프로세스는 원본22개와 추가20개다. 승인·환경 snapshot·출력 projection과 child 종료/secret 검사를 확인했다. CLI fingerprint는 사람 승인 증명이 아니며 managed 접속/운영 적용/배포 수락으로 확대하지 않는다.

공유 쓰기는 이 고유 보고서뿐이며 제품 수정은 없다. 새 window/agent/worktree/scheduler를 만들지 않았고 프로덕션 빌드/배포를 실행하지 않았다. 원 B23 PASS와 B22의 역사적 FAIL/PASS 기록을 변경하지 않았다.

## 고정본·출처

- 새 archive `D:/starwork/b24r-source.zip`, owned copy `D:/starwork/b24r-cli-eccac35`. LF 보존 git archive와 물리 복사 deps/PG18.7을 사용했다. tracked 1,025개 blob은 실행 전후 고정 SHA와 모두 일치했다.
- CLI LF SHA256: `36325c91d58270f8389799238ac6b6e93d9c7be076882f569f317423d1c10922`로 요청값과 일치한다.
- candidate commit은 CLI/new test/local runner/B24 handoff 4개만 추가했다. v1 CLI/accepted runner/target/connection/state/manifests/SQL1–4/B19/runtime/package/기존 계약은 제품 변경이 없다. 보호16경로 source diff 감사도 비어 있다.
- 고정 source/reference 감사도 통과했다. SQL1–4 hash/LF-only, SQL4=draft 바이트, 고정9 category 및 함수 선언을 확인했다. SQL4 SHA256은 `61ceb11566a9d4a601a9c351cddf13be464b0bb75dcd8d669cef1ee70ae6089c`, 원 reference SHA256은 `afb334759c3073f0144883dc9a2b70ab431d7dd12fb5283b4286c7a91e3f17cd`다. 기대 catalog를 대상 DB에서 학습하지 않는다.
- 오프라인 checksum 실패 실험은 **별도의 보조 archive** `tmp/b24r/source-probe`의 SQL4에 주석을 추가했다. 원 고정본 경로의 SQL은 건드리지 않았다. 해당 보조 CLI의 실제 child fingerprint4는 SOURCE/exit1을 반환했다. 이 의도된 변조본은 증거로 남겼으며 정상 candidate로 사용하지 않는다.

## 입력·승인·출력 검토

문법은 `fingerprint --schema 3|4 --mode dry-run|apply`, `dry-run --schema 3|4`, `apply --schema 3|4`의 고정 순서와 길이뿐이다. alias/latest/숫자 coercion/reordered/duplicate/secret argv가 없다. parser와 adapter는 거절한 토큰을 echo하지 않는다.

명시 환경변수11개(URL/profile/project ref/session host/port/database/username/role/CA/target hash/approval hash)를 첫 await 전에 own data property로 snapshot한다. 11개 각각의 own getter를 검수해 호출 없이 TARGET 거절했다. inherited required URL/profile getter는 읽지 않아 target을 공급할 수 없었다. managed-session의 전체11개와 argv를 await 중 바꿔도 원 target metadata/CA/hash/version/mode가 그대로 frozen target으로 전달됐다. managed 검증은 mock이며 실제 네트워크 접속은 없다.

DATABASE_URL/PG*/.env fallback과 secret argv/source-root 옵션은 없다. fingerprint는 선택 고정 source를 읽고 target/action/manifest hash를 계산하는 offline 정보다. runner/pool을 호출하지 않고 env에 승인값을 쓰지 않는다. 실제 잘못된 source probe도 실패했다. 별도 supplied hash가 없으면 execution은 거절되고, supplied wrong digest를 CLI가 계산한 값으로 대체하지 않고 runner에 정확히 전달한다. apply 경로에서 CLI approval hash 함수를 호출해 자가 승인하지 않는 것도 mock으로 확인했다. 실제 schema3 fingerprint의 approval hash는 schema4 apply에 사용하면 TARGET/exit1이었다.

성공 출력은 command/hash/schema/fromVersion/mode/counts/fixed manifest의 닫힌 projection이다. 추가 private 필드와 manifest private 값은 출력하지 않는다. schema/mode/hash/manifest 순서/결과 누락 및 기존 원본의 잘못된 count를 unknown failure로 처리하며 재시도하지 않는다. 일반 manifest 객체의 key 순서는 semantic하게 비교한다.

오류는 closed migration code만 출력하고 FAILED에는 not-applied/unknown/committed를 보존한다. 임의 driver message/cause/stack/환경/거절 토큰을 출력하지 않는다. broken writer는 한 번만 쓰기를 시도하고 exit1이며 runner를 재실행하지 않는다. 실제 stdout pipe를 닫은 fingerprint child도 stderr 없이 exit1이었다. 출력 실패는 DB rollback의 증거가 아니며 운영자가 별도로 상태를 확인해야 한다.

## 테스트 수량과 실제 출력 감사

| 실행 | 결과 | 집계 범위 |
| --- | --- | --- |
| 원본 B24 owned runner | 59 PASS / 0 skip, exit0 | pure45 + child case14 |
| 추가 독립 최종 runner | 43 PASS / 0 skip, exit0 | adapter33 + child case10 |
| v1/B22/B23/B24 pure 회귀 | 126 PASS / 100 skip, exit0 | pure13+22+46+45; DB66+20+14는 이 명령에서 미실행 |
| 최종 TypeScript noEmit | exit0 | 독립 fixture 및 보조 archive 포함 |
| original targeted ESLint | exit0, warnings0 | CLI/original test/original local runner |

pure 반복/이전 실행/기존 수락된 DB suite를 새 coverage로 중복 가산하지 않는다. 이번 변경은 CLI-only이며 B22/B23 전체 real PG matrix를 재실행하지 않았다. 그 경계는 기존 수락과 코드 불변, CLI의 실제 child 경로로 연결한다.

| 최종 child 실행 | 총수 / 종료 | stdout/stderr 감사 |
| --- | --- | --- |
| 원본14 case | 22 children = exit0 13 / expected exit1 9 | import1은 stdout 빈 값, 나머지21은 한 줄 JSON; stderr 모두 빈 값 |
| 독립10 case | 20 children = exit0 11 / expected exit1 9 | import1·broken stdout1은 stdout 빈 값, 나머지18은 한 줄 JSON; stderr 모두 빈 값 |

모든 child가 close event를 반환했고 timeout/다른 종료코드는 없었다. stdout+stderr에서 synthetic canary, 실제 owned fixture 비밀번호, 실제 owned full DSN을 문자열로 검사했으며 모두 미노출이었다. `evidence/child-output-audit.json`은 label/exit/byte 수와 안전한 판정을, 각 root의 `child-output.jsonl`은 raw streams를 보존한다. expected exit1은 passing assertion의 정상 음성 사례이며 제품 미해결 실패가 아니다. broken pipe는 출력 전달 불가를 의도했으므로 JSON 수신을 주장하지 않는다.

원본 actual child는 offline schema3/4×mode fingerprints, import 무실행, fresh4 dry-run, fresh3→upgrade4→zero, fresh4→downgrade 거절, fingerprint 이후 missing approval 거절, action/target/general env 거절, secret argv 거절, partial history 유지, fresh SQL4 원자 rollback, connection-refused redaction을 포함했다.

추가 adapter33의 정확한 구성은 strict/secret grammar8, 각 env getter11, inherited required getter2, 전체11 snapshot1, 별도 wrong hash 그대로 전달1, source 실패 offline/no-pool1, outcome3, malformed result5, broken writer1이다. source 실패 mock과 보조 archive의 실제 checksum 실패를 구분했다.

추가 child10 /20 invocations:

| case / 실제 command | child 수 | 확인 |
| --- | --- | --- |
| fingerprint schema3/apply → apply schema4 | 2 | version binding 불일치 TARGET, native fresh 유지 |
| approved env와 apply-looking argv 상태의 module import | 1 | exit0/무출력/무실행, native fresh |
| dry-run3 → apply3 → repeat3 | 3 | pending3/원상태 유지 → applied3 → applied0; history/timestamp 정확 보존 |
| apply3 → dry-run4 → ACL drift 후 apply4 | 3 | plan pending1이어도 STATE 거절, history3 보존/SQL4 없음 |
| apply3 → mid-SQL4 upgrade exception apply4 | 2 | FAILED/not-applied, history3와 raw JSON bytes 유지, SQL4 residue 없음 |
| apply3 → checksum drift apply4 | 2 | HISTORY, 잘못된 history를 수정하지 않음 |
| apply4 → foreign `$owner` journal owner → owner 복원 repeat4 | 3 | STATE 거절 및 정상 복원 후 applied0 |
| 실제 stdout pipe 단절 fingerprint4/apply | 1 | exit1/stderr 빈 값/native fresh, write 재시도 없음은 unit 근거와 연결 |
| 별도 변조 source probe의 fingerprint4/apply | 1 | SOURCE/exit1/offline, 원 고정 source 보존 |
| apply4의 forbidden `--approval-hash`, `--source-root` | 2 | TARGET/exit1, canary argv echo 없음/native fresh |

child 실행은 아래 Node/tsx 방식이며 DSN/CA/hash는 env로만 전달했다. forbidden argv는 synthetic canary뿐이고 실제 DSN은 argv에 넣지 않았다.

```text
node --conditions=react-server --import tsx scripts/postgres/migrate-v2.ts fingerprint --schema 3 --mode apply
node --conditions=react-server --import tsx scripts/postgres/migrate-v2.ts dry-run --schema 3
node --conditions=react-server --import tsx scripts/postgres/migrate-v2.ts apply --schema 3
node --conditions=react-server --import tsx scripts/postgres/migrate-v2.ts apply --schema 4
node --conditions=react-server --import tsx --input-type=module -e "process.argv=[process.execPath,'reviewer-import','apply','--schema','4']; await import('./scripts/postgres/migrate-v2.ts')"
```

unknown/committed **CLI 전달**은 accepted runner error의 mock 사례다. 실제 child 오류는 not-applied 및 closed admission/state/history/source 오류였다. B23-R의 실제 서버 COMMIT 뒤 응답 유실 및 확인 COMMIT 뒤 cleanup 실패 증거는 별도 수락 범위이며 이번에 물리적인 network 장애나 CLI의 새 실제 unknown 발생으로 재표현하지 않는다.

## fixture 오류와 static 보정

최초 독립 실행은 41 PASS /2 FAIL이었다. 검토자가 getter-only prototype을 만든 다음 Object.assign으로 같은 key를 쓰면서 **CLI 진입 전** TypeError가 발생했다. inherited key를 own 복사에서 제외하도록 fixture 구성을 고쳤다. getter 미호출/실행 미호출/TARGET 기대값은 그대로이고 최종43 PASS다. 최초 실제 child20은 그때도 모두 통과했다. 최초 로그는 남기며 제품 결함으로 세지 않는다.

static 최초 검토 파일의 동적 env key 타입을 수정하는 과정에서 프로젝트의 필수 NODE_ENV ProcessEnv 확장까지 반영해야 했다. 검토 fixture의 env 타입 annotation을 NodeJS.ProcessEnv로 지정한 뒤 최종 noEmit이 통과했다. 제품 파일·런타임 assertion은 변경하지 않았다. 최종 실행 후 마지막 보정은 타입 annotation뿐이다.

## 재현·증거·종료

cwd: `D:/starwork/b24r-cli-eccac35`. 독립 runner는 원본 runner의 test filename/root prefix만 변경했다. 독립 test는 fixture/helpers를 재사용하고 별도 case/assertion을 작성했다.

```text
node tests/postgres/run-versioned-cli-local.mjs --bin D:/starwork/b24r-cli-eccac35/.tools/pgsql/bin
node tests/postgres/b24r-run-independent.mjs --bin D:/starwork/b24r-cli-eccac35/.tools/pgsql/bin
node node_modules/vitest/vitest.mjs run tests/postgres/migrations.test.ts tests/postgres/versioned-source-catalog.test.ts tests/postgres/versioned-migrations.test.ts tests/postgres/versioned-migration-cli.test.ts
node tmp/b24r/audit-children.mjs
node --conditions=react-server --import tsx tmp/b24r/audit.ts
node tmp/b24r/verify-baseline.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js scripts/postgres/migrate-v2.ts tests/postgres/versioned-migration-cli.test.ts tests/postgres/run-versioned-cli-local.mjs --max-warnings 0
```

owned `tests/postgres/b24r-independent.test.ts`가 추가 fixture다. `evidence/`에 original-run.log / independent-run.log / independent-final-run.log / pure-regression.log / provenance-audit.json/log / baseline-integrity.json / child-output-audit.json / static-final2.json / type-final2.log / lint-final2.log / cleanup-audit.json을 보존했다. 초기 static 로그도 남겼다. 각 root의 run.json/tests.log/signatures.log/version.txt/start.log/stop.log/cleanup-safe.json/child-output.jsonl이 실행 근거다.

| owned `tmp/` root | PID / port | 결과 |
| --- | --- | --- |
| b24-postgres-2a1e0d16-fc9f-409d-bbb3-f63161f8290e | 38492 / 57799 | 원본59 PASS, child22 |
| b24r-independent-b35616c3-8b66-467a-9c10-d79c4254d6d0 | 65496 / 55213 | 최초41/2 fixture 오류, child20 통과 |
| b24r-independent-a94fd01c-bae9-454e-9309-f40216dc6254 | 48644 / 51856 | 최종43 PASS, child20 |

02:12–02:13 KST 재확인에서 3개 owned PID/listener가 없고 cleanup-safe 두 flag가 모두 true였다. 각 child는 timeout 없이 close로 회수했다. 3013 PID51032는 유지됐다. runner는 PG 도구4개의 유효 EnterpriseDB 서명·실제 PG18.7·owned loopback listener를 확인했다. Node는 v26.13.0/Windows, local tsx다. 공유 `.next`, 실 env/managed/SSL/Storage/API/설정/배포는 조작하지 않았다. device는 Windows로 확인했으며 Mac mini로 추정 등록하지 않는다.

지원 수락은 이 Node/tsx/Windows/PG18.7 UTF8/C synthetic 경로다. 다른 Node/PG16·17/collation/managed Direct·Session 실제 연결과 TLS/권한/운영 준비는 미확인이다. fingerprints는 approval 정보만 제공하고 실제 승인·Storage/worker 실행·프로덕션 배포를 대신하지 않는다. B23의 bounded catalog 및 협조 advisory lock 한계도 유지된다.

중간 결과 `msg_aa3ddfffe8cb`를 Master에 실제 전달했다. 지정 보고서만 선택 commit한 후 SHA/수량/child출력/한계/cleanup/commit을 Orca로 반환한다. 공용 TEAM/상태는 Master 단일 작성이다.
