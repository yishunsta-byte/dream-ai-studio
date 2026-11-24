# T369 공개 홈 실작품 연결 준비 후보

2026-11-19 · Codex(Front)
- 배정: Master `msg_1f9db4a5f8fb`(주인님 직접 지시 후속), 추가 의존성 승인 `msg_84a79ac56752`
- 범위: 로컬 후보 ref만 고정했어요. push·배포·운영 설정 변경은 없어요. 공용 작업본, T368 파일, 저장 데이터는 건드리지 않았어요.

## 결론

- 후보 `release/public-showcase-activation-ready-20261119` = `85083491a503f545c37e85fc0606e2950b9ce9df`예요.
  - 부모는 `2511a1e`(r2)이고, 그 부모가 원격 `3c57eff`예요.
  - 빨리감기로 올릴 수 있어요.
- 이 후보는 다음 셋만 모았어요:
  - 공개 홈의 목록 공급원 연결(T-251)
  - 철회 가드(T-255-F1~F3)
  - 공개 표지 경로(T-254)
- **운영 동작은 바뀌지 않아요.** `SHOWCASE_SOURCE = { mode: "sample" }`·`COVER_SOURCE = { mode: "inactive" }`는 원격과 같아요. 홈은 지금처럼 소개 작품 6개를 보여 주고, 표지 주소는 404예요.
- 실제 전환(공급원 활성)은 이 후보에 들어 있지 않아요. 아래 '배포 전 조건'이 갖춰진 뒤 별도 작업이에요.

## 1. 후보 정보

| 항목 | 값 |
|---|---|
| 커밋 | `85083491a503f545c37e85fc0606e2950b9ce9df` |
| 트리 | `15e84d9708cdca0935cbc86593c672a3908a9f1c` |
| 기준 | r2 `2511a1e5448dcac5f15b8ffd4f0e29d816119f53`(T363-R2-R 통과) → 원격 `3c57eff6724886d104faab1937059579647e5ffb` |
| 변경 | 20경로, +1,923 / −23 |
| 내용 출처 | 20경로 모두 로컬 master `HEAD`의 파일과 바이트 단위로 같아요 |
| 비밀값 검사 | 후보 diff 0건 |

## 2. 경로(20)

**실행 코드(9)**
- `app/(public)/page.tsx`: 공급원 → feed → 상태별 화면, 가드
- `app/media/public/[slug]/[generation]/[file]/route.ts`: 표지 GET·HEAD, 그 밖 405
- `components/public-showcase/neon-showcase.tsx`: 가드 설치 효과, 공개 홈 링크를 새 문서 이동으로
- `components/public-showcase/showcase-guard.tsx`: 인라인 가드, hidden 승인 영역, 대체 안내
- `components/admin/admin-local-notice.tsx`: '공개 메인으로'를 새 문서 이동으로(T-255-F1의 같은 커밋 `c4afb29` 변경)
- `lib/public-showcase/showcase-feed.ts`
- `lib/public-showcase/showcase-guard-runtime.ts`
- `proxy.ts`: 공개 표지 주소를 인증 전에 처리, 그 밖 메서드 405
- `next.config.ts`: 공개 표지 주소를 이미지 최적화에서 제외

**시험(11)**
- `tests/public-showcase/` 아래 9개:
  - `cover-path`, `cover-route`
  - `home-navigation`, `neon-showcase`
  - `publication-provider-assembly`, `publication-runtime`, `publication-showcase-connection`
  - `published-works`, `showcase-feed`
- `tests/t241-public-home-route.test.ts`
- 시험 고정 자료 `tests/fixtures/postgres/t253-showcase-publication.sql`: `cover-path.test.ts`가 읽어요

## 3. 범위 판단

**승인받았지만 넣지 않은 4경로**
- 대상:
  - `lib/db/postgres/publication/delegated/{probe.ts, catalog.ts, 0001_delegated.sql}`
  - `lib/storage/supabase/config.ts`(18340be)
- 제외 이유: 이 넷을 쓰는 모듈(`publication-sealed-runtime`, `publication-server-config`, `publication-verified-adapters`, `publication-cover-storage`, `publication-db-preflight`)을 실행 경로가 import하지 않아요. 로컬 master에서도 앱·라우트·proxy 어디서도 부르지 않아요.
- 그래서 '기존 승인 구현을 보존하는 필요한 변경'에 들지 않아 후보에서 뺐어요.
- 결과적으로 다음은 원격 그대로예요:
  - SQL 파일이 후보 빌드에 들어가는지의 문제
  - `privateStorageConfig` 회귀 문제
  - 공용 저장소 설정 변경

