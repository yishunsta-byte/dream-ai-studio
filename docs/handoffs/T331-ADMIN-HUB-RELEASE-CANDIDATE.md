# T331 관리자 메뉴 운영 반영 최소 후보 검증

2026-11-19 · Codex(Front)
- 배정: Master `msg_82d9d8946e0a`
- 저장소 기록: 이 문서 하나

## 고정 기준

| 구분 | 커밋 |
|---|---|
| 운영 추적 기준 | `ad82944b0eef492290fec7d5c68104e5d114e892` (style(admin): apply NEON SCREEN cinema login) |
| 메뉴 변경(T329, T329-R 통과) | `e990c777be2f9c500d6bc876d092af059177587d` |
| 관계 | `ad82944`는 `e990c77`의 조상이고, 사이에 커밋 233개가 있어요. 전체 차이는 359개 파일, +43,822 / −141줄이에요. |

## 결론 (먼저 보고)

**메뉴 변경만으로는 최소 후보가 성립하지 않아요.**

T329는 `app/admin/page.tsx`·`components/admin/admin-hub.tsx`·`admin.module.css` 세 파일을 바꿔요. 그런데 새 메뉴 4개 가운데 두 개가 운영 기준에 없는 기능을 담아요.
- **내 프로젝트:** T283 `admin-projects`
- **완성본 검수·게시:** T297 게시 큐·API와 T325~T327 게시 공급원 조립·런타임

그래서 `e990c77`의 관리자 화면을 그대로 내보내려면 아래 **코드 21개**가 함께 필요해요. 이 범위는 import를 추적해서 계산했어요.
- `app/admin/page.tsx`에서 시작
- 큐 화면이 부르는 `app/api/admin/publications/route.ts` 포함
- 운영 기준에 이미 같은 내용으로 있는 35개 파일 제외

이 범위는 '메뉴 정리'보다 '관리자 게시 기능 첫 반영'에 가까워요. 반영 범위는 Master 판단이 필요해요.

## 후보 구성 (코드 21개 + 시험 인벤토리 2개 조정)

**`e990c77`에서 바뀐 파일 3개:**
- `app/admin/page.tsx`
- `components/admin/admin-hub.tsx`
- `components/admin/admin.module.css`

**운영 기준에 없는 파일 18개:**
- 관리자 게시 API: `app/api/admin/publications/route.ts`
- 프로젝트 목록: `components/admin/admin-projects.tsx`
- 게시 큐 화면: `components/admin/publication-{http-queue.tsx,queue.tsx,queue.module.css,model.ts,provider.ts,http-provider.ts}`
- `lib/public-showcase/` 아래 11개:
  - `admin-publication-http.ts`, `admin-publication-service.ts`
  - `publication-runtime.ts`, `publication-runtime-config.ts`, `publication-provider-assembly.ts`, `publication-showcase-connection.ts`
  - `cover-path.ts`, `cover-source.ts`, `showcase-source.ts`, `published-works.ts`

**규모와 해시:**
- 21개 파일, +1,902 / −33줄이에요.
- `git diff ad82944 e990c77 -- <21개>` 패치 sha256 앞 16자리는 `d3da478ad5b75fc1`(2,094줄)이에요.
- 격리 사본에 적용한 뒤 21개 모두 `e990c77`과 내용이 같아요(줄 끝만 다름).

**일부러 뺀 것:**
- `proxy.ts`의 T-254 공개 표지 405 처리: 표지 라우트를 반영하지 않아서 필요 없어요.
- `admin-local-notice.tsx`의 T-255-F1 공개 홈 링크 변경: 메뉴와 상관없어요.
- `lib/auth/config.ts`: 기준과 같아서 바꿀 필요가 없어요.

**시험만 조정이 필요해요.** `tests/api-auth.test.ts`와 `tests/t198-legacy-gate.test.ts`의 라우트 인벤토리에 새 API를 등록해야 해요.
- 그런데 `e990c77` 판은 T296 `studio/reference-analysis` 경로도 함께 적고 있어요. 그 경로가 후보에 없어서 그대로 쓰면 실패해요.
- `e990c77` 판에서 T296 두 줄만 지워야 통과해요. 아래 줄이 그 두 줄이에요.
  - api-auth 132줄: `"studio/reference-analysis",`
  - t198 99줄: `"../app/api/studio/reference-analysis/route.ts": ["POST"]`
- 이렇게 조정한 판은 어느 커밋에도 없는 새 내용이에요. 반영하려면 별도 커밋이 필요해요.

## 검증 (격리 사본, 합성 데이터)

**사본 준비:**
- `git archive ad82944`를 임시 폴더에 풀고, 21개 파일 패치를 `git apply`로 적용했어요.
- `node_modules`는 robocopy로 복사했어요(패키지 파일은 기준과 HEAD가 같음).

**정적 검사 (인증 패치 전, 실제 코드 그대로):**
- `tsc --noEmit`(생성 `.next` 제외): 오류 0
- 21개 중 코드 파일 ESLint: 통과

**시험 (`e990c77` 시험 파일을 사본에 복사):**

