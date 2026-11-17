# T-202 Legacy page gate 독립 검수

- 판정: **FAIL — F202-1(root layout의 정적 메뉴 로더 선행 실행)**. 14개 업무 페이지와 StudioLayout의 사용자 저장소 차단은 통과했다. 이 실패를 사용자 DB 노출로 해석하지 않는다.
- 검수자: CX-MASTER-01 배정 독립 작업자. T200 구현자의 자체 검증과 이번 독립 재실행을 구분한다.
- 고정 기준: `1343c10ecd0d6c03307c2dd8b5825424f81f1295`(T200). `docs/handoffs/T-200-LEGACY-PAGE-GATE.md` 전문 및 변경 21개 파일, auth/render·legacy-gate·root/group layout·제외 경로를 검토했다. T199 수용은 본 검수와 별개다.
- 허용 범위: 이 보고서와 소유 사본의 독립 테스트·관측 harness만 작성. 제품 수정, fixture 변경, API/SQL/managed 연결/배포는 하지 않았다.

## F202-1 재현과 범위

`app/layout.tsx:20`의 `RootLayout`은 auth 또는 legacy 판정 없이 `getMenuConfigState()`를 호출한다. `lib/menus/server.ts:12`는 cold module state에서 `docs/spec/menus.json`을 동기 읽는다. StudioLayout의 선행 guard가 root 호출까지 보호하지 않는다. 요구된 “공용 layout에서 auth→legacy gate가 menu/files보다 먼저” 조건은 root까지 적용하면 미충족이다.

독립 테스트 `tests/reviewer-root-boundary.test.ts`를 소유 사본에 만들었다. VERCEL=1, root의 메뉴 로더 spy 및 render auth spy로 RootLayout을 직접 호출하면 **auth 0회, 메뉴 1회**다. 메뉴 0회를 요구하는 assertion이 실제 실패했다(1 file / 1 FAIL, setup 오류 아님). 최소 핵심 재현:

```ts
vi.mock('@/lib/menus/server', () => ({ getMenuConfigState: menus }));
// menus = vi.fn(() => ({ ok: true })); auth = vi.fn()
vi.mock('@/lib/auth/render', () => ({ getRenderAuth: auth }));
vi.stubEnv('VERCEL', '1');
RootLayout({ children: null });
expect(auth).not.toHaveBeenCalled(); // 실제 0
expect(menus).not.toHaveBeenCalled(); // FAIL, 실제 1
```

실제 운영 빌드 HTTP에서도 fs preload로 **허용한 정적 메뉴 읽기**를 기록했다. cold `/settings`에서 proxy의 첫 getUser는 허용하고 RSC getUser는 합성 provider 503으로 바꾸었다. 관측 순서는 proxy auth-user(epoch ms `1794911030283`) → 정적 메뉴 readFileSync(`1794911030387`) → RSC auth-user(`1794911030423`)였다. 최종 응답은 307 `/login?error=unavailable`, Pending/계정 표시는 없었다. 즉 인증 거절 자체는 정상이나 메뉴 선행 호출은 실제다. 각 fresh Next process에는 총 정적 메뉴 readFileSync 2건이 있었으며, 그 중 1건은 RSC 이전 서버 준비 중에도 관측됐다. 모든 읽기의 원인을 root 하나로 단정하지 않는다.

이 파일은 배포된 **정적 앱 설정**이며 개인 저장소가 아니다. private SQLite/사용자 runtime 경로 접근은 blocked 모드에서 0이었다. T200 보고서의 메뉴 0 주장은 페이지/StudioLayout 단독 mock 시험 범위에서는 재현됐지만 root 전체에 확대할 수 없다. Front에 root 경계를 반환한다. public login을 무조건 auth gate로 감싸면 되는 것으로 처방하지 않는다. 정적 공용 설정을 예외로 인정하려면 Master가 이 요구 범위를 명시적으로 좁힌 뒤 bounded PASS 여부를 다시 판단해야 한다.

## 통과한 범위

