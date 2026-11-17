# B4-G 신규 프로젝트 GET API

- 담당 Codex(Backend), 상위 CX-MASTER-01, 배정 msg_32f01842c2bc.
- 착수 SHA `5557085972a375f8d3c9f08977d819c3a35ae617`. 공유 Master/Front 배정이 계속 진행되어 마지막 HEAD는 `d539523bf407b1afacee37a9d5dc6ebb9f3c2206`이었다. 실제 HTTP는 아래 고정 사본 기준이다.
- 상태 **ready_review / 구현자 자체 검증**. GET은 새 기능이다. 공개 배포/managed 운영 연결/클라우드 전체 작업실 전환 완료가 아니다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `app/api/projects/route.ts` | `GET`만 추가. request adapter 한 번 생성→list→status/body/no-store 전달. 기존 POST/requestSchema 아래 구간 원문 유지 |
| `app/api/projects/[id]/route.ts` | 신규 GET. adapter 한 번 생성, `get(async()=>(await context.params).id)`로 Auth 뒤 params 읽기 |
| `tests/api-auth.test.ts` | 명시 guarded inventory에 `projects/[id]` 추가. 실제 glob **25개 = public 인증3 + 자체 password1 + guard21**. 기존 모든 export method 검사와 unknown 기본 보호·누락 검출 유지 |
| `tests/project-get-routes.test.ts` | GET DTO·상태/no-store·lazy params·이중 guard 없음, 기존 POST guard/body/400/201 분리 대조10건 |
| `tests/project-get-http.mjs` | 고정 소스 사본 Next dev/실제 Supabase SDK+fake Auth/새 TLS Postgres의 실제 HTTP 검증기 |
| 이 보고서 | 명령·실제 범위·실패 수정·격리/종료·후속 조건 |

Auth/legacy guard/logout/B3/B4-I/B4-S/service/repo/SQL/migration/package/RSC/3013/shared .next/실 DB/managed 설정은 변경하지 않았다. 다른 세션이 작업 중인 UI/RSC/인증 관련 WIP는 stage하지 않았다.

## API 계약

- GET `/api/projects`: 기존 service 목록 DTO 배열을 JSON으로 반환한다. 신규 pagination/filter/search/owner 입력은 만들지 않았다.
- GET `/api/projects/:id`: 기존 `{project,snapshot,inputs,states}` DTO. invalid UUID400, 없음/타 owner/archive는 동일404. Auth401/403/503·driver/설정503·no-store를 그대로 직렬화한다. redirect 없음.
- 각 handler에서 `createProjectReadRequest()` 1회, list/get 1회. requireApiAuth/resolveServerAuth를 별도 중복 호출하지 않는다. actor는 adapter의 검증 UUID만 사용한다. query/header로 전달한 owner 값은 무시되며 repository owner를 바꾸지 않는다.
- 단건 params는 callback으로 넘겨 Auth 실패 전에 읽지 않는다. 요청 본문도 읽지 않는다. GET은 SQLite fallback이나 기존 생성 service를 호출하지 않는다.
- POST는 기존 guard와 sync createProject 호출, `{errors:{_form}}`400/503 및 `{id}`201 모양을 유지한다. `git show 5557085`와 현재 `const requestSchema=` 이후 전체 구간을 정규화 줄바꿈으로 비교하여 **POST_SECTION_UNCHANGED=True**를 확인했다. T198 guard의 후속 정책 변경 수용은 별도 담당 범위다.

설치된 Next16.4.6의 `01-app/01-getting-started/15-route-handlers.md`, `01-app/03-api-reference/03-file-conventions/route.md`를 먼저 읽었다. Promise params와 기본 GET 비캐시 동작에 맞추었고, 사용자별 응답에 adapter의 명시 no-store도 유지한다.

## 직접 호출·회귀

| 명령 | 결과 |
|---|---|
| 최초 관련5파일(api-auth/project-get/t191/t182/maintenance) vitest | **187 PASS**, exit0 |
| 최종 관련8파일(위5 + request adapter/backend selector/projects) vitest | **236 PASS**, exit0, 18:56 KST |
| `npm.cmd run lint` | exit0, 경고0 |
| `npx.cmd tsc --noEmit --incremental false` | exit0 |
| `git diff --check` | exit0 |

새10건은 response wrapper에 DTO/status/header를 보존하는지와 params 평가 시점, GET에서 legacy guard/생성 서비스 미호출을 대조한다. POST 정상 생성 대조는 기존 service를 stub하여 원래 호출·201을 검증한 것이며 운영 데이터 생성 증거가 아니다. api-auth의 직접 실제 adapter/Auth 대역 검사는 신규 단건·목록 GET까지 401/403/503·body/params 미열람·no-store를 확인한다. 단순 기대값 완화/skip/공개 예외 추가는 없었다.

최초 HTTP 검증기 lint에서 미사용 global/미할당 변수/URL global3건이 발견되어 검증기만 고쳤다. 공개 API 구현 실패는 없었으며 최종 lint/type는 수정 후 통과했다. Windows Next dev child 종료를 명확히 하려고 기록된 자기 PID tree만 종료하도록 helper를 보완하고 최종 helper를 새 사본에서 다시 실행했다.

## 실제 HTTP 재현

```text
node tests/project-get-http.mjs --bin D:/starwork/dream-ai-studio/.tools/b3-postgres-18.7/pgsql/bin --openssl "C:/Program Files/Git/usr/bin/openssl.exe"
```

실제 Next dev `--webpack`와 실제 SDK를 사용했다. Auth provider만 loopback fake이고 DB는 **진짜 PostgreSQL18.7 + 제한 LOGIN/RLS**다. 운영 계정·메일·키·DSN은 사용하지 않았다. 시스템 서비스/PATH/인증서 저장소는 수정하지 않았다.

