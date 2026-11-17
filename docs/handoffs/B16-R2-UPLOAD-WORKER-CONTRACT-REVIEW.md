# B16-R2 Upload/worker contract 재검수 — PASS (지정 설계)

- 검수자 Codex / CX-REVIEW-01, 원B16-R과 동일 담당. 상위 CX-MASTER-01; task `task_ece5ad97cedb`, dispatch `ctx_04436a8fe690`.
- 고정 SHA **9302419a20f6b96c8311668a30ea964b665c1697**. 시작 HEAD도동일했다.
- 실제 읽은 범위: 이고정blob의 `B16-STORAGE-UPLOAD-WORKER-CONTRACT.md` **204행 전체**, `B16-FIX-UPLOAD-WORKER-CONTRACT.md` **37행 전체**,원FAIL의F1/F2와수정diff. 최초도구출력은길이제한이있어B16을1~85/86~155/156~204행으로나눠전문확인했다.
- 판정: **F1/F2 및이번지정상태계약 설계 PASS**,필수잔존발견0. 원FAIL `90c46f7bcb07f4c743c60d1e90b684db10975259`는수정하지않았으며해당보고서diff0. 이번판정은원FAIL의역사를덮어쓰지않는다.

## F1: object1 : receiptN와 독립 재검증 권한

원문87~106/151~154행으로이전receipt final-key unique가제거됐다. globally unique·영구비재사용key는storage_objects의등록identity에속하고,같은object/asset에N개의append-onlyreceipt를허용한다. 성공receipt의멱등unique는operation/generation이며attempt/fence를별도로기록한다.

reverify는기존object K/H에대한새operation이며자체authorization expiry/lease/fence/retry budget/currentpolicy를가진다(93행). 원uploadintent만료를연장하거나유효해야할필요가없다. 새uploadtoken/copy/overwrite/asset재등록을하지않는다. 잘못된bytes는unavailable/revoked이지같은key교체의근거가아니다. activegeneration1개/현재state revision CAS/옛receipt보존(95행)이정의돼이전dead-end를해소했다.

| 수작업으로대조한 논리trace | 수정계약의결과 / 근거행 |
|---|---|
| R1만료→동일K/H의R2 | admission은차단하지만A/K/H/history는보존. 독립generation2가검증하여R2append와current=R2를원자전이한다. 93~103 |
| 같은R2 finalize재시도 | owner/fingerprint/terminal을먼저확인해같은R2반환. oldintent/lease/policy만료검사로확정성공을뒤집지않는다. 103/106 |
| generation1이이미성공한과거요청 | 역사결과R1만조회하며current를R2에서R1로되돌리지않는다. 95/104 |
| 미완료generation1의stale fence | finalize거부. supersedinggeneration이기존미완료authority를무효화한다. 새tuple/변조fingerprint는conflict. 91/95/104 |
| reverifyauthority만료 | lease부활대신새로승인된generation이필요하다. assetkey/등록을새로만들지않는다. 93 |
| policy epoch선행변경 | 같은policy행exclusive와create/finalize SHARE가직렬화한다. 옛epoch는거부,비동기statebulk수정에의존하지않는다. 136 |
| create가policy변경보다먼저commit | 이미만든reference는역사로보존하고이후새admission만차단한다. historicalterminal조회는read-only다. 106/136 |

이는실행한모델테스트가아니라문서의전이/guard를대조한논리trace다. 현재코드에receipt/operation이구현됐다는의미는없다.

## F2: external IO 전 durable barrier와 GC/finalize 선형화

54/110행에서정확publicationtuple/attempt/fence/outbox예약을externalwrite전에commit하도록수정했다. 예약COMMIT응답불명확시확인전publish하지않는다. asset/current-state행이없어도storage_objects barrier는이미존재한다(89/112행).

공통순서는 **policy→정렬된object→정렬된operation→asset/current-state→outbox**이며cancel/reclaim/GC도같다. initial finalize와GC는같은O의exclusive lock/CAS를공유한다. cleanup_claimed는되돌릴수없고fence무효화/정확delete ticket을commit한뒤에만삭제한다. registered original은receipt만료·revocation·link0과무관하게orphanGC에서영구제외된다.

