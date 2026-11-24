# T286 관리자 내 프로젝트 최소 릴리스 후보 통합 검증

- 담당: Codex(Front) · 배정 Master `msg_1272deffc686`
- 기준(롤백 지점): `ad82944` (원격 master, `style(admin): apply NEON SCREEN cinema login`)
- 판정: **지정 후보 A는 빌드 실패라 제출하지 않아요.** 대안 후보 B는 전체 통과예요. 어느 쪽으로 갈지 Master 결정이 필요해요.

## 후보

작업공간 파일과 브랜치는 바꾸지 않았어요. 임시 인덱스(`GIT_INDEX_FILE`)로 `ad82944` 트리에 지정 경로의 blob만 얹어 커밋 객체를 만들었어요. 지워지지 않도록 로컬 참조만 달았어요(push 없음).

| 후보 | SHA | 로컬 참조 | 내용 |
|---|---|---|---|
| A(지정) | `e7f41f55441fbd01f62b8e64f0293b1f3ee958bd` | `t286-candidate` | `ad82944` + T283 `0b32585` 5경로 + T285 `e2c4725` 1경로 |
| B(대안) | `85a770d1acef2f26cf6ca06d1a8b6d38bf76097a` | `t286-candidate-b` | `ad82944` + T283 `0b32585` 5경로만 |

T283 5경로는 다음과 같아요.
- `app/admin/page.tsx`
- `components/admin/admin-hub.tsx`
- `components/admin/admin.module.css`
- `components/admin/admin-projects.tsx`
- `tests/t283-admin-overview-projects.test.ts`

T285 1경로는 `tests/public-showcase/home-navigation.test.ts`예요.

기준 대비 diff는 A가 6파일 +334/−2, B가 5파일 +211/−2예요. 두 후보의 차이는 `home-navigation.test.ts` 한 파일뿐이에요. 앞의 세 파일에서 기준과 달라진 부분은 T283에서 고친 줄뿐이에요. 다른 작업, REA, 로컬 미커밋 변경은 들어 있지 않아요.

## 후보 A가 실패하는 이유

`ad82944`에는 `tests/public-showcase/`가 없어요. 공개 홈 철회 가드 파일(`components/public-showcase/showcase-guard.tsx`, `lib/public-showcase/showcase-guard-runtime.ts`)도 없어요. 이 파일들은 T-255-F1~F3 작업물이고 기준에 반영되지 않았어요. 그런데 T285 시험 파일이 8·9번 줄에서 이 두 모듈을 가져와요.

- tsc: `TS2307 Cannot find module '@/components/public-showcase/showcase-guard'`, `'@/lib/public-showcase/showcase-guard-runtime'` (2줄)
- vitest: `home-navigation.test.ts` 파일 실패(0 test, `Cannot find package`)
- `npm run build`: 같은 TS2307로 `Failed to type check.` 종료 코드 1

T285 시험을 살리려면 T-255-F1~F3 가드 코드까지 후보에 넣어야 해요. 그러면 공개 홈 동작이 바뀌어서 “최소 후보” 범위를 넘어요. 그래서 제가 정하지 않았어요.

## 검증 (임시 디렉터리 사본, 실제 출력)

사본에는 `node_modules`(기준과 package 파일 차이 없음)와 `.tools`를 실제 파일로 복사했어요(접점 연결 0개).

| 항목 | 후보 A | 후보 B |
|---|---|---|
| eslint 전체 | exit 0 | exit 0 |
| tsc | 2줄(TS2307) | 0줄 |
| vitest 전체 | `Test Files 1 failed \| 106 passed \| 10 skipped (117)`, `Tests 2084 passed \| 319 skipped (2403)` | `Test Files 106 passed \| 10 skipped (116)`, `Tests 2084 passed \| 319 skipped (2403)` |
| build | 실패(type check) | 성공 |

처음 실행에서는 `.tools` 없이 소리·자막 도구 시험 20개가 실패했어요. 도구를 복사한 뒤에는 모두 통과해서 환경 차이로 판정했어요.

**브라우저 확인(후보 B 빌드)**: ego 공간 90, 격리 서버 127.0.0.1:43286, 로그인 끔 + 시험용 빈 저장 폴더. 1280과 390에서 같은 결과가 나왔어요.
- **관리자 4상태:** 실제 `AdminHub`를 합성 상태로 그리는 사본 전용 확인 화면(후보에 없음)으로 봤어요.
  - 미연결: 배지와 안내만 보이고 링크는 0개예요.
  - 실패: 경고와 `/admin` 다시 불러오기 링크가 보여요.
  - 결과 없음: 0개, 조회 시각, 없음 안내가 보여요.
  - 목록: 3개 상세 링크가 `/cloud/projects/<id>`로 가고, 전체 화면 링크가 있어요.
  - 링크 높이는 44~48px, 영역 안 조작 요소는 0개, 가로 넘침은 0이에요.
- 실제 `/admin`(로그인 꺼짐)은 기존 안내만 보이고, 내 프로젝트 영역은 없어요.
- **공개 메인 회귀:** `/` 제목 `NEON AFTER HOURS`, 예시 카드 6개, `관리자 로그인` 링크가 보이고 가로 넘침은 0이에요.

허용·미인증·금지·설정 실패 판정은 후보 vitest 안의 `t283`·`t243` mock 인증 시험으로 확인했어요(실제 계정 로그인 아님).

정리: 사본·서버·ego 공간을 닫았어요. 원본 `node_modules`는 283개, `.tools`는 4개 그대로예요. 작업공간 변경은 0건이에요.

## 설정 경계

- **기존 관리형 읽기는 비활성이에요.**
  - 후보는 환경을 바꾸지 않아요.
  - 운영에 `DREAM_PROJECT_READ_BACKEND=postgres`가 없으면 관리자 개요는 “프로젝트 목록 미연결”만 보이고 읽기를 호출하지 않아요.
- **실제 목록을 보이려면 별도 설정이 필요해요.**
  - `DREAM_PROJECT_READ_BACKEND=postgres`와 형식이 맞는 `DATABASE_URL`이 필요해요.
  - Supabase 로그인 설정도 있어야 해요.
  - 이 작업은 별도 승인 대상이고, 이번에는 하지 않았어요.
- **설정 오류는 미연결이 아니라 “실패”로 보여요.**
  - `postgres`로 설정했는데 주소가 틀린 경우가 여기에 해당해요(T283 보고 참고).

## 롤백

배포 뒤 되돌릴 기준은 `ad82944`예요. 후보는 기준에 커밋 하나를 얹은 구조라 기준으로 되돌리면 이번 변경이 모두 빠져요.

## Master 결정 필요

1. 후보 B(`85a770d`)를 고정 후보로 제출. T285 시험은 가드 코드가 들어갈 때 함께 넣어요.
2. T-255-F1~F3 가드 코드까지 포함한 더 큰 후보로 다시 구성. 공개 홈 동작이 바뀌어서 별도 검수가 필요해요.
