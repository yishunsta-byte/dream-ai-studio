# T-211 클라우드 읽기 UI 독립 검수

- **판정: bounded PASS**. 기준 **`679e703af6c06f73fc8abcd57e8afecefd33f645`**, T207+T210 범위에서 새 필수 결함을 발견하지 않았다. 개통·배포·전체 제품 완료 판정은 아니다.
- CX-MASTER-01 배정 독립 작업자의 재실행이다. `T-207-CLOUD-READ-UI.md`, `T-210-CLOUD-AUTH-REDIRECT-FIX.md` 전문, T206 계약, 실제 runner·helper·pages/layout·표시 컴포넌트 및 기존 request adapter/Auth 경로를 읽었다. 작성자의 수치를 합산하지 않았다.
- T202 원 FAIL/보고서는 그대로 보존했다. Master 결정 TEAM `0c64d7c`에 따라 기존 root의 **고정 `docs/spec/menus.json` 읽기만** 예외로 수용했다. 동적 메뉴·사용자 DB/파일·외부 설정·사용자 제어 경로로 예외를 확대하지 않았다. root 설정 오류가 로그인 포함 전체 화면을 막는 기존 한계도 유지된다.

## 고정 사본과 보호 범위

소유 root `C:/Users/Administrator/AppData/Local/Temp/t211-review-946061d68406482a83b5ab9478365243` 아래 `snapshot/`을 기준 SHA archive로 만들었다. runner의 `git rev-parse HEAD`도 이 SHA를 가리키도록 **사본 내부에만** 독립 Git metadata를 준비했다. 실제 runner가 다시 이 HEAD archive를 만들어 실행했다.

실제 실행 증거 E:
`<owned-root>/snapshot/tmp/t207-http-a01496b1-76b0-44d3-9d6f-4ce416f12551/`

- E/source.json의 base는 위 SHA, overlay 8개. 실제 inner app의 8개 SHA256이 source.json과 **8/8 일치**했다.
- Git blob은 LF, archive/overlay는 CRLF였으므로 Git blob과 raw byte hash가 같다고 주장하지 않는다. 독립 비교에서 8개 모두 **줄끝 정규화 후 내용 동일**이었다(`independent-static.json`에 양쪽 실제 hash·canonicalEqual 보존). 사본 제품 파일을 수정해 맞춘 것이 아니다.
- `loading.tsx`는 기준 commit부터 없었다. 따라서 source.json `removed: []`가 정상이며 최종 inner 사본에도 목록/루트 loading 파일이 없었다. runner가 이전 HEAD에 파일이 남은 경우 삭제를 반영하는 분기도 코드 검토했다. 그 과거 HEAD 삭제 분기를 이번에 별도로 실행한 것은 아니다.
- node_modules와 서명된 portable PG18.7 bundle, OpenSSL/Git DLL을 소유 root로 물리 복사했다. npm 설치·설치 binary/PATH/서비스/인증서 저장소 변경 없음. postgres/initdb/pg_ctl/createdb 모두 **Valid EnterpriseDB 서명**, postgres version18.7. 복사본과 원본 4개 hash가 실행 후에도 동일했다(`binaries-after.json`). postgres 초기 hash도 보존했다.
- 원 SQL3은 새 합성 cluster에 runner가 그대로 적용했다. B5-FIX·Auth/API 서비스·원 SQL·package·기존 fixture·공유 `.next`·사용자 DB/3013·실 DSN/계정·managed/배포는 변경하지 않았다. 저장소에는 본 보고서만 추가한다. 별도 미추적 T157 보고서도 보존했다.

## 이번 독립 실행

```powershell
# 소유 snapshot에서 원 runner 그대로 실행, browser 확인 후 stop 파일로 정상 정리
node tests/t207-cloud-read-ui-http.mjs --bin ../tools/pgsql/bin --openssl ../tools/openssl/openssl.exe --hold
node node_modules/vitest/vitest.mjs run tests/t207-cloud-read-ui.test.ts tests/t200-legacy-page-gate.test.ts tests/t198-legacy-gate.test.ts tests/t183-cloud-pending.test.ts tests/api-auth.test.ts tests/t191-auth-resolver.test.ts tests/t182-auth.test.ts tests/project-get-routes.test.ts tests/postgres/project-read-request.test.ts tests/postgres/project-read-backend.test.ts
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
# 실제 runner의 inner app에서도 별도 tsc / 전체 eslint / verify 실행
node node_modules/eslint/bin/eslint.js .
node scripts/verify-build.mjs
```

| 검증 | 이번 결과 |
|---|---|
| 관련 단위/회귀 | **10 files / 442 PASS**. 새 t207 25건 포함. 기존 Auth/API/legacy 및 request/backend 회귀 유지 |
| 원 runner | exit0, **14 관찰 PASS**. 묶음 관찰 수이며 HTTP 요청 14개라는 뜻이 아님 |
| 운영 build | runner의 격리 inner app `next build` exit0, 두 cloud 경로 동적 |
| verify/type/lint | inner verify-build 0, inner tsc 0, inner eslint 전체 0. outer typegen+tsc 및 관련 source lint도 0 |
| 전역 suite | 요구 범위에 따라 반복하지 않음. 이전 작성자의 전체 suite 수치를 이번 독립 결과로 사용하지 않음 |

