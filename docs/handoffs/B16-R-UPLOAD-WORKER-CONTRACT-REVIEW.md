# B16-R Upload/worker contract 독립 검수 — FAIL (설계 필수 보완)

- 검수자 Codex / CX-REVIEW-01, 상위 CX-MASTER-01; task `task_e1c0938820c5`, dispatch `ctx_3fdcf48781c4`.
- 고정 SHA **79787f9385742d1f801a3e48e4fb60e487b308dc**. 공유 시작 HEAD 관찰 `7fa9eefdf2189eeb1f0cf8ff118b8f22e7e6cd66`.
- 원문 `docs/handoffs/B16-STORAGE-UPLOAD-WORKER-CONTRACT.md` **1~145행 전체**를 읽었다. 아래 원문 행번호는 이 고정blob 기준이다. working copy의 해당문서는고정본과diff0이다.
- 판정: 아키텍처 방향/현재제품한계/공식문서 대조는 대체로 일치하지만, **receipt 재검증 cardinality 충돌과 orphan GC/finalize 직렬화·선행 publication 기록의 필수 계약이 남아 설계 완료 수용 FAIL**이다. 구현 결함을 실행 재현했다는 주장은 아니다. 제품/SQL/설정/원설계는 수정하지 않았다.

## 필수 B16-R-F1 — 재검증/만료 갱신과 receipt의 final-identity uniqueness 충돌 (P1 설계)

원문 위치: **53~55,61~65,80,94~97행**. 65행은receipt 만료후새admission을차단하고revalidation을queue한다. 61/80/96행은receipt불변과이력보존을요구한다. 그런데96행은receipt표자체에 `exact final identity uniqueness`를둔다. 97행은asset별current receipt를가리키는state를제안한다.

문구대로final identity(bucket/key/provider version 또는지원없으면key)를receipt행의전역unique로해석하면다음순서가막힌다:

1. asset A,canonical final K,bytes SHA H를검증하여R1(not_after=T,policy=P1)을발행한다.
2. T가경과하거나policy epoch가변경되어같은original의재검증이필요하다.
3. K의동일bytes를재검증하고R2(new validity/policy/verification generation)를발행하려한다.
4. R1을수정하면append-only위반,R1을삭제하면역사보존위반,R1을그대로재사용하면만료/구정책검사가실패한다. R2를추가하면K의unique와충돌한다.
5. 다른final key로옮기는해결도현재asset filetuple 불변(`0002_invariants.sql:28~31`) 및동일owner/asset/H/확장자의canonical key와충돌한다. 새asset으로바꿔기존project reference를고치는것도요구된원본보존계약이아니다.

**요구 수정:** object identity의유일한등록소유권과receipt관측이력의cardinality를분리해서명시한다. 예를들어object/asset identity는1개로고정하고,같은identity에append-onlyverification generation/receipt N개를허용하며current state만새receipt로전이한다. receipt의재시도unique는owner/asset/verification-run 또는정확한fence/generation으로정의하고,이미성공한동일시도재전송과새policy/만료재검증을구분해야한다. `exact final identity uniqueness`가이미그뜻이었다면그제약이놓일표/열과1:N관계를분명히고쳐야한다.

추가로94행의original upload_intent expiry/lease와73행의expired intent finalize금지를그대로재검증에재사용할수없다. 기존asset을변경하지않는**reverification operation의generation/claim/fence/expiry권한**을정의해야한다. exact TTL숫자를지금추정하라는요구는아니며B17의capacity조회와별개인상태계약수정이다.

재검수 gate: R1만료→K/H동일재검증→R2원자발행→current R2,과거R1보존,중복R2 finalize동일결과,stale R1/fence거부,asset key/hash/project refs불변의논리행렬을통과할것.

## 필수 B16-R-F2 — orphan 삭제와 finalize 사이의 선형화 지점/선행 durable 기록이 미정 (P1 설계)

원문 위치: **51,53~54,77~81,94,98행**. 54행은finalize에서liveintent/fence를검사하고asset/receipt/ready/outbox를함께commit한다. 78~79행은unknown COMMIT 뒤reconcile 및unregistered promoted-orphan삭제를요구한다. 81행의ready-state SHARE/exclusive 규칙은**등록후**create/revoke에는맞지만아직asset/ready-state가없는promoted object에는잠글행이없다. GC와finalize가공통으로잠그거나CAS하는publication/intent barrier 및삭제claim이명시되지않았다.

현재문구만으로배제되지않는순서(실행한공격이아닌설계counterexample):

1. worker는K를publish/reverify했지만asset/receipt/ready는아직commit되지않았다.
2. GC가K를unregistered로보고등록/링크/state를확인한다. ready-state행은없다.
3. worker가유효lease/fence로54행조건을통과해asset+receipt+ready를commit한다.
4. GC의external delete가뒤늦게끝나K가삭제된다. 새ready가즉시깨진다.