| 시험 | 결과 |
|---|---|
| `tests/admin` 7개 파일: T329 정보 구조, 게시 HTTP, 큐 5종 | 102 통과 |
| 위 + `t220` 세션 보호, `t243` 관리자 로그인, `t283` 관리자 프로젝트 | 10개 파일, 141 통과 |
| 전체, 인벤토리 조정 전 | 25 실패. 새 API가 인벤토리에 없어서 `api-auth` 1·`t198` 4, 나머지는 ffmpeg 20 |
| 전체, `e990c77` 인벤토리 그대로 | 22 실패. T296 경로가 없어서 `api-auth` 1·`t198` 1, 나머지는 ffmpeg 20 |
| 전체, T296 두 줄 삭제 판 | 2,090 통과 · 406 건너뜀 · **20 실패, 모두 `spawnSync ffmpeg ENOENT`** |

ffmpeg 실패는 사본에 `.tools`를 넣지 않아서 생겼어요(자막 측정·오디오 5개 파일). 후보 코드와는 상관없어요.

**운영 빌드와 로컬 HTTP:**
- `npm run build` 성공. `/admin`, `/admin/login`, `/api/admin/publications`가 동적 라우트로 만들어졌어요.
- `next start -H 127.0.0.1 -p 3331`로 실행했어요.
- 인증은 사본 전용 패치로 대신했어요(커밋 안 함). `lib/auth/render.ts`와 `resolveServerAuth`가 쿠키 `t331-auth` = verified·local·401·403·503에 따라 합성 결과를 돌려줘요. 합성 계정은 `operator@example.invalid`예요.
- 로그인 모드가 꺼진 로컬 실행이라 `proxy.ts`의 Supabase 단계는 거치지 않았어요. 아래는 페이지와 API의 자체 판정이에요.

| 요청 | 결과 |
|---|---|
| `/admin` 로컬 | 200, '이 PC에서 작업하려면 작업실을 쓰세요' 안내. 메뉴·계정 없음 |
| `/admin` 401 / 403 / 503 | 307 → `/admin/login?next=%2Fadmin` / `?error=forbidden` / `?error=unavailable`. 메뉴·계정 없음 |
| `/admin` 확인 계정 | 200, `cache-control: private, no-cache, no-store, max-age=0, must-revalidate` |
| └ 메뉴 4개 | `#admin-overview 개요`, `#admin-project-list 내 프로젝트`, `#admin-review 완성본 검수·게시`, `#admin-account 계정 설정`. 대상 영역 4개 모두 있음 |
| └ 기존 운영 항목 | '개인 관리'(`/cloud/manage`), '내 프로젝트'(`/cloud/projects`: 프로젝트 읽기 미연결이라 보임), '비밀번호 바꾸기'(`/account/password`), 로그인 계정 이메일 표시 |
| └ 미연결 안내 | '운영 연결 범위' 6개(작업 대기열·자료 관리·백업·복원·운영 로그·회원 관리·서비스 상태)에 '미연결' 표시. 기존 '회원 관리'·'서비스 상태' 포함. 프로젝트 영역은 미연결 안내, 검수 영역은 '게시 서버 미연결' |
| `GET /api/admin/publications` 확인 계정 | 200 `no-store` `{"kind":"closed"}` |
| `POST` 확인 계정(합성 준비 요청, Origin·JSON) | 503 `no-store` `PUBLICATION_UNLINKED`. 저장소 미연결이라 처리하지 않음 |
| `GET` 401 / 403 / `POST` 401 | 401 `AUTH_REQUIRED` / 403 `AUTH_FORBIDDEN` / 401 |
| `GET` 로컬 | 503 `PUBLICATION_UNLINKED` |
| `/admin/login` | 200 |

**호환성:**
- 게시 런타임은 `loadPublicationRuntimeOptions()`가 `undefined`라서 조립이 비활성이에요. 운영 반영 시 DB 연결·쓰기 경로가 열리지 않아요.
- 프로젝트 목록은 `DREAM_PROJECT_READ_BACKEND=postgres`일 때만 읽고, 아니면 미연결이에요.
- `admin.module.css`는 `e990c77` 판으로 바꿔도 기존 사용처 `admin-local-notice`의 `admin.link`가 남아 있어요.
- `lib/auth/config.ts`는 기준과 같아요. 새 API는 `/admin` 경로가 아니라서, 운영 프록시에서는 기존 API와 같은 로그인·허용 이메일 판정을 거쳐요.

## 정리 근거

- 서버를 멈췄어요. 3331 포트 대기는 0이에요.
- 격리 사본은 재분석 지점을 먼저 지우고 폴더째 삭제했어요(없음 확인).
- 저장소 `node_modules`는 283개 그대로이고, 작업 트리의 `app`·`components`·`lib`·`tests` 변경은 0이에요.
- push·배포, 운영 상태·계정 변경, 공유 `.next` 변경은 없어요.

## 판단이 필요한 점

1. 반영 범위를 정해야 해요. 둘 중 하나예요.
   - (가) 위 21개 + 인벤토리 2개 조정으로 '관리자 메뉴 + 게시 큐(미연결 상태)'를 함께 내보내기
   - (나) 운영 기준 메뉴를 4개 구조로만 바꾼 별도 축소판 만들기. 검수·게시는 미연결 안내만 두고, 프로젝트는 기존 링크를 써요. (나)는 새 코드라서 별도 배정과 검수가 필요해요.
2. (가)를 고르면 인벤토리 시험 조정을 어느 브랜치·커밋에 둘지 정해야 해요. 지금 `master`의 판은 T296 경로를 포함하고 있어요.
