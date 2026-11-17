# T-218 클라우드 새 프로젝트 화면 계약(명세만)

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 상태: **ready_review**(명세)
- 제품 코드·API·쓰기 opt-in·디자인·계정·managed·배포는 바꾸지 않았어요.
- 확인 시각: 2026-11-17, HEAD `2b64bb6` 기준.
- 읽은 것:
  - `app/api/projects/route.ts`(GET 클라우드 읽기 / POST legacy 생성)
  - `components/project-form.tsx`, `app/(studio)/menus/[menuId]/new/page.tsx`
  - `lib/menus/{inputs,snapshot,server}.ts`, `docs/spec/menus.json`, PLAN 18장 P7
  - B12 `lib/services/postgres/project-create.ts`, `lib/repo/postgres/project-create.ts`, `B12-PROJECT-CREATE-POSTGRES.md`(83affcf, 독립 검수 중)
  - 읽기 adapter `project-read-request.ts`, `lib/auth/{api,config,legacy-gate}.ts`

## 0. 먼저 결정이 필요한 것(구현 전 막힘)
**지금 활성(active) 분야는 `shopping-shorts` 하나뿐이고, 이 분야는 `productAssets`(자료, 필수·최소 1개)가 있어야 만들 수 있어요.**
- B12는 링크가 아닌 자료마다 `assetAvailable(asset, actor) === true`를 요구해요.
- 실제 Storage 확인은 아직 구현되지 않았어요(P7-2).
- 클라우드에는 자료 업로드나 자료 목록 화면도 없어요.
- 그래서 **현재 조건으로는 클라우드에서 성공하는 생성이 정직하게 불가능해요.** `assetAvailable`을 true로 우회하거나, 자료 없이 성공처럼 보이게 하면 안 돼요.

선택지(Master·사용자 결정):
1. **(추천) Storage·클라우드 자료 등록(P7-2) 뒤에 생성 화면을 연다.**
   - 그 전에는 명세와 비활성 진입점만 둬요. "클라우드 자료 보관함이 준비되면 만들 수 있어요" 안내만 하고 버튼은 없어요.
2. 자료가 필요 없는 분야를 active로 여는 것은 `menus.json`과 PLAN 결정 사항이에요(플래너·사용자). 이 작업 범위가 아니에요.
3. 링크형 자료로 우회하는 방법은 **불가능해요(확인함).** `shopping-shorts.productAssets`의 accept가 `["image","video"]`라서, B12가 `kind=link` 자료를 형식 불일치로 거절해요.

아래 계약은 1번(Storage 준비 뒤 개통)을 전제로 하되, 자료가 필요 없는 분야가 생기면 그대로 쓸 수 있게 썼어요.

## 1. 경로와 API 전략
| 항목 | 추천 | 이유 |
|---|---|---|
| 화면 | `app/(cloud)/cloud/projects/new/page.tsx`(분야 선택), `app/(cloud)/cloud/projects/new/[menuId]/page.tsx`(입력) | (cloud) 레이아웃·인증 판정을 그대로 써요. legacy `/menus/[menuId]/new`·`/projects/new`는 바꾸지 않아요. 정적 `new`가 `[id]`보다 우선이라 충돌이 없어요. 단건 `[id]`는 `new`를 UUID로 보지 않아 404 동작도 유지돼요. |
| API | **새 `app/api/cloud/projects/route.ts`(POST만)** | 기존 `/api/projects` POST는 SQLite 생성 + `requireApiAuth()` legacy-data 503 계약을 그대로 둬요. 같은 경로에 backend 분기를 넣으면 legacy 계약과 T198 시험 경계가 흐려져요. 쓰기만 따로 inventory에 올려요. |
| 서버 adapter | Backend 담당 `lib/services/postgres/project-create-request.ts`(새) | 읽기 adapter와 같은 모양이에요: 요청마다 생성, resolveAuth 1회, verified actor, 고정 오류, no-store. |

## 2. 서버 처리 순서(API 계약)
1. **인증**: resolver 1회 → 401 `AUTH_REQUIRED` / 403 `AUTH_FORBIDDEN` / 503 `AUTH_UNAVAILABLE`, no-store. local(로그인 꺼짐) → 503 `PROJECT_CREATE_UNAVAILABLE`(SQLite 호출 0).
2. **같은 사이트·JSON**: `rejectCrossSite(request, { json: true })` → 403 `AUTH_ORIGIN_REJECTED` / 415. 인증 다음, 본문 읽기 전이에요.
3. **쓰기 opt-in**:
   - 새 환경값 `DREAM_PROJECT_WRITE_BACKEND=postgres`가 정확히 있고, 읽기 backend도 postgres이고, 연결 설정이 정상일 때만 열려요.
   - 없거나 다르면 503 `PROJECT_CREATE_UNAVAILABLE`이에요(본문을 읽지 않음).
   - 기본값은 닫힘이에요. Vercel env 변경은 별도 결정이에요.
