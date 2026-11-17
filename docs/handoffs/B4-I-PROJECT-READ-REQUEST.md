# B4-I 인증 → 프로젝트 읽기 request adapter

- 담당 Codex(Backend), 상위 CX-MASTER-01, 배정 msg_d9202fe317fa.
- 착수 SHA `24b48033f9ca0db77722d584db3190d6675229f6`. 최종 검증 중 공유 HEAD `47c1e56739e25ba12cd10cd55621cdbac276d32b` 확인.
- 상태 **ready_review / 구현자 자체 검증**. 실제 HTTP route/RSC는 연결하지 않았다. managed DB·공개 GET 개통·클라우드 작업실 전체 완료가 아니다.
- 작업 중 Master의 T193 인증 독립 수용(msg_35d43bc60390), B4-R 서비스 독립 수용(msg_3bbc248d273b)을 수신했다. T193 원보고서 지정 범위 PASS와 실제 Auth DTO를 읽었다. 이번 신규 adapter는 별도 독립 검수 대상이다.

## 변경 범위

| 파일 | 변경 |
|---|---|
| `lib/services/postgres/project-read-request.ts` | `createProjectReadRequest()` 신규. request closure에서 resolveServerAuth 1회 공유, denied/local/잘못된 UUID는 환경·pool 전 차단. verified UUID만 actor로 생성하고 selector → pool → B4-S service 호출 |
| `lib/services/postgres/project-read-pool.ts` | server-only lazy pool manager, 동일 target 재사용·target 변경 거부·명시 idempotent shutdown. 기본 process pool은 non-enumerable Symbol slot으로 module reload에도 재사용 |
| `tests/postgres/project-read-request.test.ts` | 단위21건: 실제 T191 resolver+가짜 SDK getUser 1회/새 요청 재검증, 거부 DTO 일치·환경/params/DB 미접근, selector 실패, pool/TLS/수명·module reload |
| `tests/postgres/project-read-request-integration.test.ts` | 새 합성 cluster·fake verified resolver·제한 login·실제 pg driver 통합8건 |
| `tests/postgres/run-local.mjs` | 고정 `b4i` suite만 추가. B3/B4 suite 유지. 임의 test 명령이나 target 인자를 실행하지 않음 |
| 이 보고서 | 증거·제약·다음 API/legacy 차단 범위안 |

Auth/B3/기존 B4-S 서비스·repo/기존 SQLite/SQL/migration/API/page/worker/package는 수정하지 않았다. .env/example·README·shared .next·3013·실 DB·managed 환경도 변경하지 않았다. 다른 세션 UI/browser WIP와 기존 보고서는 stage에서 제외한다.

## 호출 계약

```ts
// 후속 진입점에서 요청마다 한 번 생성한다. module/global에 보관하지 않는다.
const reads = createProjectReadRequest();
const listReply = await reads.list();
// 거부된 요청은 이 callback을 평가하지 않는다.
const detailReply = await reads.get(async () => (await context.params).id);
```

- 동일 request 객체의 동시 list/get도 인증을 1회만 판별하고 같은 verified actor/pool 결정을 사용한다. **데이터 결과는 cache하지 않고** 매 operation 새 B4-S 읽기 transaction을 실행한다. 다른 요청은 새 객체를 만들고 Auth를 다시 검증한다.
- denied는 기존 authDeniedResponse와 동일 `{error,code}`, 401/403/503, no-store descriptor를 반환한다. redirect 없음. resolver throw·local·빈 email·잘못된 UUID는 fixed503 AUTH_UNAVAILABLE이며 임의 local actor를 만들지 않는다. 잘못된 denied status/code 조합도 503으로 닫는다.
- 환경 snapshot과 selector는 verified 후에만 평가한다. authMode(env)를 selector에 명시 전달한다. postgres 외 선택·missing/invalid/off/DSN 누락은 fail closed이며 **이 adapter에서 SQLite 호출은 없다**. 로컬 기존 업무는 아직 기존 호출자에 그대로 남아 있다.
- reply는 `{status:200,body:기존DTO,headers:{cache-control:'no-store'}}` 또는 안전 오류 descriptor다. 실제 Response/route를 생성하지 않는다. 임의 driver/내부 500은 503 PROJECT_READ_UNAVAILABLE로 매핑하고 stack/cause/DSN/SQL을 내보내지 않는다.
- get은 string 또는 lazy ID reader를 받는다. 실제 route는 lazy callback을 사용해야 Auth 거부 전 params를 읽지 않는다. B4-S가 project UUID 형식/404·owner scope를 처리한다. request body/owner_id/header로 사용자 actor를 지정하는 입력은 없다.

