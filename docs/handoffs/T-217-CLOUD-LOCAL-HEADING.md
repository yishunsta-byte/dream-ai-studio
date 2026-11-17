# T-217 이 PC(로그인 꺼짐) 안내 화면 페이지 제목

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01(T-214 관찰 후속) · 상태: **ready_review**(자체 검증) · 로컬 커밋만, push·배포 없음
- 고정 SHA: **`82846a1a6171445d84f0d02f64de8250f2c3d4d8`** (이 보고서 커밋은 별도예요)

## 바뀐 것
- `components/cloud/project-list-readonly.tsx`
  - `CloudReadLocal({ title })`이 기존 primitives `PageHeader`(h1)를 먼저 그리고, 그 아래 기존 Callout을 그대로 둬요.
  - Callout 문구("이 PC에서는 기존 작업실을 써요")와 "작업실로 가기 →"(`/`) 링크는 바뀌지 않았어요.
- 페이지별 제목은 T-214 오류 화면과 같은 맥락으로 맞췄어요.
  - `app/(cloud)/cloud/projects/(list)/page.tsx`: "내 프로젝트"
  - `app/(cloud)/cloud/projects/[id]/page.tsx`: "프로젝트 보기"
- 바꾸지 않은 것: local 판정 흐름(adapter·getUser 0, params 미읽기), HTTP 계약, 서버·DB·Auth, T-216 검수 중인 session 코드.

## 시험(CLI 출력 기준)
- `npx vitest run tests/t207-cloud-read-ui.test.ts` → **`Tests 26 passed (26)`**
  - 건수는 그대로예요. 기존 "이 PC: 목록·단건" 시험에 단언을 더했어요.
  - h1이 정확히 하나(목록 "내 프로젝트", 단건 "프로젝트 보기")인지 봐요.
  - 링크는 `/` 하나뿐인지 봐요.
  - 기존 adapter 0, getUser 0, params 미읽기, legacy 미접근 단언은 그대로 통과해요.
- `tests/t207-cloud-read-ui-http.mjs`
  - local 대조 응답(목록·단건)에도 `<h1`이 1개여야 해요.
  - `--hold`일 때 local 서버도 띄워 두고 `stop-local` 파일을 기다려요(브라우저 확인용). 공용 `/`는 열지 않아요.

## 실제 HTTP·브라우저
- 검증기 run `tmp/t207-http-6e20a6a6-…`: base **82846a1**, overlay 8(HEAD와 같음), **14 관찰 PASS**(local h1 단언 포함), exit 0.
- local 서버에서 ego lite로 확인했어요.

| 화면 | 1280 h1 / 넘침 | 390 h1 / 넘침 | main 링크 | Tab 첫 번째 |
|---|---|---|---|---|
| 목록 | 내 프로젝트 / 0 | 같음 / 0 | `/`만 | 작업실로 가기 →(outline solid) |
| 단건 | 프로젝트 보기 / 0 | 같음 / 0 | `/`만 | 같음 |

- 두 화면 모두 프로젝트 제목이 나오지 않았어요(데이터 없음).
- 링크는 포커스까지만 확인했고 눌러서 이동하지는 않았어요. 공용 legacy 화면을 열지 않으려는 거예요.
- 스크린샷 `tmp/t217-shots/local-{list,detail}-{1280,390}.png`

## 확인
| 확인 | 결과(CLI) |
|---|---|
| 관련 회귀 `t207·t200·t183·project-get-routes` | `Test Files 4 passed (4)`, `Tests 157 passed (157)` |
| `tsc --noEmit` | exit 0 |
| `eslint .` | exit 0 |
- 전체 suite는 다시 돌리지 않았어요(지시).

## 정리
- `stop`으로 클라우드 유지를, `stop-local`로 local 유지를 끝냈어요. 검증기는 exit 0으로 끝났어요.
- 포트 54723·54719·54722 listener 0, PG `server stopped`, `postmaster.pid` 없음.
- `app/` 복사본은 지웠어요. ego 작업 공간 3은 finish로 닫았어요.
- 3013, 공유 .next, Backend B12, 실제 DB, 배포는 건드리지 않았어요.
