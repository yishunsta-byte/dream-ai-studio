# T201 프로젝트 GET API 독립검수 — 지정 범위 PASS

- 검수자: Codex(Tester), B4-G 구현 비참여.
- 날짜: 2026-11-17 KST.
- 배정 `msg_d866d4120099`, 기준 **`74e3be7e90527d234ae821dd80870247b4c77416` 고정**.
- B4-G 보고서 원문, GET2, request adapter·Auth/legacy 경계·inventory·HTTP 실행기를 읽었다.
- **판정: 신규 프로젝트 GET2의 지정 격리 범위 PASS. 새 필수 수정 없음.** managed 운영/standalone/운영 DB 적용·전체 클라우드 작업실 수용을 의미하지 않는다.
- Auth/T198/RSC/서비스/SQL 제품 코드는 수정하지 않았다. 병행 T199의 전체 legacy 검수와 후속 RSC WIP를 대신하거나 섞지 않았다. 공유 저장소에는 본 고유 보고서만 작성했다.

## 고정 사본·실제 실행기

사본 `D:/starwork/t201-project-74e3be7`은 고정 commit을 git archive로 추출했다. 종료 후 tracked **823개 파일이 Git blob과 전부 바이트 일치, 차이0**(`evidence/baseline-integrity.json`). 실행기가 HEAD를 자체 archive하므로 사본에만 Git 메타데이터/고정 ref를 만들어 HEAD를74e3be7로 지정했다. 공유 브랜치/작업트리를 checkout하거나 변경하지 않았다.

원본 **`tests/project-get-http.mjs`를 수정 없이 실제 실행**했다. 실행기가 만든 source.json/run.json의 base도74e3be7임을 확인했다. GET2 overlay는 동일 고정 파일이며 다음 SHA256이다.

- 목록 `07127beb56e8f54439878f70ec1dc84d3a6cd690878510102a7b85164b1c0cc4`
- 단건 `346e66171a98d3885c56d0b73c08d08e391021ffaaecbcaefccd5190dcebfea7`

목록 SHA가 작성자 ed98…와 다른 이유는 직접 계산한 **같은 내용의 LF/CRLF 차이**다. 이번 Git LF 원본0712…를 CRLF로 바꾸면 작성자 ed98…와 일치한다. 폴더명/작성자 서명만으로 소스 동일성을 가정하지 않았다.

node_modules·서명된 EDB PostgreSQL18.7 도구 bundle·ffmpeg/probe를 물리 복사했다. OpenSSL3.5.9와 필요한 MSYS DLL도 기존 Git 설치본에서 자기 .tools로 물리 복사했다. 설치·공유 도구 변경·시스템 서비스/PATH/인증서 저장소 변경은 없다.

실행 환경은 Windows/Node26.13.0/npm11.20.0/Next16.4.6/pg8.23.1/Vitest5.1.0이다. 실행기는 기존 PG/DREAM/VERCEL/Supabase/DSN/TLS 우회 환경을 제거하고 새 합성 값만 사용한다. 실제 Supabase SDK·SSR 쿠키·Next dev(--webpack)를 쓰며 인증 provider HTTP만 fake다. DB는 새로 initdb한 **실제 PostgreSQL18.7**이다. 운영 DSN/계정/메일·사용자 DB를 읽거나 연결하지 않았다.

## 원본7 시나리오: 독립 재실행 PASS

명령(exit0):

```text
node tests/project-get-http.mjs --bin D:/starwork/t201-project-74e3be7/.tools/b3-postgres-18.7/pgsql/bin --openssl D:/starwork/t201-project-74e3be7/.tools/openssl/openssl.exe
```

근거 run: `tmp/b4g-http-52241e12-ceb0-4b86-9bdb-ea1675b7a810/`, console은 `evidence/original-http-runner.log`.

