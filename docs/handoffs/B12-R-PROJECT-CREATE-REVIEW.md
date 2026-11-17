# B12-R PostgreSQL project creation 독립 검수 — PASS

- 검수자 Codex / CX-REVIEW-01, 상위 CX-MASTER-01; task `task_92f41caf9753`, dispatch `ctx_3195ad615451`.
- 고정 SHA **83affcf832d52d721416ef4074f3429753124d38**. 공유 시작 HEAD 관찰 `514a27ac42e5af1295d76c6a98eb27be396879d7`; 검증은 새 archive 사본에서만 수행했다.
- 지정된 **미연결 server service/repo + synthetic PG 범위 PASS**, 필수 결함 발견0. 실제 Storage/managed/API 쓰기 개통 수용은 아니다.

## 이번 독립 실행 결과

| 집합 | 결과 | 범위/중복 |
|---|---|---|
| 원B12 runner |20 PASS =9unit+11실PG, skip0/exit0,20:41:55 KST|원본 그대로 실행|
| 별도B4 runner|51 PASS, skip0/exit0,20:41:55 KST|다른 새cluster; connection/backend/read 회귀|
| 필요focused5파일|68 PASS, skip0/exit0,20:41:13 KST|원B12 unit9와B4 backend unit 등이 겹침|
| 자체 추가대조|14 PASS, skip0/exit0,20:43:36 KST|실제 자기B12cluster 재시작; 독립fixture|
| 원tsconfig typegen/tsc,전체lint|모두exit0,lint경고0|자기 clean archive에서 자체harness 추가 전|

중복unit/반복/작성자결과를 합산하지 않았다. 원20/별도51/focused68/자체14를 각각 보고하며 독립 coverage 총합으로 표시하지 않는다. 이번 실행에 실패/skip/기대값완화는 없었다.

## SQLite/POST/PG schema와의 계약 대조

실제로 읽은 범위: B12 service/repo/원unit9·integration11·runner 전체, 기존 `lib/services/projects.ts`, `lib/repo/projects.ts`, POST `app/api/projects/route.ts`, input validator/snapshot/menu schema, stage order, B3 transaction/actor/connection, synthetic fixture, SQL1의 프로젝트/링크/단계/감사 및FK 정의와 SQL2/3 원문해시. B12 git diff6개경로와 import 참조를 대조했다.

- 기존 SQLite create와 같은 순수 `validateProjectInputs`를 사용한다. unknown owner/email류 field 거부, trim/숫자변환/체크박스·배열기본값/선택옵션/중복UUID 배열 거부가 동일하다. 입력불량/비브랜드actor/메뉴불일치/비활성snapshot은 접속 전에 실패한다.
- menu snapshot은 server가 검증한 config에서 공급해야 한다. service는 schema parse로 복제/정규화하고 menuId/active를 검사하지만, 실제 config loader와의 동일성이나 provenance를 인증하지 않는다. schema상 유효한 위조active snapshot을 HTTP에서 전달해도 안전하다는 보장은 없다. **서버주입 경계이며 future adapter가 trusted config를 공급해야 한다.** 기존 SQLite의 snapshotForMenu는 trusted validated config에서 동작하므로 이 차이는 미연결 API의 명시적 의존성이다.
- serialization은 await 전 한 번 수행한다. 저장된TEXT snapshot/input은 그 serialized text 그대로이며 jsonb 재직렬화나 새로운hash열을 추가하지 않는다. caller가 await 중 원snapshot의 label/commonInputs/template 또는 input의title/배열을 바꾸어도 저장값은 변하지 않았다.
- id는 UUIDv7, contentRevision1, approvedPlan/currentTimeline/archive NULL, 7stage 중 intake approved/brief todo/나머지5 locked를 유지한다. PG 필수timestamp를 하나의UTC ISO시각으로 명시하고 intake승인·감사까지 같은시각을 사용한다. schema 변경 없음.
- asset purpose는 field.id를 유지한다. 같은asset을 다른purpose에 연결할 수 있다. character는 서로다른field에 반복선택돼도 ON CONFLICT DO NOTHING으로 한 번만 연결한다(원실PG 검사).
- 감사는 기존 actor label `local-user`, action `project.create`, detail `{menuId,templateVersion,contentRevision:1}`을 그대로 보존한다. 실제ownership은 별도owner_id이며 요청 actor/email로 덮어쓸 수 없다. local-user label을 Auth identity라고 해석하지 않는다.
- repository의 모든reference lookup은 tx.actorId/ID/archived_at NULL 조건과RLS를 함께 사용한다. asset 종류·owner·archive 확인 후에만 availability를 호출하며 field별오류는 foreign/missing을 구분해 누출하지 않는다.

