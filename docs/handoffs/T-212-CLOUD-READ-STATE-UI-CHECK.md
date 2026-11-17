# T-212 클라우드 읽기 화면 빈 목록·불러오기 오류 브라우저 확인

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 상태: 검증 보완만(제품 수정 없음)
- 대상: HEAD **25210ae** 고정 사본
  - T-207 화면 + T-210 수정. 검증기 `source.json` base `25210aecf193dc15c7d1555eb17e75e865196acb`, overlay 8, removed 없음.

## 환경
- `tests/t207-cloud-read-ui-http.mjs --hold`
  - 운영 build+start, 합성 PostgreSQL 18.7 TLS(자기 서명, loopback) + 실제 SDK + fake Auth
  - 기존 14 관찰도 다시 통과한 뒤 서버를 유지했어요.
- 합성 DB 상태 변경: 작업 폴더 밖 scratchpad 스크립트를 썼어요.
  - 대상은 run.json의 loopback 포트·`dream_test_t207`·합성 admin 자격만이에요(검증기 고정값).
  - 바꾼 것: A 프로젝트 `archived_at` 설정·해제(빈 목록), A `template_snapshot_json` 손상·원복(불러오기 오류).
- 브라우저: ego lite, 계정 A로 로그인(fake verify). 폭 1280×900, 390×844(mobile 에뮬레이션).

## 결과
| 상태 | 확인 | 1280 | 390 |
|---|---|---|---|
| 빈 목록(A 보관) | "아직 클라우드에 옮긴 프로젝트가 없어요" 표시 / 오류 문구 없음 | ✓ / ✓ | ✓ / ✓ |
| | 가로 넘침 | 0 | 0 |
| | A·B 제목, B 이메일 노출 | 없음 | 없음 |
| | 민감값(postgres·DATABASE_URL·dream.projects·sentinel·stack, script 제외 HTML) | 없음 | 없음 |
| | main 안 링크 | 없음(정상) | 없음 |
| | Tab 순서 | 로그아웃 → 문서 밖 → 반복 | 같음 |
| 불러오기 오류(A snapshot 손상) — 단건 | "프로젝트를 불러오지 못했어요" / 빈 목록 문구 없음 | ✓ / ✓ | ✓ / ✓ |
| — 목록 | 같은 공통 안내 / **빈 목록으로 잘못 표시되지 않음** | ✓ / ✓ | ✓ / ✓ |
| | 넘침 · A·B 제목·B 이메일 · 민감값(snapshot 포함) | 0 · 없음 · 없음 | 0 · 없음 · 없음 |
| | Tab으로 "다시 시도"(로그아웃 다음) / 포커스 표시 | 2번 / solid 1px | 2번 / solid 1px |
| 다시 시도 후 복귀 | DB 원복 뒤 "다시 시도"에서 Enter → `/cloud/projects` 정상 목록, A 제목 표시, 오류 없음, B 제목 없음, 넘침 0 | ✓ | ✓ |

스크린샷 `tmp/t212-shots/`:
- `empty-{1280,390}.png`
- `error-detail-{1280,390}.png`, `error-list-{1280,390}.png`
- `recovered-{1280,390}.png`

## 관찰(결함 아님, Master 판단용)
- **오류 안내 화면에는 페이지 제목(h1)이 없어요.** 목록·단건 모두 Callout만 그려요(Callout 제목 "프로젝트를 불러오지 못했어요"는 있음).
  - 빈 목록·정상 화면은 "내 프로젝트" 제목이 있어요.
  - 화면 읽기 프로그램의 제목 이동에서 차이가 날 수 있어요. 제품 수정은 하지 않았어요(T-211 검수 중).
- 390 폭에서는 기존 AccountMenu 스타일대로 이메일이 화면에서 숨겨져요. 스크린리더용 문구는 남아 있어요.

## 정리
- `stop` 파일로 검증기를 끝냈어요.
  - 검증기는 그 뒤 local 대조까지 마치고 exit 0으로 끝났어요.
  - app·PG·Auth 포트(64967·56360·64966) listener 0, PG `server stopped`, `postmaster.pid` 없음.
- 합성 DB는 종료 전에 원복했어요(보관 해제, snapshot 원복, 임시 표 삭제). 클러스터 자체는 검증기 증거 폴더 안에만 있어요.
- 증거 폴더 `tmp/t207-http-8262b50b-1f14-425d-83e3-b138285b8590/`는 남겼어요.
  - 큰 앱 복사본(`app/`)은 작업 폴더 `tsc` 혼입을 막으려고 지웠어요. 그 뒤 작업 폴더 `tsc --noEmit` exit 0이에요.
- ego 작업 공간은 finish로 닫았어요. 3013·공유 .next·Backend·실제 DB는 건드리지 않았어요.
- 전체 suite·모든 HTTP 재실행은 하지 않았어요(지시). 검증기 기본 14 관찰은 서버 유지 전에 자동으로 다시 통과했어요.