| 원본 관찰 | 실제 결과 |
|---|---|
| A→B→A 목록/자기 단건/타인 단건 | 각각200/200/404 NOT_FOUND. 목록에 타인 owner_id query와 x-owner-id header를 넣어도 자기 프로젝트1개만 반환 |
| 정상 목록 getUser | 각 HTTP에서2회 = proxy1+handler1. 별도 adapter/route unit도 이중 guard 미호출 확인 |
| 익명 | 401 AUTH_REQUIRED/no-store, DB activity 변화0 |
| proxy는 A 허용, handler는 outside | 403 AUTH_FORBIDDEN/no-store, DB activity 변화0 |
| proxy는 A 허용, handler provider500 | 503 AUTH_UNAVAILABLE/no-store, DB activity 변화0 |
| invalid UUID / 실제 DB snapshot 손상 | 400 INVALID_INPUT /503 PROJECT_READ_UNAVAILABLE, 손상 fixture 복구 |
| fake provider에서 A token 만료 | 새 A 요청401, B는 계속200 |

원본 출력의7개 관찰은 A/B/A3 + 인증 거부3 + invalid/corrupt/expired 묶음1이다. 이를 임의로7개 단위시험 또는 작성자의 이전 run과 합산하지 않는다.

`result-audit.mjs`에서 목록·단건·타인404·401/403/503·invalid/corrupt/expired의 **no-store**를 JSON 원자료로 추가 단언했다. 인증 거부는 Location도 null이다. 모든 HTTP 응답에서 합성 서버 sentinel/가상 DSN 미노출을 원 실행기가 검사했다. 모든 가능한 비밀 유출이 없다는 일반 판정은 아니다.

## proxy만 통과한 성공을 피한 handler 거부 대조

실행기는 가상 getUser 응답을 요청별 순서로 제어한다. 정상2회 호출뿐 아니라 다음 인증 오류 시퀀스를 fake-events.json에서 독립 재확인했다.

1. A200(proxy) → outside의 UUID B200(handler) → API403.
2. A200(proxy) → A token의 provider500(handler) → API503.

각 거부 전후 API login만 필터한 pg_stat_activity의 pid/state_change/query_start가 동일했다. 따라서 **403/503이 proxy에서만 막힌 결과가 아니라 handler 인증이 거부하고 데이터 조회에 들어가지 않은 대조**다. 익명401은 proxy의 선행 차단이다. DB query0은 이 통제된 실행·관찰 구간의 증거이며 일반 트래픽 전체의 무조회 주장으로 확장하지 않는다.

body/params 선행 거부는 실제 route import를 사용하는 api-auth와 project-get-routes의 spy/lazy callback 시험에서도 통과했다. 단건은 Auth 뒤 실행될 callback으로 params를 넘기며 GET handler가 request owner나 별도 requireApiAuth를 재조회하지 않는다.

## 실제 SQL/TLS/RLS 경계

새 cluster의 합성 auth.users/두 소유 프로젝트/단계 fixture를 만들고 고정 SQL3파일을 그 **새 테스트 DB에만** 적용했다. API login은 NOINHERIT/NOSUPERUSER/NOBYPASSRLS/NOCREATEDB/NOCREATEROLE이며 dream_api 역할 사용 권한만 받았다. A/B/A의 실제 SQL 결과로 검증 UUID에 따른 읽기를 확인했다.

두 run 모두 pg_stat_ssl에서 실제 API login의:

- ssl=true
- **TLSv1.3**
- **TLS_AES_256_GCM_SHA384**

를 확인했다. admin fixture 연결도TLS1.3이었다. 서명 검사 로그에서 postgres/initdb/pg_ctl/createdb4개는 Valid EnterpriseDB였다. 자기 OpenSSL로 생성한1일짜리 self-signed IP SAN 인증서를 자기 Next process의 NODE_EXTRA_CA_CERTS로만 신뢰했고, rejectUnauthorized=true는 유지했다.

