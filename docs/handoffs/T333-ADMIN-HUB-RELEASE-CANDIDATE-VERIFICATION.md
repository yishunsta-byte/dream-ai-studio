# T333 관리자 메뉴와 기존 기능을 포함한 후보 고정 검증

2026-11-19 · Codex(Front)
- 배정: Master `msg_e33232b0c818`(T331 (가) 채택)
- 저장소 기록: 이 문서 하나

## 고정 값

| 항목 | 값 |
|---|---|
| 기준(운영 추적) | `ad82944b0eef492290fec7d5c68104e5d114e892` |
| 원천(T329) | `e990c777be2f9c500d6bc876d092af059177587d` |
| 후보 패치 | `t333-candidate.patch`, 파일 32개, 3,356줄 |
| **패치 sha256** | `4601a80b2124522a88e0b6ec198cd7958f033fe2a7615eb2460181d24600f5e6` |
| 재현성 | 같은 명령을 두 번 실행해 바이트가 같은 것을 확인했어요(`cmp`) |

### 포함 범위 (32개)

**제품 21개(T331과 같음).** 모두 `e990c77` 내용 그대로예요.
- 변경 3개: `app/admin/page.tsx`, `components/admin/admin-hub.tsx`, `components/admin/admin.module.css`
- 신규 18개:
  - `app/api/admin/publications/route.ts`
  - `components/admin/` 아래 `admin-projects.tsx`, `publication-http-queue.tsx`, `publication-queue.tsx`, `publication-queue.module.css`, `publication-model.ts`, `publication-provider.ts`, `publication-http-provider.ts`
  - `lib/public-showcase/` 아래 `admin-publication-http.ts`, `admin-publication-service.ts`, `publication-runtime.ts`, `publication-runtime-config.ts`, `publication-provider-assembly.ts`, `publication-showcase-connection.ts`, `cover-path.ts`, `cover-source.ts`, `showcase-source.ts`, `published-works.ts`

**전용 시험 9개.** 모두 `e990c77` 내용 그대로이고, 기준에는 없는 파일이에요.
- `tests/admin/` 아래 `admin-hub-information-architecture.test.ts`, `publication-http-fixture.ts`, `publication-http.test.ts`, `publication-queue{,-active-write,-failed-load,-slug-state,-sync}.test.ts`
- `tests/t283-admin-overview-projects.test.ts`

**인벤토리 시험 2개.** `e990c77` 판에서 후보에 없는 T296 경로 두 줄만 지웠어요. 각 줄이 정확히 한 번 나오는지 확인한 뒤 지워요.

| 파일 | 지운 내용 | 결과 blob |
|---|---|---|
| `tests/api-auth.test.ts` | 줄 `  "studio/reference-analysis",` | `28b17fe66f48906f87e521a8f941ef3c412b7511` |
| `tests/t198-legacy-gate.test.ts` | `, "../app/api/studio/reference-analysis/route.ts": ["POST"]` | `cedd5a80063e15601ad706a7465a3a9254fc4302` |

빠진 것과 이유:
- `proxy.ts`의 표지 처리, `admin-local-notice.tsx`: T331에서 정한 대로 범위 밖이에요.
- `tests/t220-*`, `tests/t243-*`: 기준과 `e990c77`이 같아서 패치에 넣을 필요가 없어요.

### 재현 절차

패치 만들기(셸 스크립트, 저장소는 읽기만 함):

1. 공통 git 설정은 `-c core.quotepath=false -c diff.noprefix=false -c diff.mnemonicprefix=false -c core.autocrlf=false`이에요.
2. 1부: `git diff --no-color --no-ext-diff --full-index --binary ad82944… e990c77… -- <제품 21개> <전용 시험 9개>`
3. 2부: 아래 순서로 만들어요.
   - 인벤토리 2개를 `git show`로 기준판(a)과 `e990c77`판(b)으로 꺼내요.
   - b에서 위 두 문자열을 지워요(각 1회 일치 확인, 바이트 그대로 저장).
   - `git diff --no-index --no-color --no-ext-diff --full-index a b`를 실행하고, 머리글의 `a/a/`·`b/b/`를 `a/`·`b/`로 바꿔요.
4. `cat 1부 2부 > t333-candidate.patch` → sha256이 위 값과 같아야 해요.

적용과 확인:

1. 사본을 준비해요.
   - `git archive ad82944`를 빈 폴더에 풀고 `git apply t333-candidate.patch`를 실행해요(종료 0).
   - `node_modules`는 robocopy로 복사해요. `tmp/`는 빈 폴더로 만들어요. `tests/storage-private-read.test.ts`가 저장소 루트의 `tmp`를 쓰는데, git archive에는 이 폴더가 없어요.
2. 적용된 32개 파일의 git blob id가 패치 `index` 줄의 결과 id와 모두 같아요(CR 제거 후 `git hash-object --stdin`, 32/32).
3. 제품 21개와 전용 시험 9개는 `git rev-parse e990c77:<경로>`와도 같아요.

## 검증 결과 (격리 사본)

**FFmpeg:**
- 기존 승인된 로컬 도구 `.tools/ffmpeg`(ffmpeg 9.0.2 `ffmpeg.exe`·`ffprobe.exe`·라이선스)를 **실파일로 복사**했어요(정션 아님).
- 복사본과 원본의 `ffmpeg.exe` sha256 앞 16자리는 둘 다 `3256173f3f8bffd7`이에요.

**정적 검사 (합성 인증 패치 전, 후보 코드 그대로):**
- `tsc --noEmit`(생성 `.next` 제외): 오류 0
- 패치 안 코드 파일 ESLint: 통과

**전체 Vitest:**