| 검증 | 이번 독립 결과 |
|---|---|
| 페이지 inventory | studio 13 + workspace 1, 총 14개 모두 첫 두 문장이 guard/blocked return. 동적 params·history searchParams·loader·redirect보다 앞섬 |
| 공용 업무 layout | 양쪽 group layout이 StudioLayout 재사용. guard 후 getMenuConfig/checkStartup/currentAccountEmail. root 누락은 위 FAIL로 별도 기록 |
| 제외 경로 | login/auth 전용 password, production notFound인 dev/ui 확인. root는 이들에도 공통 적용. 공개 auth 3경로/password 자체 기능을 새로 수용한 것으로 주장하지 않음 |
| 새/관련 단위 시험 | 8 files **381 PASS**. 그 중 새 t200 **117 PASS**. 직접 페이지별 params trap/서비스·startup·menu·SQLite spy 및 local 진행 대조 포함 |
| HTTP VERCEL=1 | 14/14 경로 200 Pending + A 계정, private runtime/SQLite 접근 0 |
| HTTP postgres, DSN 없음 | 14/14 같은 결과, fallback 없음 |
| HTTP unknown backend | 14/14 같은 결과, fallback 없음 |
| 인증 우선순위 실제 RSC | proxy 통과 후 RSC 401→307 /login, 403→307 ?error=forbidden, 503→307 ?error=unavailable. 익명→307 /login?next=%2Fsettings. API의 HTTP 401/403/503 응답과 RSC redirect를 혼동하지 않음 |
| React render cache | 세 모드 각 일반 페이지 요청마다 auth `/user` **2회**(proxy 1 + RSC 1). layout+page에서 따로 추가 검증하지 않음. React cache 원본 유지도 확인 |
| 요청간 사용자 분리 | 세 모드 각 B→A 다음 요청 및 동시 A/B 12개씩 검사. 각각 자기 email만, 반대 email 없음. 동시 묶음 각각 `/user` 24회. 총 동시 HTTP 36건 |
| auth off + postgres | 200 Pending, email 없음, getUser 0, private 접근 0 |
| local default | /settings Pending 아님, getUser 0. 원래 startup의 소유 runtime 경로 검사 8건이 negative trap에 도달함. 단위 시험은 14개 모두 원래 loader/params/redirect 진행 대조 통과 |
| 격리 검증 | next build 0 → verify-build 0, next typegen + tsc --noEmit 0, eslint . 0 |

HTTP harness는 기록 60개 요청과 별도 동시 요청 36개, **96개 응답**을 검증했다(준비 OPTIONS polling 제외). fakeAuth는 실제 Supabase SDK가 loopback 합성 verify/getUser endpoint를 호출하도록 구성했으며 가짜 resolver 반환만으로 대체하지 않았다. 최초 harness에서 시각이 바뀌면 합성 JWT 문자열 비교가 B를 A로 오인하는 관측기 오류가 있었다. JWT payload email 판별로 harness만 고쳐 fresh process/새 event log에서 전부 다시 실행했다. 이를 제품 실패로 집계하지 않았다.

## 실행 명령과 증거

소유 root:
`C:/Users/Administrator/AppData/Local/Temp/t202-page-review-d5c951d667934f9cadce622a1236406d`

`git archive 1343c10`로 `app/`을 만들고 소유 이전 검수 사본의 node_modules를 물리 복사했다. 설치 명령/공유 node_modules 수정 없음. `source-identity.json`에서 T200 변경 21개 파일을 Git blob hash로 비교하여 **21/21 동일**. 검토한 파일을 임의 수정하거나 archive 줄끝 차이를 숨기지 않았다. 독립 테스트는 이후 tests 아래에만 추가했다. 저장소 작업 트리의 제품 파일은 건드리지 않았다.

```powershell
node node_modules/vitest/vitest.mjs run tests/t200-legacy-page-gate.test.ts tests/t183-cloud-pending.test.ts tests/t180-a1-settings-data.test.ts tests/t198-legacy-gate.test.ts tests/api-auth.test.ts tests/t191-auth-resolver.test.ts tests/t182-auth.test.ts tests/project-get-routes.test.ts
node node_modules/vitest/vitest.mjs run tests/reviewer-root-boundary.test.ts
node node_modules/next/dist/bin/next build
node scripts/verify-build.mjs
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
# 소유 root에서, 소유 app의 빌드를 실행하는 loopback harness
node runtime-check.mjs
```

