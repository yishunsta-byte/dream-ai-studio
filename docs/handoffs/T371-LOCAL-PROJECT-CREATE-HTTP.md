# T371 검증된 비공개 이미지로 프로젝트 생성

2026-11-19 · Codes(Backend) · 구현 커밋 `6164808607abe2a6031f4126cafec726c63a1939`

## 연결 범위

| 경로 | 변경 |
|---|---|
| `app/api/projects/route.ts` | 기본 POST는 기존 인증과 SQLite 생성을 사용한다. 별도 선택 시 로컬 처리기로 보낸다. |
| `lib/cloud/local-project-create.ts` | 실제 서버 인증에서 확인한 사용자 ID, 서버 메뉴 스냅샷, 요청의 취소 신호를 T368 서비스에 전달한다. |
| `tests/postgres/t368-private-image-project-create.pg17.mjs` | 선택형 HTTP 시험을 기존 비공개 PNG 등록 직후에 실행한다. |
| `tests/postgres/t371-project-create-http.mjs` | 임시 앱의 실제 Next와 proxy, 루프백 인증·Storage, PG17을 사용한다. 기본 SQLite는 시험 사본에 별도로 이관한다. |

## 요청과 실행

로컬 시험에서 `DREAM_PROJECT_CREATE_BACKEND=owned-pg17`을 선택한다. POST 본문은 `menuId`와 `inputs`이며 쇼핑숏츠의 검증 PNG 한 개를 참조한다. 호출자가 논리 요청마다 UUIDv7 형식의 `Idempotency-Key`를 만들고 재시도 때 같은 값을 보낸다. 성공과 동일 요청 재시도는 같은 `201 {id}`를 반환한다. 내용을 바꿔 키를 재사용하면 409다. 과거 세대 파일 또는 타인 파일을 새 프로젝트에 붙이면 400이다.

시험 실행기가 임시 PG 포트·암호, 등록 담당 ID, 비공개 Storage 주소, 루프백 Supabase 인증 주소를 제공한다. 기존 운영 설정은 사용하지 않는다. 로컬 개발 또는 시험 실행, 루프백 요청과 인증·Storage, 지정 시험 DB와 제한된 DB 사용자만 지원한다. 웹 화면과 업로드 API의 PG 연결, 음악·영상, 실제 Supabase, 운영 배포는 후속 범위다.

```powershell
$env:T371_VERIFY_HTTP='1'
node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs
```

## 확인 결과

| 시험 | 결과 |
|---|---|
| 기본 설정에서 PNG 업로드 후 프로젝트 생성 | 실제 HTTP 201. 기존 호출 형식과 SQLite 저장 경로 유지 |
| 기존 클라우드 읽기 설정에서 기본 생성 호출 | 기존 LEGACY_DATA_UNAVAILABLE 503 |
| 선택형 경로의 인증 및 소유권 | 익명 401, 요청 키 누락·소유자 필드 위조·타인 파일 거절 400 |
| 본인 생성·동일 요청 재시도·내용 충돌 | 같은 ID 201, 충돌 409. 프로젝트 1개·단계 7개·파일 연결 1개·활동 기록 1개·생성 결과 기록 1개 증가 |
| 철회된 파일로 새 요청 | 400. 추가 프로젝트와 Storage 읽기 없음 |
| T368 직접 서비스 시험 | 동시 재시도, COMMIT 응답 유실, 롤백, 정책 순서와 제거 후 기존 작성 경로 통과 |
| 관련 회귀와 정적 검사 | Vitest 1,171건 통과·300건 건너뜀. 변경 경로 ESLint 통과. 생성된 Next 파일을 제외한 TypeScript 551개 파일 오류 0개 |

코드와 로컬 통합 시험을 Master에 인계한다. 사용자가 누르는 제작 화면부터 검증 파일 등록과 프로젝트 저장까지 이어지는 운영 검증은 남아 있다.
