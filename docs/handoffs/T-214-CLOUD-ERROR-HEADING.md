# T-214 클라우드 불러오기 오류 화면 페이지 제목

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01(T-212 관찰 후속) · 상태: **ready_review**(자체 검증) · 로컬 커밋만, push·배포 없음
- 고정 SHA: **`8e131aed18fbd9db4f86139ff3423f9e15ae7e7e`** (이 보고서 커밋은 별도예요)

## 바뀐 것
- `components/cloud/project-list-readonly.tsx`
  - `CloudReadUnavailable({ retryHref, title, back })`가 `PageHeader`(h1 + 보기 전용 안내) 다음에 기존 Callout을 그려요.
  - Callout 문구, "다시 시도" 링크, tone은 그대로예요.
  - `back`이면 단건과 같은 "← 내 프로젝트" 링크를 둬요.
- `app/(cloud)/cloud/projects/(list)/page.tsx`: 오류 화면 제목 "내 프로젝트"(정상·빈 목록과 같은 제목).
- `app/(cloud)/cloud/projects/[id]/page.tsx`: 오류 화면 제목 "프로젝트 보기"(메타 제목과 같음)와 돌아가기 링크.
  - 프로젝트 이름은 불러오지 못했으니 쓰지 않아요.
- 바꾸지 않은 것: HTTP 200, 인증 307, 404 계약, DTO, 인증·DB 코드, CloudPending, 시안.
  - 로컬 안내(`CloudReadLocal`)에도 h1이 없지만 이번 범위가 아니라서 그대로 두었어요(관찰).

## 시험
- `tests/t207-cloud-read-ui.test.ts`: 25 → **26건**. 페이지 제목(h1)이 정확히 하나인지 확인하는 시험을 추가했어요.

| 화면 | h1 |
|---|---|
| 목록 정상 | 내 프로젝트 |
| 목록 빈 | 내 프로젝트 |
| 목록 오류 | 내 프로젝트(빈 목록 문구 없음, 오류 문구 있음) |
| 단건 정상 | 프로젝트 이름 |
| 단건 오류 | 프로젝트 보기(링크는 돌아가기·다시 시도 2개 모두 `/cloud/projects`) |

- `tests/t207-cloud-read-ui-http.mjs`: 실제 손상 snapshot 응답(목록·단건 200)에도 `<h1`이 1개여야 통과하도록 단언을 추가했어요.

## 실제 HTTP·브라우저
- 검증기 run `tmp/t207-http-380c3d5e-…`: base **8e131ae**, overlay 8(HEAD와 같음), **14 관찰 PASS**(새 h1 단언 포함).
- 유지 모드 서버에서 ego lite로 확인했어요. 합성 DB는 T-212 방식으로 A 보관·손상한 뒤 원복했어요.

| 상태 | 화면 | 1280 h1 / 넘침 | 390 h1 / 넘침 | Tab 순서 |
|---|---|---|---|---|
| 정상 | 목록 | 내 프로젝트 / 0 | 같음 / 0 | 로그아웃 → 프로젝트 링크 |
| | 단건 | 합성 A 프로젝트 / 세로 스크롤바만 | 같음 / 0 | 로그아웃 → ← 내 프로젝트 |
| 빈 목록 | 목록 | 내 프로젝트 / 0 | 같음 / 0 | 로그아웃 |
| | 단건(보관됨) | 프로젝트를 찾을 수 없어요 / 0 | 같음 / 0 | 로그아웃 → ← 내 프로젝트 |
| 불러오기 오류 | 목록 | 내 프로젝트 / 0 | 같음 / 0 | 로그아웃 → 다시 시도 |
| | 단건 | 프로젝트 보기 / 0 | 같음 / 0 | 로그아웃 → ← 내 프로젝트 → 다시 시도 |

- 모든 화면에서 h1은 하나예요. 오류 화면에 빈 목록 문구가 섞이지 않았고, B 제목도 나오지 않았어요.
- 스크린샷 `tmp/t214-shots/{normal,empty,error}-{list,detail}-{1280,390}.png`

## 확인
| 확인 | 결과 |
|---|---|
| 관련 회귀(t207·t200·t198·t183·project-get-routes·postgres request·t213) | **275/275** |
| `tsc --noEmit` | exit 0 |
| `eslint .` | exit 0 |
| 운영 build | 검증기 안에서 성공 |
- 전체 suite는 다시 돌리지 않았어요(지시).

## 정리
- `stop` 파일로 검증기를 끝냈어요. 검증기는 local 대조까지 마치고 exit 0으로 끝났어요.
- 포트 50975·50967·50974 listener 0, PG `server stopped`, `postmaster.pid` 없음.
- 합성 DB는 원복했어요(보관 해제, snapshot 원복, 임시 표 삭제).
- `app/` 복사본은 지웠어요. ego 작업 공간은 finish로 닫았어요.
- 3013, 공유 .next, Backend B12, 실제 DB, 배포는 건드리지 않았어요.
