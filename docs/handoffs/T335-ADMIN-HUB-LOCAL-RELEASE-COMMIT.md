# T335 검증된 관리자 배포 후보 로컬 커밋 고정

2026-11-19 · Codex(Front)
- 배정: Master `msg_0fec3e00a04e`(T333-R 통과 후속)

## 결과

| 항목 | 값 |
|---|---|
| ref | `refs/heads/release/admin-hub-20261119`(새로 만듦. 만들기 전 `show-ref` 결과 없음) |
| **후보 커밋** | `4d52d81423e9fdcedd7ea29effa0a57cb675a12f` |
| 트리 | `4bdd67579a9e13c2bb6c9ccae72ae901e4c726af` |
| 부모 | `ad82944b0eef492290fec7d5c68104e5d114e892` 하나 |
| 메시지 | `release(admin): 관리자 메뉴와 게시 큐(미연결) 후보 (T335)` |
| 기준 패치 | T333 `t333-candidate.patch` sha256 `4601a80b2124522a88e0b6ec198cd7958f033fe2a7615eb2460181d24600f5e6` |

## 만든 방법 (공유 상태를 건드리지 않음)

1. T333 생성 절차를 다시 실행했어요. 패치 sha256이 위 값과 **같고**, diff 개수는 32개예요.
2. 세션 임시 폴더의 새 `GIT_INDEX_FILE`에서 진행했어요. 시작 전 이 파일이 없는 것을 확인했어요.
   - `git read-tree ad82944…`
   - `git apply --cached t333-candidate.patch`
   - `git write-tree`
   - `git commit-tree <tree> -p ad82944…`
3. `git update-ref -m "T335 local release candidate" refs/heads/release/admin-hub-20261119 <sha> 0000…0000`을 실행했어요. 기존 값이 '없음'일 때만 성공하는 생성이에요. reflog 기록은 1건이에요.
4. 임시 인덱스 파일은 삭제했어요.

새 worktree나 체크아웃은 없었어요. 공유 `.git/index`, `HEAD`, 브랜치, 작업 디렉터리는 쓰지 않았어요.

## 검증

| 검사 | 결과 |
|---|---|
| 부모 | `ad82944…` 하나 |
| 경로 | `git diff --name-only ad82944 <후보>` 32개. 패치의 32경로와 집합이 같아요(추가 27·수정 5) |
| blob | 32/32가 패치 `index` 줄의 결과 blob과 같아요 |
| 원천 일치 | 인벤토리 2개를 뺀 30개가 `e990c77`의 blob과 같아요 |
| 인벤토리 2개 | `tests/api-auth.test.ts`는 `28b17fe66f48906f87e521a8f941ef3c412b7511`, `tests/t198-legacy-gate.test.ts`는 `cedd5a80063e15601ad706a7465a3a9254fc4302`(T333 고정값) |
| SHA-256 재대조 | 전체 패치 `4601a80b…f5e6` 일치. 후보 커밋에서 다시 뽑은 30경로 diff의 sha256 앞 16자리(`5bd4da538fc948f8`)가 패치 1부와 같아요 |
| 규모 | 32 files, +3,074 / −36 |
| 공유 상태 | 작업 전후 비교에서 아래가 모두 같아요. 커밋 뒤 이 문서를 master에 기록하기 전 시점이에요. <br>· `HEAD` `146b68f…`, `refs/heads/master`<br>· `.git/index` sha256<br>· `git status --porcelain` 123줄과 그 sha256<br>· 새 ref를 뺀 모든 ref의 목록·값 |

**제품 DB·Storage 비활성 (후보 트리 기준):**
- `lib/public-showcase/publication-runtime-config.ts`의 `loadPublicationRuntimeOptions()`가 `return undefined`예요. 그래서 조립이 `inactive`이고, 관리자 저장소는 `null`이라 게시 쓰기가 503 `PUBLICATION_UNLINKED`예요. 공개 공급원도 예시·비활성이에요.
- 관리자 프로젝트 목록은 `DREAM_PROJECT_READ_BACKEND=postgres`일 때만 읽어요.
- 트리 안 환경 파일은 `.env.example` 하나뿐이고 기준과 같아요. 비밀값은 없어요.
- 실행 검증(운영 빌드, 합성 인증 HTTP, 전체 Vitest 2,197 통과·실패 0)은 같은 패치 결과로 T333에서 했어요. 이번에는 트리와 blob이 같은지로 이어서 확인했어요.

## 하지 않은 것

- push·배포, 원격 ref 변경
- 운영 계정·환경 변경
- 기존 ref·이력 변경, 공유 `.next`

## 참고

이 문서는 후보 ref를 만든 뒤 `master`에 따로 커밋했어요. 후보 커밋(`4d52d81`)에는 이 문서가 들어 있지 않아요.
