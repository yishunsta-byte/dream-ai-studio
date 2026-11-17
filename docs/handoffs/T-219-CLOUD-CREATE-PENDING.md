# T-219 클라우드 새 프로젝트 준비 안내

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01(T-218 결정: Storage 선행) · 상태: **ready_review**(자체 검증) · 로컬 커밋만, push·배포 없음
- 고정 SHA: **`84cf507150173132b8f4b726fd1a0e03b9bf03fc`** (이 보고서 커밋은 별도예요)
- T-220 우선 배정을 받아, 이미 끝낸 T-219 검증까지만 기록하고 넘어가요.

## 바뀐 것
- **새 화면** `app/(cloud)/cloud/projects/new/page.tsx`
  - 인증 판정만 해요(`getRenderAuth`). 목록과 같은 정책이에요.
    - 401 → `/login?next=%2Fcloud%2Fprojects%2Fnew`
    - 403 → `?error=forbidden`
    - 503 → `?error=unavailable`
    - local → 로컬 안내(h1 "새 프로젝트")
  - 로그인 상태 화면: h1 "새 프로젝트", "← 내 프로젝트" 링크, 안내 Callout이 있어요.
    - Callout 내용: "아직 클라우드에서는 새 프로젝트를 만들 수 없어요" / 사진·영상 자료를 올릴 수 있게 되면 만들 수 있어요 / 이미 옮긴 프로젝트는 내 프로젝트에서 볼 수 있어요
  - 폼·입력·버튼·제출·fetch·read adapter·DB·서비스 import가 없어요.
  - 기술 상세(DB·Storage·API 등)는 문구에 쓰지 않았어요.
- **목록** `components/cloud/project-list-readonly.tsx`: 머리글에 이차 링크 "새 프로젝트 만들기 안내 →"(`/cloud/projects/new`) 하나를 추가했어요. 정상·빈 목록 모두에 보여요.
- 바꾸지 않은 것: 목록 인증 helper·Backend·schema·API·write opt-in, session 코드.

## 시험(CLI 출력)
- `tests/t207-cloud-read-ui.test.ts` → **`Tests 34 passed (34)`**
  - 새 블록이 7건이에요: 거절 4종(이동 대상·adapter 0·legacy 0), local, 로그인 화면(h1 하나·문구·링크 2개 모두 목록·폼 요소 0·기술 문구 0·adapter 0·목록 조회 0), 정적 import.
  - 정적 import 목록에 새 page가 들어갔어요.
  - 기존 목록 링크 단언을 `["/cloud/projects/new", 상세]`로 바꿨어요.
- 관련 `t207·t200·t183·t213·project-get-routes` → **`Tests 189 passed (189)`**
- `tsc --noEmit`, `eslint .` 모두 exit 0이에요.

## 실제 HTTP(검증기, 운영 build+start, 합성 PG TLS + fake Auth)
- run `tmp/t207-http-c4c5c64d-…`: base **84cf507**, overlay 8, **18 관찰 PASS**, exit 0.
- 화면 단계 거절 결과
  - 401 → 307 `/login?next=%2Fcloud%2Fprojects%2Fnew`
  - 403 → 307 `?error=forbidden`
  - 503 → 307 `?error=unavailable`
  - 셋 다 no-store이고 거절 전후 Postgres 쿼리 0이에요.
- 로그인 상태: 200, no-store, h1 하나, 폼 요소 0, **Postgres 쿼리 0**. 목록 HTML에 `/cloud/projects/new` 링크가 하나 있어요.
- 기존 관찰(A/B/A, 404 동일화면, 손상 안내, local 대조 등)은 그대로 통과했어요.

## 브라우저(ego lite, 1280·390)
| 확인 | 1280 | 390 |
|---|---|---|
| 목록 Tab: 로그아웃 → "새 프로젝트 만들기 안내 →" | ✓ | ✓ |
| Enter → `/cloud/projects/new` | ✓ | ✓ |
| h1 / 넘침(목록·안내) | 새 프로젝트 / 0·0 | 같음 / 0·0 |
| 폼·입력·main 버튼 | 0 | 0 |
| main 링크 | `/cloud/projects` 2개 | 같음 |
| 안내 화면 Tab | ← 내 프로젝트 → 내 프로젝트 | 같음 |
- 페이지가 보낸 fetch 기록은 Next 링크 prefetch(RSC GET)와 T-213 세션 확인 `/api/auth/session`(포커스 복귀 확인)뿐이에요. **프로젝트 생성 요청은 0**이에요.
- 스크린샷 `tmp/t219-shots/{list,pending}-{1280,390}.png`

## 정리
- `stop`, `stop-local`로 검증기를 끝냈어요(exit 0).
- 포트 61988·61984·61987 listener 0, PG `server stopped`, `postmaster.pid` 없음.
- `app/` 복사본은 지웠어요. ego 작업 공간 4는 finish로 닫았어요.
- 3013, 공유 .next, Backend B13, 실제 DB, 배포는 건드리지 않았어요.
