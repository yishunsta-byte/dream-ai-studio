# B14-R Private Storage read 독립 검수 — PASS (명시적 서버 신뢰 범위)

- 검수자 Codex / CX-REVIEW-01, 상위 CX-MASTER-01; task `task_056b8e361bd5`, dispatch `ctx_045375862e3d`.
- 고정 SHA **ba3ad446a813a87354dd9bc746cb5d88c97577b7**. 공유 시작 HEAD 관찰 `ec91a55e60a93d3475aada82662635744274ce15`; 실행은 새 fixed archive에서만 했다.
- 판정: **지정 synthetic HTTP/서버 reader 계약 PASS**, 필수 수정 발견0. 아래 scratch root의 로컬 변경 권한을 배제하는 신뢰 조건과 OS I/O 한계를 포함한다. 실제 Storage/RLS/업로드/DB등록/운영 readiness를 수용하지 않는다.

## 이번 실행과 중복

| 실행 | 독립 결과 | 범위 |
|---|---|---|
| 원 fakeHTTP standalone |46 PASS,skip0,exit0,21:14:58 KST|설치SDK + 실제 loopback HTTP/Sharp/복사FFmpeg·ffprobe|
| 원 focused4파일 |97 PASS,skip0,exit0,21:11:33 KST|위46 포함; B12unit/connection/backend 회귀|
| 별도 부정대조 |15 PASS,skip0,exit0,21:15:39 KST|독립 fakeHTTP/credential sink/timeout/실junction·native protocol 대조|
| fixed 원tsconfig typegen/tsc,전체lint |각exit0,lint경고0|자체harness 추가 전 clean archive; exclude/overlay 없음|

46은97에 포함된다. 별도15의 초기14건 반복 및 작성자 수치를 합산하지 않는다. standalone 소유listener 추적용 첫 시도는 Windows의 `--import=D:/...` ESM URL 오류로 테스트 시작 전 실패했다. `file:///D:/...`로 검증도구 경로만 수정했고 최초로그 `review-trace-loader-error.log` 보존; source/기대값/skip 변경 없음.

## 실제 읽은 코드와 설치 SDK 근거

fixed의 config/object-key/reader/errors/media/availability 및 원tests 전체, 기존 local inspectMedia, B12 DTO 경계, actor shape constructor, 설치SDK의 package/version과 download/fetch 구현을 읽었다. 변경8경로를 확인했고 app/lib import 참조로 B12/API 미연결을 대조했다.

설치된 `@supabase/supabase-js`와 `@supabase/storage-js`는 모두 **2.119.0**이다. 설치소스 `StorageFileApi.download`는 request를lazy 함수로 전달하고 `noResolveJson:true`로Response를 보존한다. `BlobDownloadBuilder.asStream()`은별도StreamDownloadBuilder를생성하며그execute는`result.body`를반환한다. 기본Blob실행경로의`result.blob()`과구분된다. fetchWithAuth가apikey와Authorization을붙이고 reader가제공한boundedFetch로실제요청을보내는코드를대조했다.

원46의 Response.blob 금지spy/8MiB+chunked hash검사가실SDK경로에서통과했다. 독립검수도같은설치SDK를사용했다. npm/tool/package 다운로드·설치·업데이트는하지않았다.

## config·credential·URL·owner 입력 경계

- endpoint/ref/bucket/credential/limits/workRoot/ffprobePath는명시constructor입력이다. env조회/import-time접속/defaultproject/key/SQLitefallback없음. config 및credential을복제/freeze해await중변경과분리한다.
- managed는명시ref의canonicalHTTPS origin만,synthetic은명시HTTP127.0.0.1:port만허용한다. URLcredentials/path/query/hash/다른host/port를거부한다. 독립case는managed형식만offline검사했고실managed접속없다.
- service-role mode와printablekey는trustedserver선언이다. key가실제로service역할인지/JWT인지/IAM이맞는지인증하지않는다. 실제키종류별provider호환성은미검증이다. 테스트key는합성문자열뿐이다.
- actor는branded shape,actualowner/MIME/id/size/hash/key는strictmetadata로검증한다. actorconstructor는Auth인증기가아니다. 이authority/config/reader를HTTP또는browser입력에노출하면안된다.
- canonicalowner/assets/idv7/hash.extension와정확히같은key만허용한다. MIME-kind일치,lowercaseSHA/ID,양의safe size/cap을검사한다. crossowner/percent/traversal/URL/다른bucket/unknownfield는network·temp생성전거부한다.
- 실제SDK마다두개의정확한GET URL만허용하고redirect:error/cache:no-store/accept-encoding:identity를설정한다. transformed/signed/publicURL은사용하지않는다. 독립redirect sink는실제요청0이었다.