## pool 수명과 비밀

- import 시 접속/설정 읽기/DDL/신호 핸들러 등록 없음. manager.get 최초 호출도 B3 lazy Pool만 만들고 실제 connect는 service transaction에서 한다.
- server process의 global Symbol에는 manager만 저장한다. actor/user/email/Auth promise/request/프로젝트 DTO는 저장하지 않는다. manager의 target/자격 문자열은 closure에 있고 공개 JSON/debug 상태나 로그를 만들지 않는다.
- 같은 target은 같은 pool, target 변경은 PG_CONFIG로 차단한다. 설정 변경은 새 manager/process로 수행한다. 자동으로 다른 DB에 붙거나 두 번째 target으로 우회하지 않는다.
- `closeProcessProjectReadPool()`은 명시 host shutdown hook이며 terminal/idempotent다. 닫은 manager는 다시 열지 않는다. pool.end 실패도 비밀 없는 안전 오류로 변환한다. signal handling·재시작은 후속 host 소유자 책임이다.
- 기본 process manager는 B3 원격 TLS 검증과 유한 timeout/max를 그대로 사용하며 TLS 해제 env를 만들지 않았다. 합성 integration만 명시 manager factory의 localTestWithoutTls로 B3가 허용한 loopback dream_test_*에 접속한다. custom CA/max는 server-only factory 옵션이며 실제 운영 CA/provision은 미확인이다.

## 실제 검증

| 명령 | 최종 결과 |
|---|---|
| `node tests/postgres/run-local.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin b4i` | **3파일49 PASS = B3 unit20 + 신규 unit21 + 실제 adapter integration8**, exit0 |
| 관련 vitest10파일(request/connection/backend/api-auth/t191/t182/t183/projects/planning/jobs) | **280 PASS**, exit0, 18:43 KST |
| `npm.cmd run lint` | exit0·경고0 |
| `npx.cmd tsc --noEmit --incremental false` | exit0 |
| `git diff --check` | exit0 |

최초 새 integration 파일에 제네릭 닫는 괄호가 하나 더 있어 parser/lint/type가 실패했다. 해당 test 오타만 수정했고 이후 실제47 PASS → process-reload 검사 추가48 PASS → lazy params 최종49 PASS로 재검증했다. 처음 실패 run과 정상 run 증거를 보존한다. 숫자는 서로 반복되므로 합산하지 않는다. 전체 suite/build/typegen은 반복하지 않았으며 browser/실제 Auth SDK→managed DB 전 구간 완료를 주장하지 않는다.

실제 integration은 fake verified resolver를 사용하고 **실제 pg/제한 API login/RLS/B4-S service/pool manager**를 통과했다. 별도로 unit에서 실제 T191 resolver와 fake SDK getUser를 사용해 한 request 내부1회·다음 만료 요청 재판별을 확인했다. fake Auth 검증을 실제 Supabase 로그인 증거로 표현하지 않는다.

실제 integration8:

1. 한 요청의 동시 list/get(lazy params) 성공, resolver/environment/getPool 각1회, DTO·no-store 확인.
2. 동일 size1 process manager의 연결이 A→B에 재사용되어 B 목록만 보이고 A 단건404. 다음 직접 client에서 같은 PID·login role 복귀·actor null 확인.
3. AUTH_REQUIRED401/AUTH_FORBIDDEN403/AUTH_UNAVAILABLE503 각각 환경 getter/getPool/connect 모두0. 익명 query 경로 없음.
4. local/sqlite/off/DSN 없음/Vercel 미설정이 실제 pool 접속 전에 차단됨.
5. 성공 요청 뒤 별도 만료 요청은401로 재검증하며 pool 미접근.
6. 손상 snapshot을 실제 합성 DB에 넣으면 고정503·DSN/SQL 미노출. raw driver 정보를 외부 메시지로 사용하지 않음.

