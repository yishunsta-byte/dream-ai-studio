# 로컬 PG 재편집 ZIP 보관과 소유자 다운로드

생성 단위 `7dc3d71`의 임시 아카이브를 현재 승인본에 묶어 비공개 PG에 보관한다. 기존 `dream.exports`에 결과 키·매니페스트·SHA를 기록하고, 새 로컬 스키마에는 생성 요청과 ZIP 바이트를 둔다. ZIP 바이트·성공 상태·내보내기 승인·성공 활동을 같은 트랜잭션으로 확정한다. 같은 기준의 성공 결과는 기존 파일을 돌려준다.

## HTTP 계약

- `GET /api/projects/{id}/exports`는 현재 내용 리비전·타임라인 ID·생성 가능 여부와 현재 버전만 조회한다.
- 같은 경로의 POST는 `{revision,timelineId}`와 UUIDv7 `Idempotency-Key`를 받는다. 최초 성공 201, 같은 결과 재요청 200이다. 같은 타임라인의 동시 작업은 409이며, 이전 키를 다른 승인본에 사용할 때도 409다.
- `GET /api/projects/{id}/exports/{exportId}`는 현재 승인본을 소유한 계정에 `application/zip`, `attachment`, `private, no-store`로 준다. 현재 리비전이 바뀌면 409, 타 계정이나 아직 성공하지 않은 결과는 404다.
- `local_editing_bundle_export` 역할은 소유자 RLS를 적용한다. 새 바이트를 삽입하고 조회하며, 성공 아카이브 바이트를 갱신하는 권한은 부여하지 않는다. 작업 임대와 시도 ID를 비교해 끝난 시도가 결과를 덮어쓰는 경합을 막는다.

## 변경 경로

- `app/api/projects/[id]/exports/route.ts`와 `app/api/projects/[id]/exports/[exportId]/route.ts`
- `lib/cloud/local-editing-export.ts`, `lib/cloud/local-wav-access.ts`, `lib/export/local-pg-editing-bundle.ts`
- `lib/db/postgres/private-wav-upload/editing-bundle-output.sql`과 `tests/api-auth.test.ts`

## 검증

- `63c8ed9` 격리 사본에 변경 경로를 반영했다. `D:/starwork/p2-pg-first-work-e2e`에서 `T371_VERIFY_HTTP=1`, `T371_VERIFY_FIRST_WORK_MODE=two`, `T371_VERIFY_FIRST_WORK_CAPTIONS=1`, `T371_VERIFY_EXPORT_API=1`을 켜고 `node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs`를 실행했다. 보관·재시작 검사는 `tests/postgres/editing-bundle-output.probe.mjs`에 있다.
- 실제 Next 개발 Turbopack·PG17.12에서 승인 r4 v1을 생성했다. r6에 두 PNG·한글 자막·WAV를 저장하고 승인했을 때 r4 다운로드는 409였고, r4 요청 키를 r6에 재사용해도 409였다.
- r6 생성 중 같은 키와 다른 키의 동시 요청은 모두 409였다. 완료 활동 삽입을 실패시키자 503·ZIP 바이트 0·성공 활동 0·내보내기 단계 todo를 확인했다. 같은 요청을 재시도해 이전과 같은 내보내기 ID로 201을 받았다. 최종 결과 파일·성공 활동 각 한 건, 반복 요청 200, 타 계정 404였다.
- ZIP은 2,088,402바이트, SHA-256 `488d9704f67bad0abee1519f52c4eb16ad2d83de2e8c75141b31ca0365e12db2`였다. Next 서버 프로세스를 종료하고 다시 띄운 뒤 다운로드 바이트와 재요청 응답이 같았다. 실제 새 편집 저장 뒤 같은 URL은 409였고, 기존 성공 행과 ZIP 바이트는 보존됐다. 시험 역할과 PG를 정리했으며 종료 코드는 0이었다.
- `npm.cmd run typecheck`, 변경 ESLint, 인증·ZIP·내보내기·추적 회귀 9파일·265건을 통과했다. `7dc3d71` 물리 의존성 사본에 API 변경을 반영한 `npm.cmd run build`에서 운영 파일 추적 검사도 통과했다.

시험 보관소는 소유한 루프백 PG17이다. 독립 검수는 같은 API의 결과와 Front 화면 통합으로 이어갈 수 있다. 원격 Storage와 운영 DB에는 변경을 적용하지 않았다.

> 승인된 PG 재편집 ZIP을 비공개로 보관하고 현재 소유자만 내려받게 했습니다. 완료 실패는 바이트와 성공 상태가 함께 롤백됐고, 재시도는 같은 ID를 사용했습니다. Next 서버를 다시 띄운 뒤에도 파일과 SHA가 같았으며 새 편집 후 이전 URL은 차단됐습니다.