## byte·media·deadline·admission 검토

원46은잘못된Content-Length/oversize/short/chunked/hash변조/disconnect、metadata64KiB超、公有bucket/404/401/403、실MIME불일치/손상이미지/40M초과、실PNG/MP4/Blob미사용을실제로재현했다. 독립case는bucket-ID불일치/encoding/header/hash、metadata와object각stalledread timeout을추가했다.

각stream chunk를증분count/SHA256하면서파일로backpressure write하고EOF의size/hash를확인한다. file-type의실제MIME가명시MIME와같아야한다. Sharp는40M pixel제한과실metadata/stats decode를수행한다. 비디오는명시ffprobe,protocol_whitelist file,pipe,bounded1MiB출력,최대30초/잔여deadline,video stream/positive finite duration을요구한다. 별도native실행에서같은file,pipe옵션으로자기HTTP URL을넣었을때protocol거부와HTTP요청0을확인했다.

operation timeout/abort는fetch·stream에전달된다. metadata/objectbody의실제stalled read를각각70ms로취소하고같은reader의후속성공으로admission반환을확인했다. 동시에두번째요청은queue대기/추가network없이즉시unavailable이었다. 원46의동시abort격리도통과했다. admission은reader인스턴스별한도이며futureadapter가서버reader를재사용해야한다; 전체process/globaldisk예약/다른작업quota를보장하지않는다.

TOCTOU 독립대조에서objectbody대기중원metadata의MIME/key/hash 및globalfetch를바꿔도이미snapshot된승인값과capturedfetch만사용해정상검증했다. 이보장은검증후object삭제/덮어쓰기/DBrollback/bucket정책변경까지잠그는lease가아니다.

## cleanup realpath의 실증 및 명시적 한계

**경계 조건:** workRoot는non-served·access-restricted인operator신뢰영역이어야한다. 현재cleanup은realpath parent/name검사로바깥디렉터리재귀삭제를거부하지만,적대적인로컬사용자가generatedchild를바꾸는환경에서쓰기까지dirfd/no-follow로봉쇄하는구현은아니다.

독립case는자기scratch만사용해bucket응답전generatedchild를rename하고별도자기outside디렉터리로junction을교체했다. 다운로드파일은그outside의`object`에기록됐고,finally의realpath검사가STORAGE_TEMP로실패하여success/바깥재귀삭제를거부했다. outside sentinel은그대로보존됐다. 이결과를**밖으로쓰기조차불가능하다는증거로해석하면안된다**. 원래신뢰조건을깨는동일process의로컬root변조시험이며,HTTPmetadata만으로이변조권한이생기는것은아니다. 운영ACL을증명하지않는것과privateRoot변조공격비지원한계를Master에명시반환한다. 모든junction/held/output/sentinel은검증후자기경계확인하에정리했다.

finally는timer/listener를해제하고HTTP/stream/file을정리한뒤생성child만삭제하며,cleanup실패도failclosed하고active는최종감소한다. 파일시스템I/O·삭제완료를await한다. Sharp timeout은초단위/native동작,OS I/O/ACL/디스크가멈춘상황의즉각종료는이번보장이아니다. nativeimage의subsecond취소latency·2GiB실처리/메모리·globaldiskquota/Windows운영ACL·serverlessdisk적합성은미검증이다.

## 별도15건·B12 gap·RLS 구분

별도case: config/credential/URLbounds、managedref/origin형식、현재B12DTO의owner/MIME누락및foreignnetwork0、metadata/body각stalledtimeout、bucket-ID/encoding/length/hash거부4、redirectsink0、expectedoversize network0、snapshot/capturedfetch、noqueue/abort/reuse、realpathjunction、nativeffprobeHTTPprotocol거부 =15. 앞서14통과후nativeprotocol1건을추가했으며초기14를다시더하지않았다.

고정B12 DTO에는ownerId/MIME가없다. 독립availability에그DTO형태를직접전달하면false/network0이었다. actor.id로owner를채우거나kind로MIME를추론하는fallback없음. **B12와의실제DTO/DB등록/Storage연결은미완료이고B15별도범위**다. 검수중shared에B15 repo/adapter/test WIP가생긴것을관찰했으나fixed검수에섞거나수정하지않았다.