## 실제 SDK + Next build/start + PostgreSQL TLS

Auth HTTP provider만 loopback fake다. 페이지의 실제 Supabase SDK/SSR cookie·React cache·request adapter·제한 LOGIN/RLS·실제 PG18.7 경로를 실행했다. E/tls.json에서 API login과 admin 모두 **TLSv1.3 / TLS_AES_256_GCM_SHA384**였다. 이 결과는 운영 Supabase/pooler/TLS CA 검증을 대신하지 않는다.

| 원 runner 관찰 | 독립 확인 |
|---|---|
| A→B→A 목록/상세 | 모두200, 자기 프로젝트 제목만. 목록/상세 getUser 각각 요청당 **2회(proxy1+RSC1)**. layout+page+adapter cache 공유와 다음 요청 재판정 확인 |
| foreign/missing/malformed | A/B/A 각각 세 경우 모두404, 같은 찾을 수 없음 안내, 남의 제목 없음. HTML 전체 byte 동일성을 의미하지 않음 |
| 비로그인 | 목록/상세 proxy307 로그인 이동 |
| proxy 허용 뒤 RSC401 × 목록/상세 | 둘 다 **실제307**, Location `/login?next=%2Fcloud%2Fprojects`, no-store |
| 같은 RSC403 ×2 | 실제307 `/login?error=forbidden`, no-store |
| 같은 RSC503 ×2 | 실제307 `/login?error=unavailable`, no-store |
| 위6건 DB 접근 | 거절 전후 제한 LOGIN의 `pg_stat_activity` PID/state_change/query_start 동일. runner의 query0 assertion 통과. DB 전체 SQL trace나 운영 query 계측으로 확대하지 않음 |
| 손상 snapshot | 목록/상세200 공통 오류 안내, 내부 DB/DSN/SQL 정보 없음. 합성 snapshot 복구 후 상세200 |
| legacy/만료 | legacy `/` 준비 화면 유지. A 토큰 제거 후307, B 목록은 계속200 |
| local | 재시작 후 cloud 목록/상세는 local 안내200, legacy 홈은 준비 화면 아님 |
| 비밀/원문 | 모든 runner 응답에서 합성 server sentinel·API DSN·입력 원문 없음. fake data root 생성 없음 |

T210은 예전의 목록 streaming200 허용 assertion을 제거하고 6건 모두 status307/정확한 Location/no-store/query0를 요구한다. 고정 사본에서 loading/Suspense 경계가 없는 정적 확인과 실제307 결과가 일치했다. Next 내부 metadata용 Suspense까지 0이라는 뜻은 아니며 제품에서 선언한 cloud/상위 loading 경계를 확인한 것이다.

## helper·DTO·경계 독립 점검

- `access()`가 getRenderAuth부터 실행하며 denied/local이면 adapter를 만들지 않는다. lazy `readId`는 인증 및 adapter의 verified UUID/환경 선택 뒤에 실행된다. 관련 시험에서 denied/local params trap·adapter0와 잘못된 verified UUID의 환경/pool 이전 거절을 검증했다.
- 매 verified 화면 호출에서 `createProjectReadRequest({resolveAuth:getRenderAuth})`를 새로 만든다. 모듈 전역 사용자/adapter 저장 없음. 전역 pool은 연결만 재사용하며 actor/DTO를 보관하지 않는다. React cache는 render 범위이고 요청간 계정 전역 cache가 아니다(Next 동봉 authentication guide도 확인).
- 표시 객체는 목록의 id/title/menuLabel/aspect/lengthSec/updatedAt/status/nextStageLabel, 단건의 개요와 stage/label/status만 고른다. owner·inputs·raw row는 UI props로 넘기지 않는다. 단계 label은 snapshot 우선/고정 fallback, 링크는 상세/목록뿐이며 legacy 단계·작성·영상 링크가 없다.
- TypeScript AST로 local value import를 재귀 추적한 **28개 모듈**에서 legacy startup/SQLite connection/StudioLayout/legacy gate/menus-server 경로가 없었다. type-only import는 runtime graph에서 제외했다. runtime 외부 npm 전체까지 분석했다고 주장하지 않는다.
- 원 runner의 data root 미생성만으로 “private I/O0”라고 확대하지 않기 위해, **같은 빌드**의 추가 소유 Next를 fs/SQLite trap preload로 실행했다. 실제 Auth+DB 목록/상세200에서 정적 메뉴 읽기2건만, private runtime fs·SQLite constructor **0**. local 대조 홈에서는 runtime fs trap **8건**으로 관측기가 실제 발동했다. `private-io-results.json`, `private-io.log` 보존. 정의한 소유 DREAM_DATA_ROOT와 SQLite 경계에 대한 증거이며 모든 OS 파일 읽기0은 아니다.
- 원 runner와 동일하게 실제 A/B/A 격리를 확인했다. T202의 별도 동시12건 결과를 이번 cache 증거에 합산하지 않았고, 이번에는 동시 A/B 부하를 추가하지 않았다.

