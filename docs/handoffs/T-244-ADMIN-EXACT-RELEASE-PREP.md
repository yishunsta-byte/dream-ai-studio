# T-244 로그인 폼 44px 보완 · 관리자 release 후보 구성

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_6b3e5c95a1b8`
- 상태: **ready_review**
- 이 보고의 중간 후보(`f94faa1`)는 T-245 배정(`msg_495cf0c21983`)에 따라 **보존만** 해요. 최종 후보는 T-245 보고의 `5148ebb`예요.

## 1. 44px 보완(커밋 `ff1bc43`)
- `components/auth/login.module.css`만 바꿨어요.
  - `.reveal`(비밀번호 보기): `min-height:36px` → `var(--touch-min)`(44px)
  - `.linkButton`(비밀번호 찾기): `padding:var(--sp-1)`만 있던 것을 `display:inline-flex; align-items:center; min-height:var(--touch-min); padding:0 var(--sp-1)`로 바꿨어요.
- 관리자 로그인과 일반 `/login`이 같이 좋아져요.
- tsx·동작·인증·네트워크는 바꾸지 않았어요.
- **시험:** `tests/t243-admin-login.test.ts`에 1건을 추가했어요.
  - `--touch-min: 44px` 토큰이 있는지 확인해요.
  - `.reveal`·`.linkButton`·`.textButton`·`.tab`이 모두 `min-height:var(--touch-min)`이고 36px 같은 작은 고정값이 없는지 확인해요.
  - 옛 CSS: `1 failed | 13 passed (14)` → 수정 후 `14 passed (14)`
- 본 트리 전체 vitest: **104 passed | 10 skipped files, 2086 passed | 319 skipped**, `eslint .` 0

## 2. 중간 release 후보(보존)
- **방법:** 공유 index·worktree·branch를 바꾸지 않았어요.
  - 임시 `GIT_INDEX_FILE`에 `e36171c`를 read-tree 했어요.
  - `6d0ee14^..6d0ee14`(T-243)와 `6d0ee14..ff1bc43`(T-244) diff만 `apply --cached` 했어요.
  - 그다음 `write-tree`와 `commit-tree -p e36171c`로 커밋을 만들었어요.
- **결과**
  - ref `refs/heads/release/admin-login-20261118`
  - 커밋 `f94faa1660e30785e1208e2fd31dbe1026fefb04`
  - tree `99d4cd1f…`
- **대조**
  - `e36171c`와의 변경 파일 14개가 저자 커밋 목록과 같아요.
  - 각 파일 blob이 `ff1bc43`의 blob과 같아요.
  - 전후로 공유 `.git/index` sha256 앞 16자(`607dd94dad161b5e`), stage 0개, HEAD `ff1bc43`, `refs/heads/master`가 그대로였어요.
- **저장소 밖 archive 사본 확인**
  - 1195파일, archive sha256 `ee595ed3…c52a`
  - tsc 0, eslint 0, 관련 10파일 **287 pass**
  - `npm run build` exit 0, 경고 0, verify-build 통과(BUILD_ID `uyYAEojno1wZJMB-LTQlQ`)
- **운영 빌드 `next start` HTTP**(`VERCEL=1`, 127.0.0.1 가짜 인증 서버, 합성 토큰)
  - 익명: `/`·`/login`·`/admin/login` 200 no-store. `/admin` → `/admin/login?next=%2Fadmin`. `/admin/x?y=1`은 next를 유지해요. `/adminx`·`/studio` → `/login`. API 401
  - **허용 owner 모의 세션:** `/admin` 200. 허브에 이메일·링크 3개·미연결이 있고 form은 0이에요.
    - `/api/projects`는 503이에요. 이 사본에 DB를 연결하지 않아서예요. 인증은 통과했어요.
  - 허용 밖: `/admin` → `/admin/login?error=forbidden`, `/studio` → `/login?error=forbidden`, API 403
  - 위조 토큰: `/admin` → 관리자 로그인, API 401
  - 설정 누락: `/` 200, `/admin/login`·`/admin`·`/login` 503
- 이 중간 후보의 ego 화면 확인은 T-245 배정으로 최종 후보에서 했어요(T-245 보고 4장).

## 보호
- 이 보고 1경로만 커밋해요.
- release ref는 새로 만들기만 했어요. 기존 ref·후보는 바꾸지 않았어요.
- push·배포 없음. 공유 index·`.next`·3013·50963·Ego54 미사용.