최종 run 증거는 `tmp/b3-postgres-2e78e835-15df-4a8e-84b8-7bc6c0204384/`의 run.json/signatures.log/listener.log/tests.log/stop.log. PID43068/port54174/127.0.0.1이며 stop.log server stopped, 종료 후 PID 파일 없음·listener0을 확인했다. B3와 같은 서명 검증 portable18.7을 실행했으며 새 cluster·미사용 loopback port·test DB·dummy 자격만 사용했다. 이전 정상 run `tmp/b3-postgres-bf2618a1-83e4-4d08-af1d-291b4ed2f2ca/`, `tmp/b3-postgres-53a3b5cd-0511-4283-a6f5-21a3084155f3/`와 최초 parser 실패 `tmp/b3-postgres-c9ff2133-a3e4-41c1-bfee-7a4044628039/`도 보존한다. 이 세 run도 종료·PID 파일 없음·listener0(56664/57166/63097)을 확인했다. 실제 실행은 이 네 소유 run만이며 production DSN을 탐색하지 않았다.

## 다음 공개 GET/legacy 차단 범위안 (현재 미구현)

1. B4-I 독립 수용 후 Master가 `app/api/projects/route.ts`의 GET 추가와 신규 `app/api/projects/[id]/route.ts` GET을 별도로 배정한다. 기존 POST의 요청/응답 모양을 유지하고, 새 GET은 request adapter를 **한 번 생성**해 호출한다. 단건은 lazy params로 Auth 이후 읽고 no-store descriptor를 Response로 옮긴다. 같은 handler에서 requireApiAuth/resolveServerAuth를 추가 호출하지 않는다. api-auth 명시 inventory에 신규 경로와 메서드를 추가한다.
2. postgres opt-in 공개 전에 별도 legacy gate가 필요하다. Front 소유 `requireApiAuth` 호환 adapter에 Master가 승인한 `legacy-data`/`auth-only` 구분을 검토한다. 기존 업무 경로는 기본 legacy-data이며 Vercel/PG·unknown 설정에서 인증 뒤503으로 닫고, logout 등 인증 전용 경로는 가능하게 유지한다. 새 read adapter는 해당 legacy guard를 중복 호출하지 않는다. 모든 기존 메서드의 body/params/SQLite 미접근 negative control을 검사한다.
3. RSC는 CloudPending만으로 child 실행이 막힌다고 가정하지 않는다. 미전환 page의 로컬 loader/checkStartup/file probe를 실행 전에 막는 별도 범위를 배정한다. 특히 Home의 최근활동·상세/stage/render의 연쇄 SQLite service·new choices/생성을 cloud read와 섞지 않는다. 아직 이 차단이 없어 env opt-in으로 외부 공개할 조건이 충족되지 않았다.
4. 단건/목록 API 실제 HTTP(401/403/503/404, 파라미터 미열람, A/B 응답·중복 getUser1회), legacy gate, 별도 read-only RSC/UI, build/독립 검수 후 Master가 배포 여부를 결정한다. managed login/RLS/Auth FK/pooler/TLS·비밀 provision·운영 SQL 적용은 여전히 별도 staging 증거가 필요하다.

복사/전달 메시지:

> B4-I ready_review. 신규 request adapter+server-only process pool만 구현, 생산route/RSC 미연결. T191resolver 요청1회·denied/local 환경/DB/params미접근·verifiedUUID→actor·selector failclosed·동일pool A/B분리 확인. 최종 실제PG8 포함49PASS·영향10파일280PASS·lint/type exit0. 고유 보고서와 portable runner b4i 증거 반환, Auth/B3/B4-S서비스/SQLite/SQL/package/3013/.next/managed불변. T193·B4-R 수용 수신과 별개로 이번 adapter 독립검수 후 GET/legacy gate 별도 배정 요청.