삭제직전SELECT한번을추가하는것만으로는DB조회와외부삭제사이의같은race가남는다. GC를expired/canceled한operation에만허용할의도여도**같은authoritative 행의조건부전이/락으로먼저그상태를확정하고late finalize를봉쇄한다**는ordering이필요하다.

또한53행publish성공직후process crash,54행DB finalize 전실패라면54행에서만outbox를발행하는구현에는K의durable복구기록이남지않을수있다. 78행의persist/recover와98행의durablepublication의도는좋으나**어느시점에정확final identity를DB에기록하는지**가없다.

**요구 수정:** 외부publish전에owner/intent/asset/attempt/fence/final tuple을담는durable publication record/outbox intent를commit하고,finalizer/GC가공통행을잠그는순서와`cleanup_claimed`/tombstone같은조건부상태를정의한다(명칭은자율). GC승리시fence를무효화하고그generation의ready발행을막은뒤external delete;finalize승리시등록된original을GC대상에서제외한다. unknown COMMIT는그공통identity/status를reconcile하기전삭제금지. 삭제결과응답손실/재시도도같은exact tuple에서멱등으로처리해야한다.

재검수 gate: publish후crash,GC선행/finalize선행,두operation동시claim,finalize응답손실,GC삭제응답손실,stale fence의latepublish/latefinalize 각순서를문서의전이표로설명하고**GC로삭제된K에ready가commit될수없음**을보일것.

## 일치 확인·추론·미확인