4. **본문**:
   - 크기 상한(추천 64KB, 넘으면 413) 뒤 JSON을 파싱해요.
   - `z.strictObject({ menuId, inputs: record })`만 받아요. `ownerId`·`email`·`snapshot`·`templateVersion`·`id` 같은 추가 키는 400이에요.
5. **분야 snapshot은 서버에서만 만들어요**:
   - 검증된 서버 메뉴 설정(정적 `menus.json`, `getMenuConfigState()` 결과)에서 `snapshotForMenu(config, menu)`로 만들어요.
   - 메뉴가 없거나 active가 아니면 409 `STAGE_LOCKED`(B12와 같음)예요. HTTP에서 snapshot을 받지 않아요.
   - 설정 오류면 503이에요.
6. **생성**:
   - `postgresProjectCreate(pool, { assetAvailable }).create(actor, menuId, inputs, snapshot)`
   - `assetAvailable`은 실제 Storage 확인 구현만 넣어요. 구현 전에는 **항상 false를 돌려주는 거부 정책**만 허용해요(성공 우회 금지).
7. **응답**:
   - 성공 201 `{ id }`, no-store. 이메일·owner·snapshot·inputs는 응답에 넣지 않아요.
   - 실패 시 B12 오류를 그대로 옮겨요.
     - 400 `INVALID_INPUT` + `errors`(필드 id → 한국어 문구, `_form` 포함)
     - 409 `STAGE_LOCKED`
     - 503 `PROJECT_CREATE_UNAVAILABLE`(내부 SQL·Storage 내용 없음)
- legacy 경계는 그대로예요.
  - 클라우드에서 `/api/projects` POST는 계속 503 `LEGACY_DATA_UNAVAILABLE`이에요.
  - legacy 화면은 계속 준비 화면이에요.
  - Postgres 읽기 GET은 바뀌지 않아요.

## 3. 화면 계약
### 3.1 진입점
- 목록 `PageHeader` actions에 "새 프로젝트" 버튼을 둬요.
  - 서버가 쓰기 opt-in이 켜졌다고 판정했을 때만 보여요. 판정 결과는 boolean만 넘기고 env 값은 넘기지 않아요.
  - 꺼져 있으면 버튼이 없고, 보기 전용 안내 문구도 지금 그대로예요.
- 분야 선택(`/cloud/projects/new`)
  - active 분야만 링크로 보여요.
  - 클라우드에서 아직 채울 수 없는 필수 입력(아래 3.3)이 있는 분야는 비활성 카드에 이유를 함께 보여요. 예: "클라우드 자료 보관함이 준비되면 만들 수 있어요." 링크는 없어요.
  - 0장 1번 상태에서는 모든 분야가 비활성이에요.

### 3.2 입력 화면(`/cloud/projects/new/[menuId]`)
- 서버 컴포넌트가 인증 판정을 해요. 기존 `project-read-page` access와 같아요(거절 시 307 로그인, local 시 안내).
- 서버 snapshot(표시용)을 만들어 폼에 넘겨요.
  - 같은 서버 설정을 쓰지만 **제출 때 서버가 다시 만들어요.** 화면이 넘긴 snapshot은 신뢰하지 않아요.
  - 없거나 비활성인 분야는 `notFound()`예요.
- h1 "새 프로젝트" 하나, 설명 "{분야 이름}의 목표와 자료를 알려 주세요."(legacy와 같은 문구)예요.
- 폼은 **새 `components/cloud/project-create-form.tsx`**로 만들어요.
  - 기존 `ProjectForm`은 `/api/projects` 주소, `/projects/{id}/brief` 이동, SQLite `projectChoices`에 묶여 있어서 그대로 쓰지 않아요.
  - 필드 그리기는 같은 규칙(타입별 control, `Field`, `FormErrorSummary`, 기본값 aspect·lengthSec)을 따라요.
  - 공통 렌더러로 뽑아내는 일은 legacy 회귀 범위가 커서 이번 범위에서 빼요.