## 별도 부정대조14와 실제 경합

추가파일은 자기 사본 `tests/postgres/b12-r-independent.test.ts`에만 있다. 원fixture/원tests/제품은 수정하지 않았다. 별도 새UUIDv7 asset/character 행을 자기합성DB에 삽입했다.

1. invalid actor/input/snapshot matrix: null/객체/비브랜드actor,owner_id주입/빈title/중복asset/초과length,menuID불일치/inactive/알수없는snapshot속성을 거부한다. validator가 돌려준 field errors와service error를 대조했고connect0 확인.
2~8. assetAvailable의 false/undefined/null/0/1/문자열true/객체 반환을 모두INVALID_INPUT400으로 거부; project·stage·assetlink·characterlink·audit 총행수 변화0.
9. callback이 code/status/errors를 위조한 exception을 던져도PROJECT_CREATE_UNAVAILABLE503으로만 반환,private message/field누출없음,행수변화0.
10. callback의 frozen assetmetadata/verifiedactor를 확인하고 원input/snapshot을 await 중 바꿨다. 실제owner/key/hash/size 전달,정규화된한글title,UUIDv7,rawTEXT+SHA256,7stage,감사payload/B4get호환을 확인했다. service는 supplied pool.end를 호출하지 않았다.
11. foreign/archived/wrongtype/missing asset은 동일INVALID_INPUT이고availability호출0,행수변화0. character foreign/archive 및purpose/dedup은 원11실PG에서도 실제확인.
12. create가asset을FOR SHARE 조회한 뒤availability gate에서 대기하게 했다. 다른실제admin client가같은asset을archive UPDATE할때 `pg_blocking_pids(updaterPID)`가실제blocker>0임을확인했다. gate해제→create COMMIT→UPDATE완료 순서와B4get성공을확인했다. 임의sleep만으로경합을추정하지않았다.
13. character는 repo.character를실actortransaction에서FOR SHARE조회후gate를걸고,다른client의archive UPDATE가같은방식으로blocked되는것을확인했다. tx종료뒤에만UPDATE완료. 이검사는repository lock검사이며create내character이후의임의callback을주입한것은아니다.
14. 마지막audit INSERT에자기전용실제trigger예외를발생시켜project/stage/assetlink/characterlink/audit 전부rollback 및오류sanitization 확인. 원11의stage/assetlink/characterlink/audit4실패지점도재현했다.

FOR SHARE는검증한행의metadata/archive/delete변경을현재transaction종료까지막는경계다. COMMIT후에도asset이영구히active이거나Storage객체가영구보존된다는보장은아니다. 경합테스트가사용한archive변경은자기fixture에서원복했다.

## assetAvailable·Auth·transaction·pool 경계

- assetAvailable은 **trusted server policy callback**이다. frozenmetadata에는owner범위조회결과의id/kind/objectKey/hash/size,별도인자로verifiedactor가전달된다. 이 callback이실Storage존재·ownerprefix·objecthash/size·권한을검증했다는뜻은아니다. strict true만수용하는것과실Storage검증은별도다. link는기존동작처럼파일존재callback을생략한다.
- actorFromVerifiedUserId는shapeconstructor이지Auth인증기가아니다. 실제getUser검증을마친서버caller가공급해야한다. B12는Auth resolver를연결하지않았다.
- `withActorTransaction`/connection/types/API/SQLite service/repo는B12 commit에서변경0. oneclient BEGIN→SET LOCALdream_api/actor→전체생성→COMMIT또는ROLLBACK 경계를그대로쓴다. locally-issued error만healthy rollback뒤보존하고SQL/Storageunknown오류는fixed503으로변환한다. service가caller processpool을소유·종료하지않는계약을유지했다.
- runtime app/lib 참조검색에서새service를호출하는API/adapter는없다. POST는기존SQLite createProject를계속호출한다. startup readiness·trustedconfig·Auth·Storage·processpool lifecycle을갖춘미래adapter 작업이남아있다. PGcreate가HTTP쓰기활성화또는기존POST교체라고표시하지않는다.

## 정확한 명령과 격리

새사본 `D:/starwork/b12-r-83affcf`. node_modules만읽기junction,PG는물리복사;공유checkout없음.