**이미 원격에 있어서 그대로 둔 것**
- 아래 실행 경로 모듈은 r2와 로컬 HEAD가 같아요:
  - `publication-runtime.ts`, `showcase-source.ts`, `published-works.ts`, `cover-source.ts`, `cover-path.ts`
- 그 밖에 runtime-config·provider-assembly도 r2에 이미 있어요.

**빼 둔 시험**
- `.pg17.ts`·`native`·`.mjs`·`.sql` 하네스는 vitest 밖이라 뺐어요.
- 빠진 모듈을 직접 시험하는 `.test.ts` 3개도 뺐어요: `admin-publication-service`, `publication-cover-storage`, `publication-public-reader`.

**추가 의존성 1건(보고 대상)**
- `components/admin/admin-local-notice.tsx`
- 이유: `home-navigation.test.ts`는 "앱 어디에도 공개 홈으로 가는 next/link가 없다"를 확인해요. r2의 이 파일에 `<Link href="/">`가 남아 있어서 시험이 실패했어요.
- T-255-F1 커밋 `c4afb29`의 같은 변경(+3/−1, 일반 `<a>`)을 넣었어요.

## 4. 검증(격리 사본, 공용 작업본·`.next`·3013 미사용)

| 항목 | 결과 |
|---|---|
| 사본 | r2 `git archive` + 20경로를 HEAD에서 복사 + `node_modules`(283)·ffmpeg 사본 |
| 형식 검사 `tsc --noEmit` | 오류 0 |
| 문법 검사 eslint(변경 폴더) | 통과 |
| 집중 시험(공개 홈 10파일) | 첫 실행 1건 실패(3절 추가 의존성) → 보완 뒤 전체로 다시 확인 |
| 전체 시험 vitest | **121 파일 통과 / 10 건너뜀, 2,285건 통과 / 319 건너뜀, 실패 0** |
| 빌드 `npm run build` | 통과. `ƒ /`, `ƒ /media/public/[slug]/[generation]/[file]` |
| 실행 확인(127.0.0.1:3471, production) | 홈 200, 화면 '예시' 0, 소개 작품 상태라 hidden 승인 영역 없음 |
| 표지 주소(비활성) | GET 404, HEAD 404, POST 405, 쿼리 붙은 주소 404. `cache-control: no-store`, `nosniff` |
| 관리자 로그인 | `/admin/login` 200 |
| DB 연결 | 서버 실행 중 5432·6543 연결 0. sample 기본에서는 연결·설치가 일어나지 않아요 |
| 정리 | 서버 종료, 3471 대기 0 |

## 5. 배포 전 조건(실제 전환까지)

| # | 조건 | 담당 |
|---|---|---|
| 1 | 이 후보를 운영에 올릴지와 순서(r2만 먼저 vs 이 후보) | Master 배정, 필요하면 주인님 확인 |
| 2 | Tester 독립 검수(20경로, 격리 사본 재현, 1280·390·320 폭 소개 작품 화면 회귀) | Tester |
| 3 | 운영 DB 공개 게시 설치·권한·위임 봉인(T362 등) | Backend 실행, 권한 확인 주인님·Master |
| 4 | 실행 경로에 검증된 DB·비공개 표지 저장소 조립 연결(3절의 넣지 않은 모듈과 그 4경로) | Backend·Front, 별도 배정 |
| 5 | 공급원 전환 `sample → active`·`COVER_SOURCE active`(운영 설정은 운영 환경에만) | Front 코드, 설정은 주인님·Master |
| 6 | 빈 목록 표시 정책: 지금은 승인 0건이면 소개 작품을 보여 줘요. 주인님 지시로 시험 기간에는 유지해요 | 주인님 결정 |
| 7 | 재생 연결: T370 계약에 따른 구현 | 별도 배정 |
| 8 | 복귀 근거: 직전 운영 `3c57eff`, Vercel 배포 `74VTsQHDmrV8hs5Kwh7jpJcZh1EZ`(T353 기록). DB·환경값 변경이 없어 코드 되돌림만으로 복귀돼요 | Master |

## 이번에 하지 않은 것

- push·배포, 운영 조회·설정, `SHOWCASE_SOURCE`·`COVER_SOURCE` 변경은 하지 않았어요.
- 공용 작업본 파일 수정, T368 경로, 저장 데이터는 건드리지 않았어요.
- 기존 ref(r1 `90ac7d1`, r2 `2511a1e`)는 그대로 남겨 뒀어요.