- owner·이메일 입력 칸은 없어요. 계정은 서버가 인증으로만 정해요.

### 3.3 지원하지 않는 입력
| 타입 | 클라우드 처리 |
|---|---|
| `assets` | Storage·클라우드 자료 목록 전까지 선택 칸 대신 안내만 보여요: "클라우드 자료 보관함은 아직 준비 중이에요. 자료가 필요한 항목은 내 PC 작업실에서 만들어 주세요." 필수 assets가 있는 분야는 진입 자체를 비활성으로 둬요(3.1). 선택(optional) assets는 빈 배열로 보내요. |
| `characters` | 클라우드 캐릭터 목록 API가 없어서 같은 방식이에요. 필수면 진입 비활성, 선택이면 빈 배열과 안내예요. |
| 나머지(text·textarea·select·multiselect·number·checkbox·url·date·datetime) | legacy와 같은 control을 써요. 브라우저 쪽 형식 힌트는 보조일 뿐이고, 최종 판정은 서버 `validateProjectInputs`예요. |

### 3.4 제출·중복·오류
- **중복 제출 막기**:
  - 제출 중에는 버튼을 `loading`·`disabled`로 두고, 같은 폼이 다시 들어오면 무시해요(ref 잠금).
  - 성공해서 이동할 때까지 잠금을 풀지 않아요.
  - Enter 연타·더블클릭에도 요청은 1개예요.
- **서버 쪽 중복**:
  - B12에는 멱등 키가 없어서, 응답을 잃어버린 뒤 다시 보내면 프로젝트가 2개 생길 수 있어요.
  - 그래서 네트워크 오류(fetch 예외)나 응답 파싱 실패 때는 **자동 재시도하지 않아요.** 대신 "저장됐는지 확인하지 못했어요. 내 프로젝트 목록에서 먼저 확인해 주세요."와 목록 링크를 보여요.
  - 멱등 키(예: 클라이언트 UUID 헤더 + 고유 제약)는 Backend 스키마 결정이 필요해서 별도 항목으로 남겨요.
- **오류 표시**:
  - 400 `errors` → 필드별 오류와 위쪽 요약(`FormErrorSummary`), 요약으로 포커스를 옮겨요. `_form`은 요약 첫 줄이에요.
  - 409 → "이 분야는 아직 만들 수 없어요."
  - 401 → `/login?next=현재 경로`로 전체 이동. 입력값은 저장하지 않아요(민감 입력 보존 금지).
  - 403 `AUTH_FORBIDDEN` → `/login?error=forbidden`
  - 403 `AUTH_ORIGIN_REJECTED`·415 → "화면을 새로 고친 뒤 다시 시도해 주세요."
  - 413 → "입력 내용이 너무 길어요."
  - 503 → "지금은 저장할 수 없어요. 잠시 뒤 다시 시도해 주세요."(내부 정보 없음)
  - 성공으로 보이는 토스트는 201을 받은 뒤에만 띄워요.
- **성공 뒤 이동**:
  - 201 `{id}`를 받으면 `window.location.assign('/cloud/projects/{id}')`로 전체 이동해요. 이전 폼과 router cache를 남기지 않고, 서버 조회로 다시 확인하려는 거예요.
  - 목록에서도 바로 보여야 해요. 읽기 GET은 캐시하지 않아요.
  - 클라우드에는 brief 단계 화면이 없어서 legacy처럼 `/brief`로 보내지 않아요.
- 탭 세션(T-213): 폼에 AccountMenu 감시가 그대로 적용돼요. 다른 탭에서 계정이 바뀌면 다시 받기로 폼이 초기화돼요(입력 유실은 의도된 동작이고 안내 대상이에요).

## 4. 예정 파일(구현 배정 때 확정)
| 담당 | 파일 |
|---|---|
| Backend | `lib/services/postgres/project-create-request.ts`(adapter), 쓰기 opt-in 판정(`project-read-backend`와 비슷한 select 함수), 거부 기본 `assetAvailable` 정책, adapter 시험·실제 PG 통합 |
| API(Backend 또는 Front, Master 지정) | `app/api/cloud/projects/route.ts`(POST), `tests/api-auth.test.ts`·`tests/t198-legacy-gate.test.ts` inventory 등록(auth·non-legacy 경로로) |
| Front | `app/(cloud)/cloud/projects/new/page.tsx`, `app/(cloud)/cloud/projects/new/[menuId]/page.tsx`, `components/cloud/project-create-form.tsx`, `components/cloud/project-list-readonly.tsx`(목록 진입 버튼만), `lib/cloud/project-read-page.ts`(쓰기 가능 boolean만), `tests/t2xx-cloud-create-ui.test.ts`, `tests/t2xx-cloud-create-http.mjs`(t207 검증기 기반) |
| 바꾸지 않음 | legacy `ProjectForm`·`/api/projects` POST·`lib/services/projects.ts`, B12 서비스 본문, auth resolver·proxy, session 코드(T-216), `menus.json`·PLAN |

