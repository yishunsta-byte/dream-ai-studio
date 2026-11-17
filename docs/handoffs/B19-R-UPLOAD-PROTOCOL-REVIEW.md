# B19-R Upload protocol 독립 검수 — FAIL

- 검수자 Codex / CX-REVIEW-01, 상위 CX-MASTER-01; task `task_54acecdc035d`, dispatch `ctx_c930a3abf768`.
- 고정 SHA **91c6dfc563f7ffb30105528f62ded3ac39a82394**. 공유 시작 HEAD 관찰 `752f7d53922b82dfc0d7842750b75c69dae03a8a`; 실행은 새 fixed archive에서만 했다.
- 판정 **FAIL**: 원32/원bounded trace는재현되지만primitive shape가맞는**내부적으로모순된snapshot**을수용하는필수문제가남았다. upload state/receipt관계6개,creation fingerprint관계1개,getter정제1개의독립assertion이실패했다. 제품/원tests는수정하지않았다.

## 실행 결과·정확한 수량

| 집합 | 이번 독립 결과 | 해석 |
|---|---|---|
| 원tests원본 |32 PASS,skip0/exit0,22:20:25 KST|원본수정없이실행|
| 원64×24 loop |1,536 attempted serialized transitions 재현|원32중1test의내부단계이며1,536개독립test가아님|
| 독립harness최종 |27건중19 PASS /8 FAIL,skip0/exit1,22:25:45 KST|필수기대를성공으로바꾸거나skip하지않음|
| 동일loop의별도count audit |accepted660/rejected876=1,536|원seed/action/time을복제해계수만확인;추가coverage로합산금지|
| 원tsconfig typegen/tsc·targetedlint |각exit0,lint경고0|자기clean archive,독립harness추가전|

bounded loop는6종action/고정seed64/단계24의**직렬**proposal만다룬다. 원loop의now는2~25이고reverify/creation/capability조작snapshot이그action집합에없다. 모든interleaving/분산CAS/실DB동시성/입력무결성의포괄증명으로표시하지않는다. 반복실행/이전B14~B16/작성자수치를합산하지않았다.

독립harness초기helper복사때미완성함수선언이남아0test transform오류가있었고 `review-harness-parse-error.log`를보존했다. 그선언만제거한후21건(13PASS/8FAIL),이후모든reverify실패code/cancel6건을추가하여최종27건을실행했다. 제품·기대값은변경하지않았다.

## 필수 B19-R-F1 — checkedModel의 상태 간 일관성 누락 (P1)

위치 `lib/storage/uploads/state.ts:7~47`,특히23/33~45행과`admission:235~241`. shape/일부receipt관계는검사하지만status·revocation·issuer·시간·publication존재의필수상호관계가빠져있다.

대표재현은**정상transition만으로**R1등록→generation2 claim→MEDIA_INVALID 실패를만든뒤,복사한snapshot의 `revoked` **한boolean만false**로바꾸는것이다:

```text
R1 registered, notAfter=20
complete reverify at2 / leaseUntil80 / authorizationUntil90
rejectVerification MEDIA_INVALID at3 -> registered, R1 retained, revoked=true
bad = structuredClone(result); bad.revoked=false
admission(bad, owner, now4, matchingRevision) -> ACCEPTS R1
```

최신재검증실패와더새로운성공receipt가없다는기록이그대로인데예전R1을ready로반환한다. 이는caller가권한목록·전체과거를일관되게위조한경우가아니라**snapshot 자체에남아있는서로충돌하는두사실**이다. 수용B16/FIX의실패시unavailable/revoked·current-generation불변식과맞지않는다.

같은독립그룹에서다음6개거부기대가모두실패했다:

| primitive-valid 조작 | 실제 수용 결과 |
|---|---|
| 최신failed reverify 뒤revoked=false만변경|admission이old R1수용|
| R1.body.verifierId만stranger로바꾸고공개makeReceipt로content digest재계산;operation.workerId는원worker유지|checkedModel/admission수용;issuer와기록된claimant불일치|
| receipt.verifiedAt=19인데operation.authorizationUntil10/leaseUntil9로변경|now19 admission수용;발행시각이권한/lease종료뒤임|
| publication_reserved인데publication=null|checkedModel수용;필수durable예약관계누락|
| leased pending operation의leaseUntil999>authorizationUntil90|checkedModel수용;claim API자체가금지하는상태|
| registered/ready snapshot의closed=true|checkedModel/admission수용;현재transition경로로는만들수없는lifecycle조합|

