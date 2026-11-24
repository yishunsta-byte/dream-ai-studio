# 비공개 WAV 업로드와 소유자 조회

Master 배정 `msg_67617edd9b4c`. 로컬 PG17에서 1 MiB 이하, 8–192 kHz, 모노·스테레오 16비트 정수 PCM WAV를 지원한다. RIFF 크기, fmt·data 청크 경계와 중복, 채널별 프레임 정렬, 샘플 속도와 바이트 속도를 검사한다. 파일의 샘플 수로 재생 시간을 계산한다.

기존 `DREAM_PRIVATE_UPLOAD_BACKEND=owned-pg17` 환경에서 `POST /api/assets/upload?format=wav&filename=track.wav&rightsNote=...`에 소유자 세션, UUIDv7 Idempotency-Key, 파일 원문을 전달한다. 성공 응답의 id로 `GET /api/assets/<id>?format=wav`를 호출한다. 요청 번호는 WAV 업로드 범위에서 계정별로 관리한다.

| 검증 | 로컬 Next + PG17 결과 |
|---|---|
| 등록 | 합성 8 kHz 모노 100ms WAV를 올려 audio 자산과 제목, 음원 길이, 한국어 권리 메모를 확인했다. |
| 재시도 | 동일 요청을 동시에 보내도 같은 ID를 반환했다. 같은 번호에 다른 바이트 또는 메모를 보내면 409였다. |
| 실패 복구 | 자산 INSERT 실패를 주입해 검증 바이트와 등록 행이 함께 롤백되는지 확인했다. 동일 키 재시도는 201이었다. 잘린 데이터는 400, 크기 초과는 413이었다. |
| 비공개 조회 | 본인의 전체 응답 및 206 구간을 원본과 비교했다. 타인은 404, 익명은 401이었다. 두 계정이 같은 요청 번호를 써도 파일 ID는 달랐다. |
| 기존 흐름 | 쇼핑숏츠 제품 사진 입력에서 WAV를 거절했다. PNG 업로드·권리 메모·프로젝트 생성·조회도 통과했다. |

SQL4 영상·이미지 검증 기록은 양수 폭·높이를 요구한다. 이번 로컬 경로에서는 제한된 역할과 행 보안이 적용된 PG 테이블에 검증 원문·메타데이터를 보관하고, 같은 트랜잭션에서 dream.assets에 등록한다. 인증·Storage 운영 연결, 외부 게시, 공개 플레이어 및 제품 폼은 별도다. 메뉴 정의에서 playlist.tracks 및 music-video.track이 음원 입력이다. 실제 음악 프로젝트 생성과 렌더는 이번 시험 범위 밖이다.

```powershell
$env:T371_VERIFY_HTTP='1'
node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs
```

관련 Vitest 1,171건 통과, 조건부 제외 300건. TypeScript 소스 576개 오류 0건. 변경 서버·시험 모듈 ESLint 통과.

[검증 등록 및 조회](../../lib/cloud/local-private-wav.ts) · [로컬 PG 스키마](../../lib/db/postgres/private-wav-upload/local.sql) · [HTTP 통합 시험](../../tests/postgres/private-wav-http.mjs)

## Tester 독립 검수

2026-11-19에 위 명령을 로컬 Next.js와 새 PG17 클러스터에서 실행했다. 등록·조회 코드와 WAV 시험은 `a7eae8d`와 일치했다. 100ms 합성 PCM 음원의 메타데이터 보존, 동시 제출 시 동일 ID, 다른 바이트·메모의 409를 확인했다. 등록 실패 직후 잔존 파일 행은 0건이었고 같은 키로 재시도하면 201이었다. 소유자 전체 응답과 44–51번 바이트의 206 응답이 원본과 일치했고 타인 404·익명 401이었다. PNG 회귀와 클러스터 정리를 포함해 종료 코드 0이었다.

브라우저에서 미지원 코덱을 골랐을 때의 미리듣기 오류와 편집 초안 복구는 기존 [3104559 검수](P2-AUDITION-UNSUPPORTED-CODEC.md)를 근거로 사용했다. 이번 재실행은 비공개 PCM 등록·조회 API에 해당한다.
