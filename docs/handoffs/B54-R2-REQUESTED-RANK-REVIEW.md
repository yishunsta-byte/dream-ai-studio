# B54-R2 Requested rank independent re-review

2026-11-18 · Codex(Tester) · Master msg_1c7da8a42831의 두 번째 순차 작업. T247-R 보고8b4b7c0을 먼저 고정·반환하고 착수 통지한 뒤 검수했다. 대상 **f126c365392f4b4a8d46bcbcbf0ea7af46cb3a44**, 정확히 기존 observer/fixture와 신규 FIX 보고3경로.

**순수 metadata observer 범위 PASS. F54-1 해소, 이번 bounded 재검수의 필수 미해소 사항 없음.** Rank2/3 Requested는 인덱싱 전에 구조화된 InvalidBinding/stop-review로 거절한다. 실제 native CIM 결과/property accessor, caller bounds의 실측성, provider/Clock·live profile·후속 Startup/Current 허가는 검증/승인하지 않는다. 원래 B52 중단/Current0와 B48 FAIL/원인 미확정/pair 미완료는 그대로다.

Observer LF SHA **461e8b5552ff22c7579780bdd18a52c7c2c0718cc489083bbae174f3047137f2**, fixture **64d6503c22057653701f1ce93b4c6f4800406100acc8863c23403ce375491a9c**, FIX 보고 원문이 f126c365와 일치한다. helper에서 새 Rank1 조건과 줄바꿈만 역변환하면 원7354339 helper 전체 LF 원문/해시 **76002503ae4b6ed4e1dff3f6665d53aa37ec5f30cd9ba376762ad087a15e8461**과 일치한다. 다른 enum·metadata·bounds/native accessor·오류·출력 동작 변경이 없다. 기존85개 기대값은 완화하지 않았고14개 회귀를 추가했다.

검사 순서는 Requested가 실제 array인지 먼저 확인하고 Rank1, Count4, 원래의 네 문자열/순서를 차례로 확인한다. 유효하지 않으면 기존 Binding/InvalidBinding 기록으로 돌아가며 metadata 열람 전 종료한다. 기존 Injection rank 검사나 native 결과/enum 타입 검사는 바꾸지 않았다. 이 수정은 arbitrary-controller/callback sandbox 보장을 추가하지 않는다.

실제 복사본 검증 결과:

- **99/99 fixture PASS**, source/fixture parser0. Rank2/3, 비array list, 비영 lower bound, 잘못된 순서를 Stop/Continue 각각에서 검사해 단일 구조화 결과·오류 스트림0·throw0을 확인한다. 잘못된 형태의 metadata 읽기 합계0, 정상 string/object 배열4개 제어 사례는 허용된 getter 합계72회다.
- 원래 독립17개를 그대로 새 scratch에 복사해 **17/17 PASS**. 원시 enum 부호/폭/큰 수·unknown bit·extra name·bounds/ETS/native mock 경계가 유지됐다. 민감/provider/process/Clock/unexpected 카운터0; 의도된 trusted Name getter1회만 허용됐다.
- 별도 독립 **Rank2/3 × Stop/Continue4/4 PASS**. 정확히1개 stop-review 결과, Binding null/Validity.Binding=false/Property0/InvalidBinding1개, 오류 스트림0·metadata getter0·throw0 확인.
- 원래 Rank2 진단 복사본은 Stop/Continue 모두 더 이상 NeedMultidimensionalIndex가 발생하지 않고 stop-review/오류 스트림0/getter0을 반환했다. 원래 실패 결과 파일은 변경하지 않았다. 기존 rank1/lower-bound5 제어 사례도 throw 없이 structured InvalidBinding 거절을 유지한다.

허용된 mock metadata getter 실행은 trusted 주입 경로의 정상 검증이며 민감 getter/실제 native getter 실행과 구분한다. NativeLiveResultTested=false, LiveProfileValidated=false 및 caller-supplied-unverified-no-clock-read 라벨은 유지된다. 실제 CimInstance를 취득·생성해 native accessor 경로를 실행하지 않았다. enum fixture는 로컬 형식/메모리 검사이고 provider나 DLL 버전 실측이 아니다. 이 문서 작업에 전체 TS/앱 테스트·build는 불필요하여 실행하지 않았다.

Own ignored **tmp/b54r2-review-f126c36**에 preflight.mjs/preflight.json, 정확 source/fixture 복사본, observer-inverse.ps1, fixture-replay.json, 기존 independent/rank-check/lower-bound 스크립트의 동일 복사본과 각 신규 결과, rank-matrix.ps1/results를 보존했다. 실행은 기존 호스트 source-scriptblock 방식과 주입 데이터뿐이며 실행 정책·설치 변경이나 새 타깃 프로세스가 없다. 이전 script/result를 제자리에서 실행하거나 덮지 않았다.

원139개+기존 collector/driver/preflight3개+캡처5개+원 B54/report-review2개의 **149회 해시 대조(중복 재확인 포함)**가 모두 일치한다. 원139와 추가 대조를 구분했으며 intentionally edited current observer/fixture를 원문 불변이라고 부르지 않는다. Front T247 코드/문서·방금 고정한 첫 검수 보고, Master TEAM/plan WIP/shared index와 T122/T137은 건드리지 않았다. 실제 provider/Clock/driver 재실행·live OS/network/DB/native/process 조작·제품 변경·build/deploy/install/config/account/mail/Golden/state/runtime·새 agent/window/worktree 모두0회다. 운영5148/preview50963/Ego54/55/shared3013/.next를 보호했다.

Master 반환: B54-R2 fixedf126c365 scopedPASS/F54-1 해소. Rank1 선검사1조건 역변환 시 원helper76002503 전체동일, source461e8b55/fixture64d6503c 일치.99fixture+원독립17+추가rank4 PASS, 원Rank2 StopContinue가 structuredInvalidBinding/throw0/errorstream0/getter0으로 바뀜, 정상flat/lowerbound 제어 유지. 원139 보존 및149회 해시대조 일치(중복 재확인 포함), 민감/provider/process/Clock0/의도trustedgetter 구분. native 실제결과/bounds실측/liveprofile·B50/storage/approval 미검증·미연결, 다음Startup/live 권한이 아님. T247-R8b4b7c0 반환 이후 순차 수행했으며 두 작업의 근거·제한을 분리했다.
