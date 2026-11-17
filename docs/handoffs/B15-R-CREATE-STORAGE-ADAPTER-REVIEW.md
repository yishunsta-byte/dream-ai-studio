# B15-R Create/Storage adapter 독립 검수 — PASS (미연결 서버 계약)

- 검수자 Codex / CX-REVIEW-01, 상위 CX-MASTER-01; task `task_2096553ecebe`, dispatch `ctx_0608570b6241`.
- 고정 SHA **1d561c128f71bfd570a9b733130a4830a42709b9**. 공유 시작 HEAD 관찰 `745882edb59c14a67463cd55d2f1b91edd196e1e`; 실행은 새 fixed archive에서만 했다.
- 지정 trusted pool/privateRoot/서버주입 경계의 **로컬 계약 PASS**, 필수 수정 발견0. 아래 COMMIT 불확실성과 trusted SQL 변조 한계를 포함하며 운영 생성 개통 승인이 아니다.

## 이번 독립 실행 결과

| 집합 | 결과 | 중복/실행 범위 |
|---|---|---|
| 원B15 runner |19 PASS,skip0,exit0,21:26:48 KST|새 합성PG + 설치SDK fakeHTTP|
| 원B12 runner selector |20 PASS,skip0,exit0,21:26:48 KST|별도 새cluster;9unit+11실PG|
| 원focused4파일 |97 PASS,skip0,exit0,21:25:44 KST|B14 fakeHTTP46/B12unit9/connection/backend|
| 자체추가 |18 PASS,skip0,exit0,21:31:07 KST|실PG+SDK fakeHTTP,query fault/race/불확실성 대조|
| 원tsconfig typegen/tsc,전체lint |각exit0,lint경고0|자체harness 추가전clean archive;exclude/overlay없음|

B12unit9는20과97에겹친다. 이전B14/B12/작성자결과·초기자체17통과반복은합산하지않았다. coverage총합으로표시하지않는다. 이번제품검증에서실패/skip/기대값완화없음.

## 실제 읽은 범위·실행 데이터 경계

B15 repo/adapter/원integration19/runner 전체,기존B12 create/원unit·integration,withActorTransaction/actor/connection,B14 reader/key/config/media/availability,원fixture와B4read DTO계약을읽었다. fixed commit의5경로diff와runtime참조를대조했다. B12 service/B14/transaction/pool/Auth/API/SQL은이commit에서변경0이다.

repo는실제`owner_id,id,kind,mime,file_path,sha256,size_bytes`를owner/ID/nonarchived predicate와RLS 및FOR SHARE로읽는다. mapper는row.owner_id가tx.actorId와같은실제문자열인지재검사하며row.mime의null/string을그대로전달한다. actor.id로owner를채우거나kind로MIME를추론하지않는다. id/owner는실SQL의선택조건과신뢰할수있는driver결과를전제로하며공개HTTP authority를받는API가아니다.

원19/자체4 faultcase에서wrong/missingowner와null/missingMIME를주입하면Storage network0으로거부됐다. null MIME/missingowner는발행SQL이비link물리행에허용하지않으므로이는**실제SELECT뒤driver-row fault injection**이다. 잘못된MIME문자열/키/foreign/missing은실제합성DB행/조회로검증했다. 이차이를유효한불량물리행생성으로표시하지않는다.

정상데이터는실행시row의owner/MIME/key/size/SHA가B14strict OwnedStorageAsset검증과실SDK stream size/hash/MIME/decode를모두통과해야한다. 실제byte size/hash/type 불일치/404/401은생성·종속행변화없이거부됐다. B12의필수productAssets를link로대체할수없고optional link skip은그대로유지된다. 원audit label/action/detail,UUIDv7/7stage,정규화/rawTEXT/hash와B4list/get호환은원19와별도20에서재현했다.

## request-local 취소와 scoped client 독립 대조

각create마다controller/timer/listener/scopedpool/callback을소유하고sharedfactory에는현재requestsignal이없다. explicit ioTimeoutMs1..10000을한번snapshot하며starts-before-acquire이다. 기본processpool과B12 transactionhelper를수정하지않는다.

별도 `tests/postgres/b15-r-independent.test.ts`의18건:

- 실제SELECT뒤owner/MIME driver결과손상4종:Storage network0,전체행수불변.
- 실제project INSERT의owner parameter를B로바꾸는부정proxy:실제RLS가거부하고ROLLBACK/COMMIT미전송,전체행수불변. 검증한Aasset에대한실HTTP는이미완료된상태였다.
- BEGIN/asset SELECT/project INSERT/audit INSERT 각각의실제응답직후abort4종:이후새statement와COMMIT은실client로전달되지않고ROLLBACK은허용됐다. 최종trace=ROLLBACK,전체행수불변.
- pool획득중abort:획득된client는release되고SQL0/Storage0. acquire자체promise를강제중단하는보장은아니다.
- confirmed COMMIT 직후abort:ID를정상반환하고B4get으로그durable행을확인,거짓rollback오류없음.
- COMMIT실제성공뒤응답손실fault:아래불확실성계약확인.
- SELECT응답gate를잡아SHARE락을유지하고실UPDATE가blocked된것을pg_blocking_pids로확인. abort만으로gate중인clientpromise/락이즉시끝나지않고gate해제뒤ROLLBACK/update완료,Storage0을확인.
- 실제objectIO를시작한뒤120msbudget만료:Storage취소/생성rollback/SHARE NOWAIT가능/scratch0,같은service의후속요청성공.
- 실제lateaudit trigger오류:full object검증후project/stage/link/audit전체rollback,fixed503만반환.
- trustedpool의same-ownerlink parameter변조:아래SQL신뢰경계실증.
- 실제PG INSERT trigger의pg_sleep(0.5) 실행중requestabort:pg_stat_activity PgSleep가abort뒤에도계속되고request는아직미완료,해당statement가끝난뒤다음SQL차단/rollback으로행수불변.
- 같은factory로A/B를동시실행:둘다실objectIO에들어간뒤A만abort,Bstream을완료해B의create/read성공. controller교차취소없음.

최초자체17통과뒤마지막동시격리1건을추가해18전체를재실행했다. 초기17은새수량에더하지않는다.

## COMMIT 불확실성·동일 metadata 보장의 정확한 범위

**확정 COMMIT은성공ID를보존한다. 반대로COMMIT응답이불명확하면503이라도행이존재할수있다.** 독립proxy는실COMMIT을서버에완료시킨뒤private오류를던졌다. service는고정PROJECT_CREATE_UNAVAILABLE503으로정제하고client release(true)했지만,실DB에는project+1/stage+7/link+1/audit+1이남았다. 이후ROLLBACK은확정commit을되돌릴수없다. 이것은기존transactionhelper의uncertainty정책이며이번adapter가idempotency/중복create방지/실패=무조건미등록을제공한다고주장하면안된다. API는아직미연결이고B16설계의별도계약이다.

**동일metadata 보장은trusted SQL/driver와불변input·FOR SHARE 조회경계 안의정상흐름이다.** 외부동시DBmetadata변경은현재transaction동안락으로막으며원19의실UPDATE대기→abort해제도재현했다. 하지만공급된server pool자체가SQL값을바꾸는공격을sandbox하지않는다. 독립proxy가검증후`INSERT dream.project_assets`의assetID만다른**같은owner**행으로바꾸면RLS는이를허용했다:HTTP는원assetID를검증했지만최종link는대체ID였다. 이는기존create가검증된링크목록을통해전송한SQL을trustedpool이변조한시험이다. 다른owner변조는RLS가막지만same-owner변조까지검증증명과binding한다고확대하면안된다. HTTPinput만으로pool을주입/변조할경로는없으며서버composition/DB권한이신뢰경계다. 향후미신뢰middleware를이pool경계에넣는것은수용범위밖이다.

budget은IO/continuation취소신호이며이미실행중PGstatement·poolacquire·native/OScleanup의harddeadline이아니다. 실제PgSleep시험으로확인했듯abort후락해제는statementsettle와ROLLBACK까지기다릴수있다. 기존statement/acquire/idletransaction상한과B14native초단위timeout/awaitedfilesystemcleanup한계를유지한다. 매번deadline정확시각에모든락/native가없어진다는주장은금지한다.

## B14·서버 composition/운영 한계

B14 privateRoot는non-served·access-restricted operator신뢰영역이며그아래로컬junction교체권한이있을때쓰기까지봉쇄하는sandbox가아니다(원B14-R보고서한계유지). private bucket getBucket은point-in-time checkpoint이고service_role은StorageRLS를우회한다. owner/key검사성공이RLS검증성공은아니다.

검증후object변경/삭제나후속DBrollback을막는lease/immutableupload보장은없다. 실제upload·objectpolicy·Storage권한·DBasset등록·운영credential/config·파일시스템ACL·Vercel/native실행readiness·Auth/API개통은미수용이다. runtime검색에factory의API호출은없다. trustedserver snapshot/verifiedAuth/reader/config/processpool을미래adapter가공급해야하며B16설계와별개다.

## 정확한 재현 명령·무결성

새사본 `D:/starwork/b15-r-1d561c1`,공유checkout없음,node_modules만읽기junction,PG/native는물리복사.