이는 새 로컬 TLS Postgres의 실제 결과다. managed Supabase Auth FK/실제 운영 역할·pooler/운영 CA·이미 적용된 DB migration·실제 데이터 연결 PASS가 아니다.

## POST·inventory·unknown route 보호

`source-audit.json`: 목록 파일의 **`const requestSchema=` 이후 전체 본문이5557085972a375f8d3c9f08977d819c3a35ae617과 LF 정규화 후 동일**하다. section SHA256은 `46cfd82b031eed9fc7162a4ecef9e89e76f538232cf30c9f78b272e4a320ccc2`다. guard/body 읽기/400 errors._form/201 id·기존 sync createProject 호출 대조도 관련 시험에 포함됐다. POST201 대조는 service stub을 사용하는 단위 근거이며 운영 데이터 생성 증거가 아니다.

inventory는 실제25개(public Auth3/self password1/guard21), GET/POST 등 실제 export method 전체 검사를 유지한다. 신규 GET을 보호 목록에서 지우거나 기대값을 낮추지 않았다.

독립 음성 대조로 **자기 사본에만** guard가 없는 임시 unknown GET route를 추가했다. api-auth는 예상대로 **exit1,5FAIL/108PASS**였다: inventory 누락1 + 그 route의 인증 거부4조건 실패. 즉 등록되지 않은 API/누락된 handler guard가 조용히 성공하지 않는다. 자기 임시 파일만 finally에서 제거했고, 다시 **api-auth109PASS/exit0** 및 working inventory25를 확인했다. 이5FAIL은 의도한 음성 대조이며 제품 결함으로 보고하지 않는다. shared 제품 route를 변경하지 않았다.

## T198와 신규 GET의 결합 확인

74e3be7이 T198 **acfbd0b3f9c34efc8ff8eeba3ff591792bc1ce1e**를 포함하는 것을 merge-base/source로 확인했다. 후속 RSC WIP는 고정본에 포함시키지 않았다.

원 실행기를 보존하고 자기 사본에만 보완 실행기를 생성했다(`tmp/t201/make-supplement.mjs` → `tests/t201-project-get-http-extended.mjs`). 원본7은 그대로 실행하고 마지막에 아래1묶음을 추가했다. 다른 fresh cluster에서 exit0/8관찰이었으며, 반복된 원7을 신규 결과에 이중 합산하지 않는다.

- 같은 postgres 모드의 B 프로젝트 GET은200/no-store.
- legacy jobs GET/backups GET은503 LEGACY_DATA_UNAVAILABLE/no-store.
- 같은 `/api/projects`의 **POST는503 LEGACY_DATA_UNAVAILABLE**, 깨진 JSON을 보내도 body 파싱까지 가지 않음.
- 익명 projects POST는 legacy503보다 인증401 AUTH_REQUIRED가 먼저이며 no-store.
- legacy 거부 묶음 전후 API login DB activity 변화0.
- 전체 실행 후 fake-runtime 경로가 존재하지 않아 GET/legacy 거부가 SQLite startup/파일 생성으로 우회하지 않은 대조.

근거: `tmp/b4g-http-0a040d40-24dd-4aea-9d4a-c7a68273e4f0/http-results.json` 마지막 T201 레코드. 이 좁은 결합 검증은 별도 T199의 모든 legacy 메서드/전체 환경 검수를 대신하지 않는다.

## 실제 실행 검사