[공식Storage접근제어](https://supabase.com/docs/guides/storage/security/access-control)는servicekey가StorageRLS를우회함을명시한다. 이reader의서버owner/key검사성공을StorageRLS적용성공으로표시하지않는다. [privatebucket](https://supabase.com/docs/guides/storage/buckets/fundamentals)관측은각요청의getBucket id/public=false checkpoint일뿐policylock/실bucket권한/immutableupload증명이아니다. 공개문서만읽었고실account/bucket/policy에접근하지않았다.

## 명령·무결성·소유종료

```powershell
# 공유 저장소 cwd
git archive --format=tar --output=D:/starwork/b14-r-ba3ad44/source.tar ba3ad446a813a87354dd9bc746cb5d88c97577b7
tar -xf D:/starwork/b14-r-ba3ad44/source.tar -C D:/starwork/b14-r-ba3ad44
Copy-Item -LiteralPath D:/starwork/dream-ai-studio/.tools/ffmpeg -Destination D:/starwork/b14-r-ba3ad44/.tools/ffmpeg -Recurse
New-Item -ItemType Junction -Path D:/starwork/b14-r-ba3ad44/node_modules -Target D:/starwork/dream-ai-studio/node_modules
# 이하 자기 사본 cwd; root/.tools/tmp는사전에자기디렉터리만생성
node node_modules/vitest/vitest.mjs run tests/storage-private-read.test.ts tests/postgres/project-create.test.ts tests/postgres/connection.test.ts tests/postgres/project-read-backend.test.ts
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm.cmd run lint
$env:NODE_OPTIONS='--import=file:///D:/starwork/b14-r-ba3ad44/review/listen-trace.mjs'
node node_modules/vitest/vitest.mjs run tests/storage-private-read.test.ts
Remove-Item Env:NODE_OPTIONS
node node_modules/vitest/vitest.mjs run tests/b14-r-independent.test.ts
python review/integrity.py
```

모든로그/검수harness/SDKversion·무결성JSON은자기사본에보존. 원tsconfig/실product·tests·자기생성route types검사이며기대값완화/exclude/overlay없음. 원lint/tsc는자체검수harness추가전실행이라새harness까지lint/tsc검사했다고주장하지않는다.

- archiveSHA256 `03b763e1f399ec90abbfd965753e10fdaefe1037278698b3dc47d7d03a0e5008`; 원961파일종료변경0.
- 물리ffmpeg.exe SHA256 `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`,ffprobe.exe `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`; 원도구와4파일비교불일치0. 설치/공유도구수정없음.
- SQL3 rawhash archive/최종shared읽기불변:0001 `c45234e34c24132eed91369d90b8cb9cf0d1aaa58ec024c065a2fa91630ba9d3`,0002 `4d06083263a64c855bf427bb77ea9ef8ac8b40106224dbc1058209b013b540a1`,0003 `f55e09c1e403c1c57dd7130c7512b96b7b3eceee5e6beb13f771c05d6dc01dfd`.
- standalone listenertrace PID74544/58307에listen/close;자체초기PID65732/49174·49175,최종PID60676/62972·62973. `review/termination.json`에3PID불재,5port Listen0,ownnativeprocess0,scratch b14-* directory0.
- 마지막확인시각 **2026-11-17 21:16:16 KST**. 계기=검수/무결성/종료완료;실제확인=자기process·HTTPports·scratch/native종료,sharedgit/staged없음/최근handoff/WIP파일명대조. T222test/B15/T122/T137등다른작업은수정·stage하지않았다. 타worker전체진행/mailbox는이번확인범위아님. 턴밖자동점검미설정,polling없음.

실env/secret/Storagebucket/policy/managed/Auth/DB쓰기/API/SQL/3013/shared.next/package/원fixture/다른WIP/배포변경없음. 소유scratch삭제는모두경계검사후정상완료했고삭제자동승인거절/우회없음. 실제upload/RLS/immutableobjectpolicy/DB등록/B12adapter/전체suite/build/productionTLS/readiness는미수용이다.

Master반환: **B14-R scoped PASS**,원46·focused97(46중복)·자체15/원tsc·lint0,소유HTTP/native/scratch종료. realpathguard는바깥삭제거부이며privateRoot의적대적교체시쓰기까지막지않는한계를명시했다. B15DTO연결과실Storage/운영검증은별도작업으로남는다.