검증기는 실행 시 HEAD를 git archive로 고정하고 GET2개 파일만 overlay하여 SHA256을 기록한다. node_modules는 물리 복사하고 별도 app/.next에서만 실행한다. gitignored .env/실 데이터는 가져오지 않는다. 환경의 기존 PG/DREAM/VERCEL/Supabase/DSN/TLS 우회 변수는 test process에서 제거하고 합성 값만 주입한다.

test 전용 OpenSSL self-signed 인증서/IP SAN을 소유 tmp에 만들었다. Next process만 `NODE_EXTRA_CA_CERTS`로 신뢰하고 B3 pool의 `rejectUnauthorized:true`는 유지한다. Postgres SSL을 켜고 실제 API login 연결의 **TLSv1.3 / TLS_AES_256_GCM_SHA384**를 pg_stat_ssl로 확인했다. 검증기 admin도 TLS였다. 실제 managed CA/pooler 검증을 의미하지 않는다.

두 번 모두 **7개 실제 HTTP 시나리오 PASS**, 명령 exit0. 반복 결과를 추가7개로 합산하지 않는다.

1. A→B→A 각각 목록200/자기 단건200/타인 단건404. 목록 query `owner_id=타인`, header `x-owner-id=타인`을 넣어도 자기 UUID만 반환한다. no-store 및 DTO 보존.
2. 각 정상 목록 HTTP에서 fake `/auth/v1/user` 호출 **2회 = proxy1 + handler1**. 이를 내부 getUser2회로 오해하지 않는다. handler1회는 direct adapter/route 구성과 기존 T193 근거로도 구분한다.
3. 익명401, proxy A 통과 뒤 handler forbidden403, proxy 통과 뒤 handler provider500→503. status/code/no-store 확인. 전후 소유 test DB의 API login pg_stat_activity state_change/query_start가 그대로여서 거부 요청 DB query0을 대조했다. params 미열람은 직접 호출 검사에서 별도 확인했다.
4. invalid project UUID400, 실제 DB snapshot 손상503 PROJECT_READ_UNAVAILABLE 후 복구.
5. A token을 fake provider에서 만료시키면 새 A 요청401, B는 계속200. 응답에 서버 합성 sentinel·DSN 미노출. fake event에는 Authorization/cookie/token 원문을 기록하지 않았다.

### 고정 소스·증거

| run | 소스 기준 | 소유 PID/port·종료 |
|---|---|---|
| `tmp/b4g-http-cf65c608-292e-455e-830a-56fb8c44732c/` | base `1894c0f0f9ffdd61ff43d2df2924a12d6e35ff50` + GET2 overlay | appPID73316, pgPID70296, app49454/PG49450/Auth49453. 종료 후 listener 모두0·Postgres PID파일 없음 |
| 최종 `tmp/b4g-http-95ee0c03-c716-41ca-ab7e-e9f51ced28a5/` | base `acfbd0b3f9c34efc8ff8eeba3ff591792bc1ce1e` + 동일 GET2 overlay | appPID6992/child26376, pgPID74396, app57211/PG57205/Auth57209. 자기 tree 종료 로그·PG server stopped, listener 모두0·PID파일 없음 |

GET overlay SHA256 두 run 동일:

- list `ed98d4ddec526ade25616a1fa6dcd5434b2fad8faad8e58936a5b73c7e522183`
- detail `346e66171a98d3885c56d0b73c08d08e391021ffaaecbcaefccd5190dcebfea7`

source.json/run.json/http-results.json/fake-events.json/tls.json/signatures.log/next.log/next-stop.log(최종)/stop.log와 source archive를 보존했다. 두 run의 fake-runtime 폴더는 생성되지 않아 GET이 SQLite startup/파일 probe로 우회하지 않은 대조도 확인했다. TLS private key·dummy 자격·증거는 ignored tmp 밖에 올리지 않았으며 삭제하지 않았다. 루트3013과 shared .next에는 명령을 실행하지 않았다.

## 미검증 · 다음 조건

- 실제 검증은 격리 **Next dev**다. production build/start·배포 artifact·성능·고부하/전체 동시성 행렬은 새로 검증하지 않았다. 공유 .next 보호 때문에 build/typegen은 실행하지 않았다. UI/실기기·managed Supabase/RLS login/pooler/Auth FK/운영 TLS 체인은 별도다.
- 현재 source tree에 GET 기능을 추가한 것이며 외부 환경변수/주소/서비스를 열거나 push/deploy하지 않았다. 실제 배포는 B4-I/GET 독립 수용과 T198 legacy API 차단·RSC local loader 차단의 통합 검수 후 Master가 별도 결정해야 한다.
- 기존 API들이 SQLite를 사용하므로 신규 GET 성공만으로 전체 제품 클라우드 전환을 선언하면 안 된다. 후속 read-only UI가 기존 stage/render/new project 화면의 로컬 연쇄를 호출하지 않는지도 별도 검증해야 한다.

복사/전달 메시지:

> B4-G ready_review. 신규 GET /api/projects 및 /api/projects/[id], adapter1회/lazyparams/no-store·DTO 보존, 기존 POST구간 원문동일. 실제inventory25(public3/self1/guard21), 직접/회귀8파일236PASS·lint/type exit0. 고정사본 Nextdev+fakeAuth+새TLS Postgres HTTP7시나리오PASS: A/B/A owner·404·401/403/503·provider검증proxy1+handler1·거부DBquery0·만료A/B유지. 최종 API login TLS1.3 확인. 두 소유run listener0/PG종료·증거보존, Auth/service/SQL/package/RSC/3013/shared.next/managed불변. 독립 GET 및 T198/RSC 차단 통합검수 전 공개 opt-in/배포 금지 유지.