## 5. 구현 전 의존성
1. B12 독립 검수 PASS(진행 중)와 지적 사항 반영
2. **0장 결정**: Storage(P7-2) 실제 `assetAvailable`, 또는 자료가 필요 없는 active 분야
3. 쓰기 opt-in 환경값 이름·기본 닫힘 승인, 운영 DB 쓰기 권한(dream_api INSERT·RLS), DEC-SSL-01
4. 생성 adapter·API 담당 지정, 중복 생성(멱등 키) 정책 결정
5. T-216 세션 재검수 결과(필수 결함이 있으면 먼저 처리)
6. 클라우드 자료·캐릭터 목록 API(선택 입력 지원 범위를 정함)

## 6. 검증 matrix(구현 뒤, 합성 PG TLS + fake Auth + 운영 build·start)
| # | 경우 | 기대 |
|---|---|---|
| C1 | 쓰기 opt-in 꺼짐 | API 503 `PROJECT_CREATE_UNAVAILABLE`, 본문 미읽기, PG 쿼리 0. 목록에 "새 프로젝트" 없음. `/cloud/projects/new`는 안내만 |
| C2 | 비로그인·허용 밖·Auth 오류 | API 401/403/503 no-store. 화면은 307 로그인(T-210 방식, loading 경계 없음) |
| C3 | 다른 사이트 Origin·JSON 아님·64KB 초과 | 403·415·413, PG 쿼리 0 |
| C4 | 추가 키(ownerId·email·snapshot) | 400, 행 0 |
| C5 | 필수 누락·형식 오류·없는 분야 키 | 400 필드 errors, 행 0. 화면 요약 포커스·필드 오류 |
| C6 | 없는·비활성 분야 | 409 / 화면 404 |
| C7 | 정상 생성 A | 201 UUIDv7. 7단계·snapshot·inputs 원문(B12 계약). 상세 200으로 바로 이동. 목록에 표시 |
| C8 | A가 만든 것을 B로 조회 | B 목록에 없음, 단건 404. B 생성은 B 소유 |
| C9 | 다른 사람·없는·보관된 자료 id 주입 | 400 같은 문구 |
| C10 | `assetAvailable` 거부 정책(구현 전) | 자료가 필요한 생성은 400·실패 표시, **성공 표시 0** |
| C11 | 더블클릭·Enter 연타 | 요청 1개, 행 1개 |
| C12 | 커밋 뒤 응답 유실(서버가 응답 전 연결을 끊는 합성 상황) | "저장됐는지 확인하지 못했어요" + 목록 링크, 자동 재시도 0 |
| C13 | 렌더와 제출 사이 로그인 만료 | API 401 → 로그인 이동. 다른 탭 계정 변경은 T-213 다시 받기 |
| C14 | DB 실패(합성 연결 끊김) | 503 고정 문구, 행 0(롤백) |
| C15 | legacy 경계 | 클라우드 `/api/projects` POST 503 `LEGACY_DATA_UNAVAILABLE`. legacy 화면은 준비 화면. `DREAM_DATA_ROOT` 미생성 |
| C16 | 화면 1280·390 | h1 하나, 넘침 0. Tab으로 모든 입력→제출, 오류 요약 포커스, 비활성 분야 이유 읽힘 |
| C17 | local(로그인 꺼짐) | 클라우드 생성 화면은 안내만, API 503, SQLite 0 |

## 7. 남는 위험
- 멱등 키가 없으면 응답 유실 뒤 사용자가 다시 제출해 중복이 생길 수 있어요. 화면 안내로 줄일 뿐, 막지는 못해요.
- 감사 기록 actor가 `local-user`로 남아요(B12가 기존 표기를 유지). 클라우드 감사 표기 정책은 별도예요.
- 서버 메뉴 설정은 프로세스 메모리에 한 번 읽어 두는 값이에요(T-210 정정). 메뉴를 바꾸면 서버를 다시 시작해야 반영돼요.