다른긍정대조인pending operation+receiptId모순은INPUT으로거부됐으므로“검사가전혀없다”는판정이아니다. 누락된관계의문제다.

**요구 수정:** checkedModel에명시적인lifecycle/operation/receipt/current-state 관계행렬을추가한다. latest successful receipt 뒤의failed reverify와revocation/current revision,receiptissuer와그commit시기록된worker,발행시각과당시authority/lease,현재lifecycle의필수publication등을재검사해야한다. 현재allowlist에서과거worker를제거하는정상정책을과거attestation위조와혼동하지말고,commit시issuer/claimant binding을기록·검증한다. closed의의미도현재transition/admission과일관되게강제한다. 필요한이력필드가없으면추가해야하며형식검사나admission의boolean만신뢰하는것으로닫지않는다.

## 필수 B19-R-F2 — creation 원snapshot과 fingerprint의 내부 binding 미검증 (P1)

위치 `lib/storage/uploads/operation.ts:17~25,27~33,58~67`. ledger는중복requestID와snapshot-null/retired관계만추가검사한다. 저장된snapshot과fingerprint가실제로같은원요청을나타내는지검사하지않는다.

독립재현:

```text
beginCreation(payload, original snapshot policyEpoch1) -> pending entry/fingerprint F
bad = structuredClone(ledger)
bad.entries[0].snapshot.policyEpoch = 2  # F/clientDigest/나머지는그대로
settleCreation(bad, same requestId/F, succeeded(projectId), trusted registrar, now2)
-> ACCEPTS success under inconsistent snapshot/F
```

same-key/different-client-payload는기존코드가거부하지만이것은**stored original snapshot의부분손상**이다. 수용설계138행의원snapshot/fingerprint 계약이현재runtimeledger검사로유지되지않는다. 현재표현은client원문을보관하지않고fullclient+snapshot을한번에hash하므로ledger검증시그fingerprint를재구성할정보도부족하다.

**요구 수정:** 원normalized client/canonicalrequest를충분히보관해binding을검사하거나,검증가능한clientDigest+snapshotDigest구성으로명시버전의request fingerprint를정의하는등재검증가능한표현을제공한다. 오늘의menu/policy로재fingerprint하는해결은금지한다. pending/terminal/retired각상태의필수binding·retained-ID행렬과변조case를검사하되retired tombstone의최소정보보존은별도로모델링한다. unkeyed digest를인증수단으로바꾸라는요구가아니다.

## 필수 B19-R-F3 — unknown snapshot의 getter가 실행되고 foreign Error가 그대로 탈출 (P2)

위치 `lib/storage/uploads/schema.ts:15~18`의공통parse및`checkedModel:8`. canonicalJson은ownaccessor를조회전에거부하지만checkedModel은rawinput을곧바로Zod.safeParse에넘긴다.

```text
bad = {...freshModel, get ownerId() { throw Error('private-getter-detail') }}
checkedModel(bad) -> raw Error('private-getter-detail')
```

독립case는ProtocolError(INPUT)와getter읽기0을기대했지만foreign Error가반환돼실패했다. HTTP JSON에getter가있다는주장은아니며,public unknown입력API의strict/bounded validation·sanitized error 경계가일관되지않다는판정이다.

**요구 수정:** getter를실행하기전plainbounded data/descriptor를검사하고,공통parse의예외경계에서입력기인foreign Error를고정INPUT으로정제한다. JS Proxy/권한있는server코드전체를sandbox할수있다는보장과구분한다. 정상JSON/string/숫자정규화및detachedcopy기대를유지할것.

## 통과한 경계·수용 설계와의 대조

4module(schema92/receipt47/state248/operation84행)과원tests274행/인계69행을읽었다. 수용B16/FIX전문은이전검수내용을다시대조했고9302419→91c6dfc의두문서diff0,수용R2 78행전문과81a0380→91c6dfc diff0을확인했다.