```powershell
# 공유 저장소 cwd
New-Item -ItemType Directory -Path D:/starwork/b12-r-83affcf
git archive --format=tar --output=D:/starwork/b12-r-83affcf/source.tar 83affcf832d52d721416ef4074f3429753124d38
tar -xf D:/starwork/b12-r-83affcf/source.tar -C D:/starwork/b12-r-83affcf
Copy-Item -LiteralPath D:/starwork/b9-r-0d85186/pgsql -Destination D:/starwork/b12-r-83affcf/pgsql -Recurse
New-Item -ItemType Junction -Path D:/starwork/b12-r-83affcf/node_modules -Target D:/starwork/dream-ai-studio/node_modules
# 이하 자기 사본 cwd
node tests/postgres/run-project-create-local.mjs --bin D:/starwork/b12-r-83affcf/pgsql/bin
node tests/postgres/run-project-create-local.mjs --bin D:/starwork/b12-r-83affcf/pgsql/bin b4
node node_modules/vitest/vitest.mjs run tests/projects.test.ts tests/postgres/project-create.test.ts tests/postgres/project-read-backend.test.ts tests/postgres/project-read-request.test.ts tests/project-get-routes.test.ts
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm.cmd run lint
# 자기B12cluster만재시작
$ev='D:/starwork/b12-r-83affcf/tmp/b12-postgres-e112c4be-608f-4369-bdc3-a58c934e52a6'
./pgsql/bin/pg_ctl.exe -D "$ev/cluster" -l "$ev/review-postgres.log" -o '-h 127.0.0.1 -p 53291' -w start
$env:B12_R_URL='postgresql://dream_test_admin:b3-synthetic-admin-only@127.0.0.1:53291/dream_test_b3' # 자기synthetic dummy
node node_modules/vitest/vitest.mjs run tests/postgres/b12-r-independent.test.ts
./pgsql/bin/pg_ctl.exe -D "$ev/cluster" -m fast -w stop
python review/integrity.py
```

원tsconfig의전체product/tests/생성route types를검사했고overlay/exclude/기대값완화없음. 타입/lint로그는사본root `review-focused.log/review-typegen.log/review-tsc.log/review-lint.log`에보존했다. 자체harness는그검사후추가했으므로그로그가자체harness의lint/타입검사까지포함한다고주장하지않는다.

## 무결성·소유종료·마지막점검

- archive SHA256 `d17afcdab312ff98656a854c40b57bf7a803f5043ef130f772c487860b9af73f`; 원archive944파일종료변경0. PG물리1592파일과shared원도구SHA256불일치0(공유.tools는읽기비교만).
- 원B12 runner SHA256 `f90161bb76f3db2bde2c7127b30c71c37099e470687d282fa1498d712295fa90`; postgres/initdb/pg_ctl/createdb 모두Valid EnterpriseDB서명,PostgreSQL18.7.
- SQL3raw: 0001 `c45234e34c24132eed91369d90b8cb9cf0d1aaa58ec024c065a2fa91630ba9d3`;0002 `4d06083263a64c855bf427bb77ea9ef8ac8b40106224dbc1058209b013b540a1`;0003 `f55e09c1e403c1c57dd7130c7512b96b7b3eceee5e6beb13f771c05d6dc01dfd` 모두archive/종료shared읽기불변. LFcanonical도고정blob/manifest와일치;rawCRLF/gitLF차이는review-integrity.json에명시.
- B12evidence: `tmp/b12-postgres-e112c4be-608f-4369-bdc3-a58c934e52a6`,원PID68764/53291,추가PID78924/53291. 원/추가stop로그server stopped.
- 별도B4evidence: `tmp/b12-postgres-69a91dc3-e0e8-4525-924d-eb0b9d003cc0`,PID79676/53290,stop로그server stopped. 두원runner listener.log는자기PIDloopback소유를확인했다.
- 최종 `review/termination.json`: **2026-11-17 20:44:22 KST**,3PID모두불재,두postmaster.pid없음,53290/53291 Listen0.
- 마지막운영1.1점검시각 **2026-11-17 20:44:22 KST**,계기=검증/종료완료. 실제확인범위=소유실행·무결성·PID/port,sharedgit상태/staged없음/최근handoff파일명·시각대조. 기존T122/T137미추적과T217등다른작업보고서는수정·자동stage하지않았다. 타worker전체상태/mailbox는이번확인범위가아니다. 턴밖자동점검미설정,polling없음.

실managed/DSN/Auth/설정/권한/production DDL·GRANT·write/3013/shared.next/발행SQL/원fixtures/package/다른WIP/배포변경없음. 합성DDL/GRANT는원runner가만든자기clusterfixture와자기실패trigger뿐이다. 전체suite/build/실Storage/실네트워크장애/요청API흐름/managed쓰기·TLS는미검증. 자기자료는삭제하지않고보존했다.

Master반환: **B12-R PASS**,고정83affcf원20·별도B4실51·focused68·추가14모두PASS(중복합산없음),원tsc/lint0,소유3PID/2port종료. 미연결servercreate범위수용이며trusted snapshot/Auth/Storage/readiness/pool lifecycle adapter및실managed검증은별도작업으로남는다.