| 명령/검사 | 결과 |
|---|---|
| api-auth/project-get-routes/t191/t182/maintenance/project-read-request/project-read-backend/local projects8파일 | **exit0,236PASS**, related236.log |
| `npm.cmd run lint` | exit0, 경고0, lint.log |
| `npm.cmd run typecheck` | exit0, typegen+tsc, typecheck.log |
| `npm.cmd run build` | exit0, 운영 빌드+verify-build, build.log |
| 원본 `tests/project-get-http.mjs` 실제 실행 | exit0, 원7관찰PASS, original-http-runner.log |
| 음성 unknown route 대조 | 기대 exit1/5FAIL, 제거 후 api-auth109PASS, unknown-route-negative.log/inventory-restored-positive.log |
| 사본 전용 보완 HTTP 실행 | exit0, 원7+결합1관찰, combined-http-runner.log |
| `node tmp/t201/result-audit.mjs` | exit0, source/TLS/거부 events/no-store/종료/inventory 재단언 |
| `node tmp/t201/verify-baseline.mjs` | 823 tracked blob 일치/차이0 |

236 명령:

```text
npm.cmd test -- tests/api-auth.test.ts tests/project-get-routes.test.ts tests/t191-auth-resolver.test.ts tests/t182-auth.test.ts tests/maintenance-routes.test.ts tests/postgres/project-read-request.test.ts tests/postgres/project-read-backend.test.ts tests/projects.test.ts
```

원본236과 반복 복구109를 합산하지 않는다. 작성자236·다른 검수의925/1060 등도 독립 숫자에 합산하지 않았다. build/type/lint는 보완 시험·음성 파일을 만들기 전 고정 제품에서 실행했고, 제품 수정이 없으며 종료 시 tracked 전체 동일성을 재확인했다.

## 소유 실행·정리·미검증

| run | base | 소유 PID/ports |
|---|---|---|
| 원본 b4g-http-52241e12… |74e3be7|Next72172/PG70568, app61617/PG61612/Auth61616|
| 보완 b4g-http-0a040d40… |74e3be7|Next74876/PG78948, app58305/PG58301/Auth58304|

두 실행기 finally가 기록된 자기 Next dev PID tree만 종료하고 admin pool/fakeAuth를 닫은 뒤 자기 cluster를 pg_ctl fast stop했다. next-stop.log/stop.log, postmaster.pid 부재, **소유6개 listener 부재**를 확인했다. 공유3013은 PID51032 유지, shared .next 대상 명령 없음. 운영 DB/계정·메일·Auth/T198/RSC·SQL 제품·서비스 설정·Vercel·push/deploy 변경은 없다.

원 ZIP/Git 고정 사본/두 fresh cluster·합성 자격/임시 인증서·로그·JSON을 ignored tmp에 보존했다. 임시 unknown route 파일은 제거했고 보완 검수 실행기는 자기 사본에 남겼다. 자동 승인 거절/거절 우회는 없다. native 도구를 시스템 서비스로 등록하거나 설치하지 않았다.

실제 HTTP는 **Next dev**이며 production build 통과와 구분한다. standalone production start·배포 artifact·성능/전체 동시성·managed Auth/pooler·운영 DB 적용·후속 RSC loader 차단·전체 클라우드 제품은 미검증이다. 새 GET 수용을 기존 작성/렌더/파일 경로의 cloud 개방으로 확대하지 않는다.

Master 복사용: T20174e3be7 고정 신규 프로젝트 GET 독립PASS입니다. 원 tests/project-get-http.mjs 실제 SDK/fakeAuth/새TLS Postgres/Nextdev7관찰 재실행, A/B/A 목록·단건·타인404·ownerquery/header무시·proxy통과후handler403/503 및 DBactivity0·invalid400/corrupt503/만료A401-B200·proxy1+handler1·TLS1.3/no-store 확인했습니다. T198acfbd 포함 고정 보완run에서 GET200과 jobs/backupsGET·projectsPOST503LEGACY·익명POST401·DBquery0/SQLite경로미생성도 확인했습니다. POSTschema이후5557085동일, inventory25 및 unknownroute추가시5기대FAIL/제거후109PASS, 관련236/lint/type/buildPASS. 823trackedblob일치, 소유6ports/PG종료/3013보호·증거보존. 운영/managed/standalone/RSC전체수용은 별도이며 고유보고서 선택commit으로 반환합니다.