증거는 root의 `related.log`, `root-boundary.log`, `build.log`, `type.log`, `lint.log`, `runtime.log`(HTTP_ASSERTIONS_PASS/OWN_AUTH_CLOSED), `runtime-results.json`, `page-audit.json`, `source-identity.json`, `*-events.jsonl`, `*-server.log`, `negative-preload.cjs`, `runtime-check.mjs`에 남았다. private negative control은 DREAM_DATA_ROOT 하위 fs 호출/SQLite constructor를 기록하고 throw한다. cloud modes에서 0이고 local에서 실제 8회 발동했으므로 비활성 관측기의 0을 PASS로 삼지 않았다. 정적 menus.json은 별도 종류로 기록하고 허용했으며 0이라고 숨기지 않았다.

Next 동봉 `node_modules/next/dist/docs/01-app/02-guides/authentication.md` 및 관련 layout/render 구조를 참조했다. 외부 Next 버전 지식으로 제품을 수정하지 않았다.

## 미검증과 수용 경계

- 실제 Supabase 계정·managed DB·실 DSN·TLS·배포/Vercel은 미검증. public synthetic URL/key와 합성 email/cookie만 사용했다.
- local default의 실제 건강한 DB CRUD/기존 사용자 DB는 열지 않았다. HTTP에서는 startup 도달 대조, 정상 local loader 선택은 단위 시험 범위다.
- raw HTTP는 RSC 서버 렌더/계정 격리 증거다. 브라우저 client navigation/prefetch/layout 재사용까지 확인한 것으로 확대하지 않는다.
- B4-G RSC 통합이나 B4-I-R 재수용은 본 task가 아니다.
- T200 전체 suite의 **13건 t162/t166 ZIP 실패**는 작성자 보고이며 이번에 재실행·원인 확인하지 않았다. 별도 조사 배정 범위로 남긴다. 전체 통과/독립 baseline 확인이라고 표현하지 않는다.

## 정리와 보존

최종 성공 harness의 소유 Next PID: Vercel 69704, postgres 51680, unknown 2780, authoff-postgres 70732, local-default 79096. 각 child를 finally에서 종료하고 fakeAuth도 close했다. 소유 포트 43911/43912 listener 없음, 소유 root를 명령줄에 포함한 node process 없음 확인. 초기 harness의 child도 finally 종료했다. 사용자 **3013 PID 51032 유지** 확인했다. 브라우저를 열지 않았다.

공유 .next/사용자 DB/실 DSN/기존 fixtures/설치 도구·패키지·배포 환경/공용 대장은 변경하지 않았다. 기존 미추적 T-157 보고서는 보존했다.

정리 직전 소유 root는 **35,115 files / 959,520,101 bytes**였다. 경계를 확인하는 `Remove-Item -LiteralPath <owned-root>/app -Recurse -Force` 요청을 자동 승인 검토가 **blocked by policy**로 거절했다. 우회하지 않았다. 따라서 app(물리 node_modules·격리 .next·source·독립 테스트)과 root 증거가 해당 임시 경로에 남는다. 자동 삭제 성공이라고 주장하지 않는다.

## Master 전달문

T202는 1343c10 고정 사본에서 관련 381 tests·build/verify/type/lint 및 실제 fakeAuth HTTP를 독립 실행했습니다. 14페이지/StudioLayout의 legacy 데이터 차단과 요청간 계정 분리는 통과했지만 root layout의 정적 메뉴 읽기가 RSC auth보다 선행하는 F202-1 때문에 요구 범위 전체는 FAIL입니다. Front 수정 또는 정적 설정 예외 범위 결정이 필요하며, ZIP 13실패·managed/배포·브라우저 navigation은 별도 미검증이고 정책상 삭제 거절된 소유 임시 사본은 보고 경로에 남았습니다.