| 수작업으로대조한 논리trace | 수정계약의결과 / 근거행 |
|---|---|
| reservationCOMMIT응답손실 | 같은identity로primary조회해확정전외부write없음. 110 |
| publish후processcrash/finalize전 | 미리commit한정확ticket이남아reconcile가능. live retry 또는fencedGC로진행한다. 120 |
| GCfirst | O락안에서cleanup_claimed/newfence/ticketcommit후delete. latefinalize는O/fence조건으로거부되어삭제된K에ready를발행하지못한다. 114/121 |
| finalizefirst | 등록/asset/receipt/current/result를같이commit하여O=registered. 이후orphan삭제ticketclaim은거부된다. 114/122 |
| concurrentfinalizer/두GCclaim | 동일O의exclusive CAS로승자하나. 반복cleanupclaim은같은ticket이며새target을만들지않는다. 123 |
| finalizeCOMMIT성공/응답손실 | terminal/registered를조회해같은결과를복구하고GC제외. 불명확primary상태면wait/reconcile하며추측삭제하지않는다. 124 |
| GCclaimCOMMIT응답손실 | ticket/tombstone확정전externaldelete없음. rollback된claim에는삭제권한없음. 125 |
| delete성공/응답손실 | 같은비재사용K와ticket으로만reconcile/retry. 다른identity/content는incident로거부. 116/126 |
| delete뒤staleIO가K를재생성 | 물리IO차단을가정하지않는다. K는영구tombstone이라finalize/ready/reuse불가;lateorphancleanup은계속pending. one404로완료처리하지않는다. 127/130 |
| writerquiescence불명 | 모든publicationauthority/inflightbound또는stop증거가없으면cleanup완료주장금지. 무제한privilegedwriter는blocker다. 127 |
| registeredO reverify와GC경합 | receipt가expired여도orphanGC가registered O를거부한다. reverify는등록lifecycle이아닌evidence/currentstate만갱신한다. 95/128 |

따라서이전의“행없는orphan검사→finalizecommit→늦은delete”순서를공통barrier/tombstone이차단한다. **DB의no-ready-after-supported-orphan-GC safety와물리cleanup의eventual완료는구분**돼있다. 외부권한을물리적으로중단시켰거나cleanup이반드시유한시간안에끝난다는주장으로확대하지않는다.

## terminal 우선순위·capability·creation fingerprint 대조

- **terminal조회≠새authority발급:**51/55/103~106행은인증/owner/fingerprint검증을먼저하고,이미확정된결과의조회에한해서livelease/원intent/currentpolicy검사를뒤에둔다. 다른payload는conflict다. terminal읽기는receipt추가/currentpointer변경/lease부활/upload권한발급을하지않는다. 현재availability는별도반환한다. 미완료전이에는전체liveauthority가필요하다.
- **capability예약:**134행은signer호출전ordinal/window/최대가능providerexpiry-resourcehorizon/재시도accounting을durable예약한다. 불명응답도allowance와최대수명을소모한다. 정해진envelope/count밖재발행은불가하며clienttimeout을providerdeadline으로가정하지않는다. 시간상한자체가불명확하면cleanup/reissue를차단하므로2h/24h만더해무조건cleanup완료로단정하지않는다. 숫자TTL은B18비용조사와실provider시험후별도config gate다.
- **creation별도멱등:**138행은(owner,creation_request_id)unique와원서버snapshot/정규화input/orderedreferences의canonicalfingerprint를둔다. retry를오늘policy/menu로다시해석하지않고저장된원snapshot에대조한다. 같은ID+다른payload는conflict,프로젝트+7stage+link+audit+terminalresult는원자commit이다. 응답손실은ownerstatus로복구하며같은project를반환한다.
- **비재사용ID:**140행은TTL이실행authority/verbosepayload를만료·축약해도최소dedupidentity/result 또는영구retired-ID를남긴다. purge후에도옛ID가새create가되지않는다. 다이제스트비교/원snapshot에필요한최소canonical규칙과민감payload보존은향후pureprotocol/개인정보retention구현에서구분해야한다.

