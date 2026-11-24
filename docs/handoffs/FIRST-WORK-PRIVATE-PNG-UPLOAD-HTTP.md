# 첫 실작품 비공개 PNG 업로드와 프로젝트 저장

Master 배정 `msg_51ae929cac05`. Codes(Backend)가 기존 로컬 앱의 두 HTTP 경로를 연결했다.

| 요청 | 조건과 결과 |
|---|---|
| POST /api/assets/upload | 서버에서 확인한 계정과 업로드별 UUIDv7 Idempotency-Key, 최대 1 MiB의 PNG 원문을 받는다. 최초 바이트 길이·SHA-256·권리 메모에 요청을 묶고, 이미지 디코딩·최종 파일 검증 및 등록 후 201과 파일 id를 반환한다. |
| 업로드 재시도 | 같은 계정·요청 번호·바이트로 재시도한다. 기존 성공은 같은 id, 다른 내용은 409다. 다른 계정이 같은 번호를 사용하면 별도 소유 파일로 등록한다. |
| POST /api/projects | 업로드가 반환한 id를 쇼핑숏츠 inputs.productAssets에 넣고 프로젝트 생성용 요청 번호를 보낸다. 타인 파일을 거절하며, 같은 생성 요청을 반복하면 같은 프로젝트 id를 반환한다. |
| 실패 정리 | 최종 쓰기 응답 유실 및 등록 뒤 임시 파일 삭제 503을 발생시켰다. 재시도 뒤 파일 하나가 등록되고 임시 바이트와 미처리 정리 항목은 사라졌다. 잘못된 PNG에서 첫 삭제가 실패한 경우도 재시도 후 파일 미등록·임시 바이트 삭제·종료 상태를 확인했다. |

로컬 실행기는 T371의 PG17 포트·시험 암호·검증자 설정에 `DREAM_PRIVATE_UPLOAD_BACKEND=owned-pg17` 및 `DREAM_OWNED_UPLOAD_ORIGIN`(T367 루프백 쓰기 저장소 주소)을 추가한다. 프로젝트 읽기용 Storage SDK 주소는 T371의 별도 설정을 따른다. 기본 설정에서는 기존 SQLite 업로드를 사용한다. 선택형 경로는 기존 rightsNote 입력의 앞뒤 공백을 제거하고 최대 500자로 검증한다. 검증된 비공개 파일 등록과 같은 트랜잭션에서 dream.assets.rights_note에 저장한다. 빈 메모는 NULL로 저장하며 기존 메모 없는 요청과 호환된다. 메모를 변경하거나 삭제해 같은 업로드 요청 번호로 다시 보내면 409이고 최초 메모가 보존된다. 새 HTTP 업로드의 파일명은 디렉터리를 제거하고 NFC로 정규화해 자료 제목에 저장한다. 같은 요청 번호에서 다른 제목은 409로 거절한다. 제목 기록 도입 전의 요청은 기존 바이트·권리 메모로 재시도할 수 있다. 저장 키는 소유자·파일 ID·내용 해시로 정한다. 브라우저 업로드 화면의 요청 번호 전달, 음원·영상 및 실제 Supabase 연결은 후속 범위다.

## 재현

```powershell
$env:T371_VERIFY_HTTP='1'
node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs
```

실제 Next 서버와 프록시, 루프백 인증 및 Storage, 격리 PostgreSQL 17에서 수행했다. 익명 401, 요청 번호 누락 400, 크기 초과 413, 잘못된 바이트 400, 변경된 재시도 409를 확인했다. 한국어 메모가 응답 유실 뒤에도 DB에 보존되고 다른 소유자의 빈 메모와 분리되는지 확인했다. 501자 및 널 문자는 예약 전 400이었다. 시험이 업로드 HTTP 응답의 실제 id를 프로젝트 HTTP 요청에 전달했고, 프로젝트 한 개와 단계 일곱 개, 파일 연결·활동 기록·생성 결과 각 한 건이 저장됐다. 같은 실행에서 기본 SQLite 업로드 및 프로젝트 생성도 성공했다. 관련 Vitest 1,171건 통과와 조건부 제외 300건, 변경 경로 ESLint 통과, 생성된 Next 파일 제외 TypeScript 568개 파일 오류 0건을 확인했다.

[업로드 처리기](../../lib/cloud/local-private-image-upload.ts) · [실패 및 재시도 시험](../../tests/postgres/private-png-upload-http.mjs) · [프로젝트 저장까지의 HTTP 시험](../../tests/postgres/t371-project-create-http.mjs)
