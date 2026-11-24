# T248 가입 안내 문구 운영 후보·배포

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_e01e1a72c0f1`
- 상태: **후보 준비·검증 완료 · 배포(push)는 도구 권한 거절로 멈춤**
- 이 배포는 안내 문구만 바꿔요. 메일이 오지 않는 근본 원인을 해결하지는 않아요(T247).

## 1. 원격 확인
- `git ls-remote origin refs/heads/master` = `5148ebb8a5492ead4037afda76692212a1ed4c2d`
- 이 값은 운영 Current 소스와 같아요. 원격에는 다른 변경이 없었어요.
- `app/api/auth/signup/route.ts`는 `5148`과 `ce1f5b3^`에서 같아요. 그래서 diff가 그대로 적용돼요.

## 2. 후보
- **방법:** 공유 index·worktree·branch는 건드리지 않았어요.
  - 임시 `GIT_INDEX_FILE`에 `5148`을 read-tree 했어요.
  - `ce1f5b3^..ce1f5b3` 중 `app/api/auth/signup/route.ts`만 `apply --cached` 했어요.
  - 그다음 `write-tree`와 `commit-tree -p 5148`로 커밋을 만들었어요.
- **결과**
  - ref `refs/heads/release/signup-notice-20261118`
  - 커밋 `cd0f487329d30b76be5d509ac2d8ad1df79ac26c`
  - tree `04e62d78…`
  - parent `5148ebb`
- **대조**
  - `5148`과의 차이는 `M app/api/auth/signup/route.ts` 1파일뿐이에요(+2 −1, 문구 상수와 주석).
  - blob `e4ed2fc6…`가 `ce1f5b3`의 blob과 같아요.
  - 개발 HEAD의 backend 변경과 시험·문서는 들어가지 않았어요.
  - 전후로 공유 `.git/index` sha256 앞 16자(`e9d18d41655c0542`), stage 0개, HEAD `8b4b7c0`이 그대로였어요.

## 3. 저장소 밖 사본 검증
- archive는 1196파일, sha256 `0e6f4ded…788e`예요. `npm ci` 뒤 검증했어요.
- **tsc:** 0
- **eslint:** `eslint .` 0
- **관련 시험:** 6파일 **183 passed (183)**
  - 파일: t182-auth, t243, t245, api-auth, t197, 그리고 T247 시험
  - T247 시험(`t247-signup-notice`)은 후보에 없어요. 사본에 잠깐 복사해 돌린 뒤 지웠어요.
  - T247-R 독립검수의 65건은 4파일 기준이에요. 이번 183건은 6파일 기준이에요.
- **전체 vitest:** 96 passed / **9 failed** files, 1970 passed / 20 failed tests
  - 실패 9파일은 모두 영상·음성·자막·저장소 시험이에요.
  - 원인은 사본에 `.tools/ffmpeg/ffmpeg.exe`가 없어서 생긴 `spawn ENOENT`예요.
  - 이번 변경과 상관없어요. 안전 사본에는 도구를 연결하지 않는 규칙이 있어요.
- **build:** `npm run build` exit 0, 경고 0, verify-build 통과, BUILD_ID `U2j3_4ctijKIfhnxGbxYJ`
  - 빌드 결과에 새 문구가 들어 있어요.
- **`next start` HTTP**
  - 조건: 127.0.0.1:43248, `VERCEL=1`, 연결되지 않는 가짜 Supabase 주소
  - 화면 경로
    - `/` 200, `/admin/login` 200
    - `/admin` → `/admin/login?next=%2Fadmin`, `/admin/x`는 next를 유지해요
    - `/studio` → `/login?next=%2Fstudio`
    - API 401
  - 가입 요청
    - 허용 밖 주소: SDK를 부르지 않고 200 `{ok:true}`에 새 조건부 문구가 와요.
    - 다른 사이트 요청: 403 `AUTH_ORIGIN_REJECTED`
  - 실제 가입·메일·계정을 만드는 검증은 하지 않았어요.

## 4. 배포
- 원격이 여전히 `5148`이고 후보가 그 자손인지 확인한 뒤, `git push origin cd0f487…:refs/heads/master`(fast-forward)를 시도했어요.
- **Claude Code 자동 승인 검토기가 `[Destructive or Unwanted Actions]`로 거절**했어요(16:4x KST).
  - GitHub나 Vercel의 거절이 아니에요. 명령이 실행되지 않았어요.
  - 다른 경로로 우회하지 않았어요. Vercel CLI·API도 쓰지 않았어요.
- 그래서 **원격 master는 `5148` 그대로**이고, 운영 배포는 없어요. 운영 확인도 하지 않았어요.
- 거절된 같은 push를 Master나 다른 에이전트·도구가 대신 하지 않아요(우회 금지, Master `msg_9bc48d14c655`).
- 배포하려면 둘 중 하나가 필요해요.
  - 사용자가 직접 같은 SHA를 push 해요.
  - 또는 자동 승인 정책에서 이 동작을 허용해요.
- 어느 쪽이든 그 직전에 원격이 여전히 `5148`인지 다시 확인해야 해요.
- 후보 커밋·ref·사본은 그대로 보존해요.

## 보호
- 이 보고 1경로만 커밋해요. release ref는 새로 만들기만 했어요.
- 공유 index·`.next`·3013·50963·Ego54·Ego55는 쓰지 않았어요. Vercel env 읽기는 재시도하지 않았어요.
