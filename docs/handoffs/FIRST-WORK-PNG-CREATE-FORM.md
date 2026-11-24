# 쇼핑숏츠 생성 폼의 비공개 PNG 업로드와 프로젝트 저장

Master 배정 msg_7d4ea231a685. 인증된 로컬 PG17 구성에서 /cloud/projects/new의 쇼핑숏츠 폼이 1 MiB 이하 PNG 한 장을 받는다. 저장 시 파일 전용 UUIDv7로 기존 업로드 API를 호출하고 반환된 ID를 productAssets에 넣어 기존 프로젝트 생성 키로 제출한다. 업로드를 확인한 파일은 같은 폼에서 다시 보내지 않는다. 성공 화면에는 서버가 반환한 프로젝트 ID를 가리키는 상세 링크가 있다.

## 실제 브라우저와 DB 관측

Backend 커밋 377e266의 독립 사본에 폼 변경을 복사했다. 기존 T371 실행기의 임시 Next 앱·합성 인증·루프백 Storage·소유 PG17을 사용했다. 브라우저에서 사진을 선택하고 실제 두 POST가 각각 최초 201을 받은 직후 화면에 전달할 응답만 한 번씩 유실시켰다.

| 화면 조작과 서버 관측 | 결과 |
|---|---|
| 사진 선택 후 저장 | 업로드 201 응답 유실. 폼에 오류가 표시되고 선택과 입력이 유지됐다. |
| 같은 폼에서 재시도 | 같은 업로드 키로 201 및 최초 파일 ID. 별도 프로젝트 키로 생성 201 후 응답 유실. |
| 프로젝트만 재시도 | 합성 인증 쿠키가 없는 요청은 401이었다. 같은 시험 계정 쿠키 복원 후 최초 생성 키·ID로 201. 사진은 다시 전송하지 않았다. |
| 저장 결과 | 브라우저에 저장 완료 안내와 정확한 상세 링크가 표시됐다. DB에서 프로젝트 +1, 단계 +7, 파일 링크·감사·성공 원장 각 +1을 확인했다. |

이어서 기존 PNG HTTP·T371·T368 시험이 통과했고 PG 프로세스·리스너·임시 클러스터가 정리됐다. SQLite 경로도 2efcfd0 고정 사본에서 사진 선택, 전송 전 실패, 같은 키 재시도와 이중 제출 억제, 실제 brief 화면 진입 및 DB 기록 1/1/7(프로젝트/파일 연결/단계)을 확인했다.

검증 명령은 node node_modules/vitest/vitest.mjs run tests/t207-cloud-read-ui.test.ts tests/project-form-request.test.ts tests/private-png-client-recovery.test.ts 이며 46건 통과. 변경 경로 ESLint와 페이지·폼 진입점 TypeScript 진단 0건. 브라우저는 구현자 자체 검수이며 Tester의 요청 함수와 페이지 활성 조건 시험은 독립 검수다. PG 상세 읽기 공급원 및 운영 Supabase·배포·실기기는 별도 검증 대상이다.

> Master 전달문 — 로컬 PG17 생성 화면에서 PNG 선택→실제 업로드→프로젝트 저장을 확인했습니다. 두 201 응답을 연속 유실시켜도 파일과 프로젝트가 최초 ID로 복구됐습니다. PG 상세 링크와 저장 건수를 대조했고 기본 SQLite 화면의 프로젝트 열기도 확인했습니다.

## 사진 출처·권리 메모

Master 후속 배정 msg_c2d9722dc542. 로컬 PNG 폼에 선택 입력(500자)을 연결했다. 파일과 앞뒤 공백을 제거한 메모가 같으면 업로드 키·확정 ID를 유지한다. 메모 변경이나 삭제를 제출하면 새 키로 파일을 등록하고 새 파일 ID를 프로젝트 입력에 반영한다. 빈 메모는 기존 요청 형식을 유지한다. 서버 계약은 f40984d다.

자체 검증은 tests/private-png-rights-note-form.test.ts, tests/private-png-client-recovery.test.ts, tests/project-form-request.test.ts, tests/t207-cloud-read-ui.test.ts의 47건 통과 및 변경 경로 ESLint 통과다. 메모를 포함한 브라우저·PG 통합 재현은 Master 지정 담당자에게 전달한다.
