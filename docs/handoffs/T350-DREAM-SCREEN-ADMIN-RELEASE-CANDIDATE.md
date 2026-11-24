# T350 관리자 Dream Screen 최소 릴리스 후보 점검

2026-11-19 · Codex(Front)
- 배정: Master `msg_be443f8e44cc`
- 역할 조정: Master `msg_c82700d7f9b8`. 사용자가 Design에 운영 배포를 직접 지시했어요. Design이 이미 같은 후보를 고정했으면 새 후보를 만들지 않고, 그 SHA와 diff를 대조해 공유해요.

## 결론

- **새 로컬 후보는 만들지 않았어요.** Design이 만든 `3c57eff6724886d104faab1937059579647e5ffb`(`release(admin): deploy Dream Screen operations console`)가 이미 원격 `master`에 있어요. 이 커밋이 제가 따로 만든 최소 패치와 **바이트까지 같아요.**
- 따라서 이 문서는 그 커밋을 대조하고 검증한 기록이에요. 별도 ref는 만들지 않았어요.

## 대상

- 원천 커밋:
  - `865d269 style(admin): apply Dream Screen console design`
  - `a297c0f fix(admin): announce the current console section`
- 기준: 배정 시점 원격 `master` = `4d52d81423e9fdcedd7ea29effa0a57cb675a12f`(T335 후보)
- 제품 파일 4개: `app/admin/page.tsx`, `components/admin/admin-hub.tsx`, `components/admin/admin.module.css`, `components/admin/admin-navigation.tsx`(신규)
- 관련 시험 1개: `tests/admin/admin-hub-information-architecture.test.ts`
- 뺀 것: `a297c0f`의 `docs/handoffs/T348-F1-…md`(문서라서 제외)

## 드리프트

- 5개 경로 모두 `4d52d81`의 blob과 `865d269^`(=`59778be`)의 blob이 같아요.
- 그래서 증분 패치를 `59778be..a297c0f`에서 뽑아 `4d52d81`에 그대로 올릴 수 있어요. 충돌은 없어요.

## 의존성

- `app/admin/page.tsx`, `admin-navigation.tsx`, 관련 시험에서 시작해 import를 따라갔어요. 모두 55개 파일이고, 못 찾은 import는 0개예요.
- 기준과 다른 파일은 대상 5개 말고 하나뿐이에요: `components/admin/admin-local-notice.tsx`(T-255-F1 공개 홈 링크 변경).
  - 이 파일은 `admin.link` 스타일만 쓰는데, 그 스타일은 새 CSS에도 남아 있어요. 그래서 이번 범위에 필요 없고, T331·T333에서처럼 범위 밖으로 둬요.
- `admin-navigation.tsx`가 쓰는 아이콘 `home`·`folder`·`check`·`settings`는 기준의 `components/ui/Icon`에 있어요. 형식 검사도 통과했어요.
- 대상 파일이 쓰는 CSS 클래스는 새 `admin.module.css`에 모두 있어요.

## 증분 패치

| 항목 | 값 |
|---|---|
| 명령 | `git diff --no-color --no-ext-diff --full-index --binary 59778be a297c0f -- <5경로>`(T333과 같은 git 설정) |
| 규모 | 파일 5개(추가 1·수정 4), 316줄, +156 / −81 |
| **sha256** | `6b8f7cfb492caec5f1870c54704afa1cfde32817611dba63997085acb76c9ba0` |
| 재현성 | 두 번 만들어 바이트가 같아요 |

## Design 후보와 대조

| 검사 | 결과 |
|---|---|
| 커밋 | `3c57eff6724886d104faab1937059579647e5ffb` |
| 부모 | `4d52d81…` 하나 |
| 바뀐 경로 | 5개(위와 같은 집합). 다른 경로는 없어요 |
| diff | `git diff 4d52d81 3c57eff -- <5경로>`의 sha256이 `6b8f7cfb…9ba0`로 **같고**, `cmp`로 바이트도 같아요 |
| blob | 5경로 모두 `3c57eff` = `a297c0f` |

## 검증 (격리 사본)

- 사본 준비: `git archive 4d52d81`를 풀고 패치를 `git apply`(종료 0)했어요. `node_modules`는 robocopy, `.tools/ffmpeg`는 실파일 복사, `tmp/`는 빈 폴더예요.
- 사본의 5경로가 `3c57eff` blob과 5/5 같아요.
- `tsc --noEmit`(생성 `.next` 제외): 오류 0
- ESLint(코드 4개): 통과
- 전체 Vitest: **파일 113 통과 · 10 건너뜀(123), 시험 2,197 통과 · 319 건너뜀 · 실패 0**
- 게시와 읽기 운영 활성화는 그대로 꺼져 있어요. 5경로 모두 `lib/public-showcase/publication-runtime-config.ts` 같은 연결 설정을 바꾸지 않아요.
- 운영 빌드와 HTTP 점검은 하지 않았어요. 배포 담당이 Design으로 정해져서 정적 검사와 전체 시험까지만 했어요.

## 정리

- 사본은 재분석 지점을 먼저 지우고 폴더째 삭제했어요(없음 확인).
- 저장소 `node_modules`는 283개 그대로예요.
- 새 ref·임시 인덱스는 만들지 않았어요.
- push·배포, 운영 계정·환경 변경, 다른 작업 파일 수정, 새 창·worktree는 없어요.