| 실행 | 결과 |
|---|---|
| 1차 | 1개 파일 실패: `storage-private-read`가 `tmp` 폴더 없음(ENOENT realpath). 사본 준비 누락이었어요 |
| `tmp/` 생성 뒤 2차 | **파일 113 통과 · 10 건너뜀(123), 시험 2,197 통과 · 319 건너뜀 · 실패 0** |
| T331의 ENOENT 20건 파일 5개 다시 실행 | `measure-subtitle`, `p2-5b-audio-dsp`, `p2-5c-render-audio`, `p2-5u2-audio-editor`, `t152-audio-join-draft` **5 파일 51건 통과** |

- T331에서 FFmpeg가 없을 때는 20 실패·406 건너뜀이었어요. FFmpeg를 연결하자 실패 0·건너뜀 319가 됐어요. 그 결과 20건이 통과했고, 건너뛰던 87건도 실행됐어요.
- 남은 건너뜀은 기존 실행 조건(루프백 PG 등 환경 의존) 시험이에요.

**운영 빌드와 HTTP (합성 인증):**
- 사본 전용 패치를 적용했어요(커밋 안 함). `lib/auth/render.ts`·`resolveServerAuth`가 쿠키 `t331-auth` = verified·local·401·403·503에 따라 합성 결과를 돌려줘요. 합성 계정은 `operator@example.invalid`예요.
- `npm run build` 성공, `next start -H 127.0.0.1 -p 3333`로 실행했어요. 로그인 모드가 꺼진 로컬 실행이라 proxy의 Supabase 단계는 거치지 않아요.

| 영역 | 요청 | 결과 |
|---|---|---|
| 관리자 권한 | `/admin` 로컬 / 401 / 403 / 503 | 200 로컬 안내(메뉴 없음) / 307 `/admin/login?next=%2Fadmin` / `?error=forbidden` / `?error=unavailable` |
| 관리자 화면 | `/admin` 확인 계정 | 200 `private, no-cache, no-store, max-age=0, must-revalidate` |
| └ 메뉴 | | `#admin-overview 개요`·`#admin-project-list 내 프로젝트`·`#admin-review 완성본 검수·게시`·`#admin-account 계정 설정`, 대상 영역 4개 |
| └ 기존 항목 | | `/cloud/manage`·`/cloud/projects`·`/account/password` 링크, 계정 이메일 표시 |
| └ 미연결 | | 운영 연결 범위 6개(작업 대기열·자료 관리·백업·복원·운영 로그·회원 관리·서비스 상태). 프로젝트 영역 미연결, 검수 영역 '게시 서버 미연결 … 서버 기능이 아직 연결되지 않았어요' |
| 닫힌 게시 | `GET /api/admin/publications` 확인 계정 | 200 `no-store` `{"kind":"closed"}` |
| | `POST` 확인 계정(같은 출처 JSON) | 503 `PUBLICATION_UNLINKED`(처리 안 함) |
| | `POST` 다른 출처(`Origin: http://evil.example`) | 403 `AUTH_ORIGIN_REJECTED` |
| | `PUT`·`DELETE` | 405 / 405 |
| | `GET` 401 / 403 / `POST` 401 / 로컬 `GET` | 401 `AUTH_REQUIRED` / 403 `AUTH_FORBIDDEN` / 401 / 503 `PUBLICATION_UNLINKED` |
| 기존 보안 | `GET /api/projects` 401 / 403 / 확인 / 로컬 | 401 / 403 / 503 / 503(기존 legacy 가드 동작, 패치 범위 밖 파일) |
| | `/cloud/projects` 401 / 확인 | 307 `/login?next=%2Fcloud%2Fprojects` / 200 |
| 공개 | `/` | 200, 게시 표지 링크 없음(공개 목록 기준 동작) |
| | `/login` / `/admin/login` | 307 `/studio`(로그인 꺼진 로컬의 기준 동작) / 200 |

**기본 비활성 확인:**
- `loadPublicationRuntimeOptions()`가 `undefined`라서 조립이 `inactive`예요. 관리자 저장소 `null`, 게시 쓰기 503, 목록 `closed`예요.
- DB·Storage 연결 시도도 없어요. 사본에 관련 환경값이 없고, 프로젝트 읽기는 `DREAM_PROJECT_READ_BACKEND`가 없어서 미연결이에요.

## 정리 근거

- 서버를 멈췄어요. 3333 포트 대기는 0이에요.
- 격리 사본(FFmpeg 복사본 포함)은 재분석 지점을 먼저 지우고 폴더째 삭제했어요(없음 확인).
- 패치 파일은 세션 임시 폴더에만 있어요.
- 저장소 `node_modules`는 283개 그대로이고, `app`·`components`·`lib`·`tests` 작업 트리 변경은 0이에요. 원본 `.tools/ffmpeg`는 그대로예요(해시 같음).
- push·배포, 운영 계정·환경 변경, 공유 `.next` 변경, 새 창·worktree는 없어요.

## 차이·추가 범위 보고

- 패치 범위는 T331 결론과 같아요(제품 21 + 전용 시험 9 + 인벤토리 2).
- **인벤토리 2개는 어느 커밋에도 없는 새 내용이에요.** 반영 브랜치에 별도 커밋으로 넣어야 해요.
- 새 사본에서 전체 시험을 돌리려면 저장소 루트에 빈 `tmp/`가 있어야 해요. 기존 시험의 전제이고 후보와는 상관없어요.
- 이 검증은 로그인 모드가 꺼진 로컬 실행이에요. 운영 프록시(Supabase 세션·허용 이메일)를 거친 관리자 경로는 기존 시험(`t243` 관리자 로그인, `api-auth`)으로만 덮었어요. 실제 운영 계정이나 환경으로는 확인하지 않았어요.