```powershell
# 공유 저장소 cwd에서자기디렉터리생성후
git archive --format=tar --output=D:/starwork/b15-r-1d561c1/source.tar 1d561c128f71bfd570a9b733130a4830a42709b9
tar -xf D:/starwork/b15-r-1d561c1/source.tar -C D:/starwork/b15-r-1d561c1
Copy-Item -LiteralPath D:/starwork/b14-r-ba3ad44/.tools/ffmpeg -Destination D:/starwork/b15-r-1d561c1/.tools/ffmpeg -Recurse
Copy-Item -LiteralPath D:/starwork/b12-r-83affcf/pgsql -Destination D:/starwork/b15-r-1d561c1/pgsql -Recurse
New-Item -ItemType Junction -Path D:/starwork/b15-r-1d561c1/node_modules -Target D:/starwork/dream-ai-studio/node_modules
# 이하자기사본cwd
node tests/postgres/run-project-create-storage-local.mjs --bin D:/starwork/b15-r-1d561c1/pgsql/bin
node tests/postgres/run-project-create-storage-local.mjs --bin D:/starwork/b15-r-1d561c1/pgsql/bin b12
node node_modules/vitest/vitest.mjs run tests/storage-private-read.test.ts tests/postgres/project-create.test.ts tests/postgres/connection.test.ts tests/postgres/project-read-backend.test.ts
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm.cmd run lint
$ev='D:/starwork/b15-r-1d561c1/tmp/b15-postgres-8d7009e2-7c35-42fb-be8d-4c20a02e460e'
./pgsql/bin/pg_ctl.exe -D "$ev/cluster" -l "$ev/review-postgres.log" -o '-h 127.0.0.1 -p 64601' -w start
$env:B15_R_URL='postgresql://dream_test_admin:b3-synthetic-admin-only@127.0.0.1:64601/dream_test_b3' # 자기 synthetic dummy
node node_modules/vitest/vitest.mjs run tests/postgres/b15-r-independent.test.ts
./pgsql/bin/pg_ctl.exe -D "$ev/cluster" -m fast -w stop
python review/integrity.py
```

원tsconfig의product/tests/자기생성route type을검사했고별도exclude/overlay없음. 원lint/tsc는자체harness추가전이라새harness까지검사했다고확대하지않는다. 로그는root review-focused/typegen/tsc/lint.log 및각cluster의tests/independent/stop로그에보존했다. 초기에archive디렉터리에서gitdiff를호출해읽기도구가실패한것은공유repo cwd에서다시확인했다;제품테스트실패가아니다.

- archiveSHA256 `fb687e94311955ddb7e2a437df048ac248ea5b72d84fa0235214c9319ceeb6e3`; 원969파일종료변경0.
- 원runner SHA256 `a3f04cffaec2b38aa2a73e7b7a67e472a0ff67a44646ac1e5b35567b81f1b976`.
- ffmpeg/probe물리사본4파일SHA일치,PG주요4실행파일SHA일치및Valid EnterpriseDB서명,version18.7. SDK/storage-js2.119.0. 설치/인터넷package추가없음.
- SQL3 rawhash불변:0001 `c45234e34c24132eed91369d90b8cb9cf0d1aaa58ec024c065a2fa91630ba9d3`,0002 `4d06083263a64c855bf427bb77ea9ef8ac8b40106224dbc1058209b013b540a1`,0003 `f55e09c1e403c1c57dd7130c7512b96b7b3eceee5e6beb13f771c05d6dc01dfd`; archive/최종shared읽기일치.

## 소유 종료·마지막 점검

- 원B15 `tmp/b15-postgres-8d7009e2-7c35-42fb-be8d-4c20a02e460e`:PID68704/64601. 추가재시작PID24748/최종12892,원/추가stop로그server stopped.
- 별도B12 `tmp/b15-postgres-bc6dbdb9-e911-418b-8eaf-9bdfd4b44872`:PID73248/64599,stop로그server stopped. 원listener.log는각자기loopbackPID소유확인.
- 추가HTTP PID72136/58883,최종19576/58246. server.closeAllConnections/close후worker종료. 원19/97도각afterAll의HTTP/scratch정리완료후exit0.
- `review/termination-final.json`: **2026-11-17 21:31:51 KST**,4PG PID/2HTTP PID불재,2postmaster.pid없음,64601/64599/58883/58246 Listen0,Storage/native scratch0. nativeprocess0은21:30:13의review/termination.json에서도확인했다.
- 마지막운영1.1확인 **2026-11-17 21:33:48 KST**,계기=보고서최종검토;실제확인범위=21:31:51의소유실행·PG/HTTP·scratch종료증거와무결성,최종sharedgit/SQL제약재확인. 검수전staged없음,최종stage는이보고서만이며최근handoff파일명/시각을대조했다. 다른Front WIP/T221/T223/T122/T137자료는수정/자동stage하지않았다. 타worker전체진행/mailbox는이번확인범위아님. 턴밖자동점검미설정,polling없음.

실env/DSN/managed/Auth/운영Storage/SQL/package/3013/shared.next/다른WIP/배포변경없음. 모든DB행/trigger/DDL은새합성cluster에서만사용했고원fixture파일은변경하지않았다. 자기scratch는경계확인후정상정리,DB/증거는보존;삭제거절우회없음.

Master반환: **B15-R scoped PASS**,원19/별도B12 20/focused97/자체18전부PASS(중복합산없음),원tsc/typegen/lint0,소유PG/HTTP/scratch종료. confirmed COMMIT성공보존과불확실COMMIT503의durable행가능성,동일metadata보장의trustedpool범위를명시했다. 실제Storage/upload/RLS/DB등록/API/Vercel/native운영readiness/B16은미수용이다.