- 생산module은Zod/node:crypto/동일protocol sibling만import한다. explicitclock/principal/revision과상태proposal이며현재시간/env/SDK/fs/PG/worker/native/timer/runtime wiring이없다. 자체test의fs는계수JSON을자기검수자료에쓰기위한것뿐이다.
- canonicalJson의정렬키/배열순서/domain-separatedSHA,NaN/undefined/Date/cycle/symbol/accessor/sparse등거부는원tests에서통과했다. 독립case에서JSON의-0→0,숫자와숫자문자열구별,Unicode NFC/decomposed문자열의정확구별을확인했다. counters의unsafeinteger는거부됐다. Unicode를임의동일화하는정책은없다.
- 정상trace의object1:receiptN/R2append/oldR1terminal조회시currentR2불복원、operation다른fingerprint conflict、expiredterminal replay와미완료liveauthority검사는원32/독립control에서통과했다.
- **모든5개verification failure code**의initial실패는receipt0/currentnull/새finalize거부였다. 모든5개reverify실패는oldR1보존/새receipt0/operationResult receipt=null/admission거부였다. verificationcancel과creationfailed/canceledterminal도명시대조했다. F1은그결과snapshot의모순을현재checker가놓치는문제다.
- genuine transition 경로의GCclaim/tombstone뒤ready不可,unknown/rolled-back durableknowledge의IOinstruction거부,one404와quiescence구분,latepublish후cleanuppending、capabilityunknownhorizon의remint/GC차단은통과했다. futureexecutor의confirmed flag/authority/quiescence가진짜인지이모델이인증한것은아니다.
- 현재strictschemas/CAS는**서로다른caller의상태proposal을제안**할뿐실DB의원자commit/locking/policy공통row/역사보존을구현하지않는다. 외부에서일관된entiresnapshot/authority목록/confirmedevidence를조작하는권한자에대한sandbox나암호서명은수용범위밖이다. F1/F2는그면책과달리내부자기모순을허용하는경계다.

## 명령·격리·증거

```powershell
# 공유저장소cwd에서자기디렉터리생성후
git archive --format=tar --output=D:/starwork/b19-r-91c6dfc/source.tar 91c6dfc563f7ffb30105528f62ded3ac39a82394
tar -xf D:/starwork/b19-r-91c6dfc/source.tar -C D:/starwork/b19-r-91c6dfc
New-Item -ItemType Junction -Path D:/starwork/b19-r-91c6dfc/node_modules -Target D:/starwork/dream-ai-studio/node_modules
# 이하자기사본cwd
node node_modules/vitest/vitest.mjs run tests/storage-upload-protocol.test.ts
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/storage/uploads tests/storage-upload-protocol.test.ts --max-warnings 0
node node_modules/vitest/vitest.mjs run tests/b19-r-independent.test.ts
python review/integrity.py
```

`review-original.log`, `review-independent.log`, `review-bounded-counts.json`,원검사로그 `review-typegen.log/review-tsc.log/review-lint.log`를사본root에보존했다. 자체harness는 `tests/b19-r-independent.test.ts`이며원testhelper를독립사본에복제했을뿐원fixture/source를변경하지않았다. type/lint는새harness추가전고정source검사라harness까지정적검사했다고주장하지않는다. roottsconfig완화/exclude/overlay없음,자기사본.next만생성했다.

archiveSHA256 `da8f34e050194480b24b7c54e328211a23cd57a8c38b2825a348ae7b40d6834c`;원987파일archive대비변경0 (`review-integrity.json`). 공유fixedprotocol/source/tests도최종diff0이다. .env/실secret/PG/Storage/provider/SQL/서비스/worker/계정/유료/3013/shared.next/타WIP/배포는미실행·무변경이다. 단기Node/Vitest명령은모두종료했고상주process/port/native/scratch를기동하지않았다. 검수사본/로그는보존했다.

## 반환·마지막 확인

최소다음작업은Backend의**protocol내부validation/binding/parse경계수정**이다. 원32와동일boundedtrace를유지하고이번8개거부기대가정상거부되도록재검수해야한다. 입력을primitive형식만검사하는것으로기대를낮추거나테스트를제외해서닫지않는다. SQL4/Storage/worker/API를여는단계는아직아니다.

마지막확인 **2026-11-17 22:30:12 KST**:원source/tests/design대조,최종독립FAIL/원PASS/정적검사·무결성,sharedgit 자기보고서만stage/최근handoff/타WIP파일명확인. `lib/db/postgres/drafts/`,T122/T137 및 tests/postgres/run-storage-verification-local.mjs는다른작업으로수정·stage하지않았다. 타worker전체진행/mailbox는범위밖이며턴밖자동점검미설정,polling없음.

Master반환: **B19-R FAIL**. 원32/1,536bounded시도는통과했으나독립27중8필수거부기대가실패했다(F1 6/F2 1/F3 1). trusted executor사실주입/실DB동시성/실byte검증·provider권한/운영readiness는여전히미수용이고제품수정없이보고서만선택commit한다.