구현해석상56행의overview를락집합의단독정의로사용하면안된다. 생성/finalize/policy변경은normative112/136행의policy/object/state순서를따라야한다. 마찬가지로F2의publication_reserved조건은**초기미등록finalize**,F1의reverify는**registered object에append**하는별도type전이다(93/110/128행). 이는새미정정책이아니라이문서의normative구분이며pureprotocol의태그/guard로명시해야한다.

## 유지된 신뢰·미구현 범위

- same-artifact final전송/hash/final재검증,ETag·boolean·mutable staging remote-copy의대체불가,workerprivilegedmutation한계는유지됐다. B14는지금도검증파일을정리하는API이므로futureartifactscope로교체해야한다.
- privateRoot의OS신뢰와junction한계,service_role의StorageRLS우회,ordinaryfinalmutation권한통제가없는경우readiness차단,DBonlyadmission이privilegedmutation에per-usebytehash동등하지않다는구분은그대로다.
- NOLOGIN registrar/security-definer/fixedsearch_path/PUBLIC EXECUTE차단·별도FORCE-RLS policy,기존runtime role부모grant금지,발행SQL3/hash/history보존과versioned3→4/counts/rolegraph검증gate가남아있다. 문서상실행가능한방향이지실DDL/ACL증명은아니다.
- B17의plan관측/B18의비용checkpoint는**문서에전달된사실**로만읽었다. 실제account/plan/capacity/청구총액을이번검수에서확인하지않았고추가조회/유료승인질문을하지않았다. B18별도범위와purchase미승인을유지한다.

## 최소 다음 bounded 구현 추천

별도배정으로 `lib/storage/uploads/{schema,state,receipt,operation}.ts`와 `tests/storage-upload-protocol.test.ts`만허용하는**pure in-memory protocol**을추천한다. initial/reverify의구별,불변object/receipt cardinality,현재revision CAS,operation terminal/fingerprint,publication/cleanuptombstone,capability최대horizon,policyepoch,retired-ID를명시타입과결정적전이로만든다. clock/IDs/관측결과는입력으로주고순수상태전이에서판정하며암묵적환경/현재시간/IO에의존하지않게한다.

필수trace는위R1→R2/duplicate/stale와F2모든order,원snapshotretry/변조fingerprint/nonreuse,unknownhorizon·latewriterpending/one404미완료까지다. 이시뮬레이션은실DB락/CAS/분산원자성/Storagetoken·RLS/native2GiB를증명하지않는다. SQL/PGdriver/SDK/network/fs/native/worker/API/UI/TUS/package/runtimewiring은첫배정에서제외한다. 이후SQL4격리검증과실provider샌드박스는별도승인범위/고정SHA로배정해야한다.

## 방법·마지막 확인·반환

사용한read-only명령: `git show 9302419:<각문서경로>`를전문및행번호로읽기,`git show --stat 9302419`, `git diff 90c46f7 -- docs/handoffs/B16-R-UPLOAD-WORKER-CONTRACT-REVIEW.md`, `git diff 9302419 -- <두문서/backend/Storage/worker/SQL/package경로>`,gitstatus/최근handoff파일명·시각확인. fixed검토경로diff0,수정commit은문서2개뿐임을확인했다.

테스트/모델체커/제품lint/typegen/SQL/provider/worker/API/native실행은**0**이다. 이번표는수작업논리검토이며실행PASS수량으로제시하지않는다. 신규소유PID/port/scratch없음. 실env/Auth/managed/Bucket/RLS/유료/설정/3013/shared.next/제품SQL/타WIP/배포변경없음. 고유보고서만선택commit한다.

마지막확인 **2026-11-17 21:55:49 KST**,계기=전문재검토/원FAIL보존대조완료;범위=위두문서241행과F1/F2trace/선택sourcefrozen대조,sharedgit(시작staged0)/최근handoff파일명·시각. B18/T227/T122/T137등타작업은수정·자동stage하지않았다. 타worker전체진행/mailbox는검수범위가아니며턴밖자동점검/스케줄러미설정,polling없음.

Master반환: **B16-R2 지정설계 PASS**. 원F1/F2는이번normative상태/권한/순서수정으로닫을수있으며원FAIL은보존된다. 설계수용은pureprotocol의최소구현배정을가능하게하는판정이고실receipt/schema/worker/API/Storage/운영readiness는전부미수용이다.