| 항목 | 이번 판정/근거 |
|---|---|
| signed upload권한/2h | **일치.** [공식reference](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl)는추가인증없는2h capability를문서화한다. 설치storage-js2.119.0 `StorageFileApi.ts:372`는path/upsert만받고caller expiry인자가없다. mode/intent만료가이미발행한capability를취소하지않는다는분리가맞다. |
| no-overwrite/악의적header | **SDK일치,실provider미확인.** 설치코드243~244행은uploadToSignedUrl의upsert가signing옵션을대체하지못함을설명하며390~391행이서명요청x-upsert를설정한다. [TUS문서](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)는x-upsert의last-writer행동도설명한다. signing=false+hostileheader실provider부정검사를미래gate로남긴것이맞다;코드주석만으로provider불변성을증명하지않는다. |
| token/TUS수명 | **일치.** 같은[TUS문서](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)의upload-resource최대24h와signing2h는별개다. 개별signedURL revoke불가/전체signingkey교체는별도라는설명이맞다. resource를24h동안token검증없이쓸수있다고추론하지않는다. GC grace의실제상한/재발행accounting은provider시험전미확인이다. |
| cap/plan/방법 | **일치.** [file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)는Free50MB/Pro+global최대500GB와bucket≤global을설명하고,[method limits](https://supabase.com/kb/troubleshooting/upload-file-size-restrictions-Y4wQLT)는resumable/S3최대50GB를설명한다. 2,147,483,648bytes는범위안이지만actualplan/설정확인과별개다. 기존uploadLimit의기본값2×1024³ 및B14상한과대조했다;실env의override는읽지않았다. |
| TUS client/host | **일치.** [가이드](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)의6×1024²chunk/directStoragehost/x-signature와일치. package-lock에tus-js-client/Uppy없음을검색했다. endpoint는명시승인/provider값으로공급,개인Pro를projectplan으로가정하지않는다. |
| Vercel자원/분리 | **일치.** [function limits](https://vercel.com/docs/functions/limitations)는4.5MBrequestpayload, [runtimes](https://vercel.com/docs/functions/runtimes)는500MB/tmp를명시한다. 이계약에서2GiB spool/native검증을worker로빼고Vercel을DB-only로두는것이타당하다. Vercel이모든native실행을금지한다고해석하지않는다. |
| 동일artifact/final byte검증 | **일치.** 53/84행은검증artifact를보존해그bytes를보내고final을다시검증한다. B14현API는파일을삭제하고metadata만반환하므로그결과나bareboolean으로publish하는재사용은불가하다. ETag/다른최종key/등록뒤별도receipt발행을등가증명으로허용하지않는다. |
| lease/fence/cancel | **방향일치.** shortclaim→IO→conditionalfinalize,stale fence거부는맞다. 기존worker/main은SQLite/checkStartup/runNextJob이고runner는generation/mock/render분기,60slease/20sheartbeat다. 새cloud검증entry가필요하다는판단과일치;현재worker를실행하거나수정하지않았다. |
| receipt/RLS/privileged mutation | **신뢰경계가적절히명시됨.** [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)의servicekeyRLS우회와[ownership](https://supabase.com/docs/guides/storage/security/ownership)의owner식별/접근통제차이를구분한다. digest는worker실행의hardwareattestation이아니며DB-only admission이privilegedobjectmutation에per-usehash동등하다는주장도없다. |
| registrar최소권한 | **구현가능하다는설계추론,실증은아님.** 별도NOLOGIN registrar의fixed-search-path security-definer함수,제한EXECUTE/필요DML·helper권한,명시FORCE-RLS policy로구현할수있다. dream_worker/dream_api의부모membership으로편의를얻으면안된다. actualhostedcustomrole/Storage권한은미확인이다. |
| SQL3→4/rolegraph | **일치.** 현재manifest정확3개,runner18table/36policy/18guard와정확history만허용한다. SQL3끝까지byte보존하고versionedupgrade/각version의counts·roles/policies를따로검증해야한다. 새registrarpolicy를추가한상태를기존v1runner에그대로통과시키는것은불가하다. |
| creation멱등상태 | **필수전제인지맞게표시됨.** 17/131행의별도owner+creation-request/status요구가맞다. 현재B15의unknownCOMMIT503을실패로간주하면안된다. 다만현재는요구수준이고상태표/인자fingerprint/terminal재조회순서는구현전추가구체화가필요하다. 업로드idempotency로대체할수없다. |

## 필수수정 이외의 구현 전 gate

- finalize 재시도는이미commit된동일operation의정확tuple을먼저owner-scoped조회해동일결과로돌려주는경로와,새authority가필요한미완료작업을분리한다. `ready`이후lease종료/원intent만료만으로확정성공의재조회가실패하지않게해야한다. 이는새데이터발행권한을복구시키는예외가아니다.
- capability issue/reissue도DB와provider를원자화할수없다. 발행전durable issue예약/불확실응답의최대expiry보수계산/재발행한도를정의해미기록토큰뒤의GC를허용하지않는다. token을outbox에로그하지않는다.
- creation operation은owner+requestID unique,서버정규화request fingerprint(menu/config/policy/입력/reference identity),동일key다른payload conflict,프로젝트/단계/link/audit와terminalresult의원자commit,unknown상태의reconcile우선/비맹목적재시도를요구한다. retention/TTL정확값은운영조사후정하더라도동일request가만료뒤임의중복생성을허용하는지정책은명시해야한다.
- policy epoch 취소와receipt-state/creationlock의공통직렬화규칙도전이표에포함한다. owner권한있는trustedSQL/worker/provideradmin변조까지sandbox하는보장은아니다. 모든ordinaryfinalmutation경로를실제로제한할수없으면readiness차단을유지한다.

## 최소 다음 bounded 작업 추천

먼저 **문서만수정하는B16-fix**로F1의1:N모델/reverification operation과F2의durable publication/GC/finalize 전이·락순서·멱등우선순위를확정하고이논리trace를재검수한다. 그뒤독립배정으로네트워크/SQL없는pureprotocol(state/receipt/operation fingerprint)와전이표검사부터구현하는것을추천한다. 첫구현이fullworker/TUS/UI/운영DDL이어서는안된다.

다음SQL4설계/실행은별도허용경로/고정SHA/격리PG에서fresh4/known3→4/unknownstate/rollback/counts/FORCE-RLS/registrarrolegraph를검증하도록배정한다. publishedSQL3/hash/history를완화하거나dream_worker권한을재사용하는지름길은수용하지않는다. 설계수정과bounded구현배정은Master의기술판단범위이며사용자추가승인질문이아니다.

실제plan/capacity는**Backend B17 별도조회**범위다. 이번에actualaccount/plan/bucket/globalcap/workercapacity를추정하거나조회하지않았고구독/유료승인질문도하지않았다. [공개pricing](https://supabase.com/pricing)의Pro기본시작가와실제org청구액을구분한원문방향은맞지만B17결과나구매승인을대신하지않는다.

## 검토 방법·미실행·마지막 확인

정확한read-only명령은 `git show 79787f9:docs/handoffs/B16-STORAGE-UPLOAD-WORKER-CONTRACT.md`(전체및1기준행번호), `git diff 79787f9 -- docs/handoffs/B16-STORAGE-UPLOAD-WORKER-CONTRACT.md`,선택source의Get-Content/rg,설치SDK source/version과package-lock검색이었다. 전체제품test/lint/build/typecheck/SQL/worker/API는**실행0**이다. 문서검수이므로이전실행결과를새PASS수량으로재사용하지않았다. 위counterexample은순서논리이며provider/DB실행시험으로표시하지않는다.

신규app/native/worker/server를기동하지않아새소유PID/port/scratch없음. 실env/secret/managed/Bucket/RLS/계정/유료/설정/3013/shared.next/원SQL/다른WIP/배포변경없음. 허용고유보고서만선택commit한다.

마지막확인 **2026-11-17 21:46:29 KST**:원문145행완독·fixed문서diff0,선택backend/Storage/worker/SQL/package 경로도79787f9대비diff0,현재primary문서와source/SDK대조,sharedgit(시작staged없음/최종이보고서만stage)/최근handoff파일명·시각/운영1.1규칙확인. T226/T122/T137등타작업을수정·stage하지않았다. 타worker전체진행/mailbox는이번확인범위아니다. 턴밖자동점검/스케줄러미설정,polling없음.

Master반환: **B16-R FAIL**. 기본방향은타당하지만F1재검증receipt cardinality와F2orphan GC/finalize/publication ordering을먼저수정해야설계완료를수용할수있다. 설계만검토했으며실receipt/schema/worker/API/운영readiness는전부미수용이다.
