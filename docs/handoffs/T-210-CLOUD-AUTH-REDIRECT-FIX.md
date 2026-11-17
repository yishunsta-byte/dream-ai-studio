# T-210 클라우드 목록 인증 거절 307 일관성

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01(T-207 결정 항목 자율 결정) · 상태: **ready_review**(자체 검증) · 로컬 커밋만, push·배포 없음

## 바뀐 것
- **삭제**: `app/(cloud)/cloud/projects/(list)/loading.tsx`. 목록 로딩 경계가 없어져서, 화면 단계 인증 거절도 단건과 같이 실제 307로 나가요.
  - 다른 상위 Suspense·loading으로 다시 넣지 않았어요. 표시가 늦어지는 동안에는 브라우저 기본 상태예요.
  - `(list)` 그룹은 그대로 둬요. 경로는 `/cloud/projects`로 같아요.
- `tests/t207-cloud-read-ui.test.ts`: 로딩 위치 시험을 강화했어요.
  - `app/(cloud)` 아래 모든 ts/tsx(glob)와 `app/loading.tsx`에 loading 경계가 0이어야 해요.
  - (cloud) 파일 어디에도 `Suspense`가 없어야 해요.
  - 25건이에요(정적 목록에서 삭제 파일 1건이 빠짐).
- `tests/t207-cloud-read-ui-http.mjs`
  - fake Auth에 proxy 통과 뒤 401(`expired`) 선택지를 추가했어요.
  - 화면 단계 거절 3종(401/403/503) × 목록·단건이 **모두 `307` + 정확한 Location + `no-store` + Postgres 쿼리 0**이어야 통과해요. 예전의 "200 스트리밍 redirect 허용" 분기는 지웠어요.
  - 작업 폴더에서 지운 파일은 고정 사본(HEAD archive)에서도 지우고 `source.json`의 `removed`에 기록해요.
- 바꾸지 않은 것: 다른 제품 파일, Backend/Auth/legacy gate.

## 실제 HTTP(운영 build+start, PostgreSQL 18.7 TLS + 실제 SDK + fake Auth)
- 최종 `tmp/t207-http-8b5026c9-f27d-4276-b7f3-71249586f449/`: base `d1940b2` + overlay 8 + removed `(list)/loading.tsx` → **14 관찰 PASS**, exit 0.

| 경우 | 단건 | 목록 |
|---|---|---|
| proxy 통과 뒤 화면 401(만료) | 307 `/login?next=%2Fcloud%2Fprojects` | 307 같은 Location |
| 화면 403(허용 밖) | 307 `/login?error=forbidden` | 307 같은 Location |
| 화면 503(인증 서버 오류) | 307 `/login?error=unavailable` | 307 같은 Location |
- 6건 모두 `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`이고, 거절 전후 `pg_stat_activity`가 같아요(쿼리 0).

T-207 결정은 그대로 유지돼요:
- A/B/A 정상 200
- 남의 것·없음·형식 오류는 같은 404 화면
- 비로그인 proxy 307
- snapshot 손상 → 200 공통 안내 → 복구
- legacy `/`는 준비 화면
- 만료 A 307·B 200
- data root 미생성, local 대조, TLSv1.3

### 실패를 그대로 남긴 실행
- 중간 실행 `tmp/t207-http-b3d50060-…/`: 목록 401이 **200**이라 실패했어요(exit 1).
- 원인은 검증기가 HEAD(cd0823d) 기준으로 사본을 만들어서, 커밋에 남아 있던 `loading.tsx`가 사본에 들어갔기 때문이에요.
- 삭제 파일을 사본에도 반영하도록 검증기를 고친 뒤 위 최종 실행이 통과했어요. 기대값은 완화하지 않았어요.
- 두 실행 모두 종료 뒤 app·PG·Auth 포트 listener 0, PG `server stopped`, `postmaster.pid` 없음이에요.
- 증거 폴더는 남겼어요. 다만 큰 앱 복사본(`app/`)은 4개 run 모두 지웠어요. 남아 있으면 작업 폴더 `tsc`가 옛 사본의 시험 파일까지 검사하기 때문이에요.

## 확인
| 확인 | 결과 |
|---|---|
| 관련 회귀(t207·t200·t198·t183·api-auth·t191·t182·project-get-routes·postgres request/backend) | **442/442** |
| `tsc --noEmit`(작업 폴더, 사본 정리 뒤) | exit 0 |
| `eslint .` | exit 0 |
| 운영 build | 검증기 안에서 성공(build.log) |
- 전체 suite는 추가 실패 요인이 없어서 반복하지 않았어요(Master 지시).

## T-207 보고서 표현 정정
- T-207에서 "요청마다 `getMenuConfigState()`가 고정 `docs/spec/menus.json`을 읽는다"고 쓴 건 정확하지 않아요.
- `lib/menus/server.ts`는 결과를 모듈 변수(`state`)에 담아 두고, 실제 파일 읽기는 **서버 프로세스당 처음 한 번**만 해요. 그 뒤 요청은 메모리 값을 다시 써요.
- 처음 읽기에 실패하면 실패 상태도 그대로 담아 두기 때문에, 서버를 다시 시작하기 전까지 루트가 설정 오류 화면을 계속 보여요.