## 브라우저 독립 확인

ego-browser space40의 소유 p1에서 fakeAuth callback으로 A 세션을 발급했다. 실제 제품/실제 계정은 사용하지 않았다. viewport는 1280×900과 390×900, 실휴대폰 검증 아님.

| 화면/조작 | 1280 | 390 |
|---|---|---|
| 정상 목록·상세·남의 것404 | 표시 정상, 가로 넘침0/남의 제목 없음 | 동일 |
| 목록 Tab2→프로젝트 Enter | 상세 이동, solid focus outline | 동일 |
| 상세 fresh navigation Tab2→목록 Enter | 목록 이동, solid outline | 동일 |
| 빈 목록 | 내PC/아직 옮기지 않음 안내, 데이터 링크 없음, 넘침0 | 동일 |
| snapshot 오류 목록·상세 | 공통 안내/다시 시도, 넘침0 | 동일 |
| 오류 Tab2→다시 시도 Enter | 목록으로 이동, solid outline | 동일 |
| 합성 자료 복구 후 | A 목록 복구 표시 | 동일 |

빈 목록은 **자기 합성 project의 archived_at만** 임시 변경했고 오류는 자기 합성 snapshot만 `{}`로 바꾸었다. 원 값을 소유 파일에 보존하고 복원한 뒤 브라우저 복구도 확인했다. 원 fixture/SQL/제품 파일은 바꾸지 않았다. 오류 안내 HTTP200은 Master의 기존 결정이며 실패 HTTP503을 구현했다고 주장하지 않는다.

스크린샷 `list/detail/notfound/empty/error-list/error-detail-{1280,390}.png`, `browser-results.json`, `browser-empty.json`, `browser-error.json`, `browser-recovered.json`을 root에 보존했다. 화면 캡처를 직접 열어 정상/빈목록/오류/404의 시각 상태를 확인했다. 모바일에서 기존 AccountMenu가 email을 숨기는 반응형 동작은 유지되며 로그아웃 accessible name은 A다. 키보드 기본 이동 외 스크린리더·장문 제목/시간대·다수 카드·실기기·저속망 loading UX는 별도 미검증이다.

## 정리·잔존·미검증

- 소유 원 runner PID69580의 Next PID75320(cloud)·78328(local), PG master3832 종료. 추가 private-I/O Next64364/75952 종료. fakeAuth도 runner finally에서 닫았다. PG stop.log `server stopped`, postmaster.pid 없음.
- app65007 / PG64999 / Auth65006 / 추가Next43921 listener0, 소유 root 명령줄의 node/postgres process0 확인. 사용자 **3013 PID51032 유지**. ego-browser space40은 `finish({keep:[]})`로 종료했다.
- 정리 전 소유 root **72,641 files / 2,113,118,743 bytes**. 경계 확인 후 E/app 재귀 삭제를 요청했으나 자동 승인 검토가 **blocked by policy**로 거절했다. 우회하지 않았다. outer snapshot·inner app/격리.next·node_modules·물리 도구·정지한 합성 cluster·합성 자격/증거가 소유 root에 남는다. 실제 비밀은 없지만 대용량 잔존임을 명시한다.
- 최초 사본 Git metadata 준비에서 abbreviated SHA fetch가 실패해 full SHA fetch로 바로잡았다. 제품 변경은 없었다. 브라우저용 합성 자료 controller 한 호출은 잘못된 cwd 때문에 인증서 ENOENT로 DB 연결 전 실패했고, 올바른 소유 snapshot cwd에서 다시 실행했다. 제품 결함으로 집계하지 않았다.
- 실제 managed/Supabase login·Auth FK·pooler·운영 TLS/DSN·B5 deployment·배포/외부 계정은 미검증이며 실행하지 않았다. 클라우드 개통, 데이터 이관, 준비 화면 링크, 전체 디자인 수용도 본 결과에 포함하지 않는다. 원 SQL3/B5-FIX의 별도 수용을 대체하지 않는다.

## Master 전달문

T211은 679e703 고정 사본에서 관련442 PASS·원 TLS PG18.7/SDK fakeAuth HTTP14관찰·격리 build/verify/type/lint 및1280/390 브라우저 정상/빈목록/오류/복구/키보드를 독립 확인하여 bounded PASS입니다. T202 원 FAIL은 유지하고 TEAM0c64d7c의 고정 menus.json 예외만 적용했으며 제품 수정은 없습니다. 소유 Next/PG/Auth/브라우저는 종료했고3013은 보존했으며, 운영 managed/배포는 미검증이고 정책상 삭제 거절된 약2.11GB 소유 사본은 보고 경로에 남았습니다.
