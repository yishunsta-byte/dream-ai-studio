# T364 비공개 업로드·프로젝트 저장 및 실제 로컬 렌더 확인

2026-11-19 KST · Codes(Backend) · Master 배정 `msg_c039ec5da51b`

소유한 로컬 환경에서 이미지·음악·영상 업로드와 프로젝트 저장을 실제 HTTP로 확인했다. 별도 격리 시험에서 파일 소유권·무결성 검증을 거친 PostgreSQL 저장과, 합성 쇼핑숏츠를 자막 수정 후 실제 Remotion·FFmpeg로 다시 렌더하는 과정도 확인했다.

| 구간 | 확인한 결과 |
| --- | --- |
| 제품 업로드·파일 등록 | 임시 Next 서버·SQLite·로컬 저장소에서 PNG, WAV, 렌더한 MP4를 `POST /api/assets/upload`에 올려 각각 201과 파일 ID를 받았다. PNG 이름의 손상 파일은 400으로 거절됐다. 사진·동영상 필드에 WAV ID만 넘긴 요청은 400이었다. |
| 제품 프로젝트 저장 | 같은 서버의 `POST /api/projects`에 PNG와 MP4의 ID를 제출해 201을 받았다. SQLite를 읽기 전용으로 확인해 프로젝트 1건, 해당 두 파일 연결 및 7개 제작 단계가 저장됐음을 대조했다. 영상의 렌더 및 업로드 검증은 별도의 시험 프로젝트에서 이뤄졌다. |
| 비공개 Storage 검증 및 분석 적용 | 소유 PG17의 비공개 Storage 읽기·프로젝트 저장 시험 19건 통과. 앱 SDK는 루프백 Storage 응답을 통해 실제 바이트를 받았다. 타인 파일과 MIME·크기·해시 오류가 거절되는지와 중단·경합·롤백을 확인했다. 분석 미리보기·적용 및 업로드 프로토콜 시험도 실행했다. |
| 실제 렌더·내보내기 | 실제 Remotion·FFmpeg 작업을 거쳐 합성 쇼핑숏츠 자막만 바꾼 MP4를 만들었다. 기존 장면 생성 결과와 음원은 보존됐다. FFprobe에서 H.264/AAC, 1080×1920, 30fps, 120프레임, 4초를 확인했고 FFmpeg에서 영상·음성 스트림 전체를 오류 없이 디코딩했다. 같은 렌더의 자막 큐를 제품 포매터로 SRT·VTT로 생성했다. 별도 실제 ZIP 회귀에서 SRT·VTT가 저장 타임라인과 일치하는지도 확인했다. |

렌더에 합성 사진·영상·음원을 사용했다. 실제 고객 자료, 실 AI 생성 공급자, 운영 Supabase Storage·DB, 휴대폰 실기기 재생 및 게시·철회는 검증하지 않았다.

## 운영 연결에 남은 코드 경로

- `app/api/assets/upload/route.ts`는 현재 로컬 파일과 SQLite에 등록하며, `app/api/projects/route.ts`의 POST도 로컬에 저장한다. 두 경로 모두 Vercel과 클라우드 조회 구성에서 레거시 쓰기를 닫는다. T361/T362의 조회 경로와 별도로 클라우드 쓰기 요청 조립이 필요하다.
- `lib/services/postgres/project-create-storage.ts`는 검증할 서버 전용 Storage 읽기와 PostgreSQL 생성 로직을 갖췄다. 운영 업로드에는 검증된 사용자 UUID와 비공개 대상 바인딩, 파일 예약·수신·완료·실패 정리, 재시도 책임을 연결해야 한다. 현재 `lib/services/postgres/upload-reservations.ts`의 고정 예약 후보는 소유 합성 환경만 활성화하며 SQL5와 PG18을 전제로 한다. 해당 운영의 현재 DB 버전이 미확인인 상태에서 이 후보의 운영 활성화 여부를 판정할 수 없다.
- 최소 변경 후보는 위 두 API 라우트와 신규 서버 전용 요청 조립 모듈이다. 이 범위로 운영 저장 공급원을 연결하려면 승인된 운영 역할·비공개 Storage 대상·DB 버전 및 예약 방식부터 대조한다. 분석 API·저장 경로와 Front 계약 변경이 필요한 경우 해당 점유를 별도로 확인한다. 이번 작업에서 제품 파일은 수정하지 않았다.

## 실행 기록

- 제품 HTTP 시험은 고정 Git 사본·임시 SQLite·로컬 Storage에서 실행했다. 임시 Next 서버와 DB를 정리했다. 로컬 실행 스크립트는 무시 경로 `tmp/t364-local-path-probe.mjs`에 남겼다.
- `node tests/postgres/run-project-create-storage-local.mjs --bin .tools/t253-postgres-17.12/pgsql/bin` 19건 통과. 소유 PG17 종료 확인.
- `DREAM_RENDER_E2E=1`과 `T172_SAMPLE_OUT`을 지정한 `tests/t172-text-only-rerender-e2e.test.ts` 4건 통과. MP4, 렌더 메타데이터, 동일 큐의 `.srt`·`.vtt`는 로컬 `tmp/shopping-shorts-verification-20261119-213108/`에 보관했다.
- 내보내기·편집·레거시 차단·분석 저장소 회귀 156건 통과·조건부 1건 건너뜀. 분석 적용·미리보기·업로드 프로토콜 70건 통과·조건부 2건 건너뜀.
- 공개 홈 후보 `2511a1e`는 T365에서 반영 경로와 복귀 준비를 대조했다. 실제 작품 승인·게시와 운영 배포는 후속이다. [T365 인계](T365-PUBLIC-SHOWCASE-FIRST-WORK-READINESS.md)

> T364 소유 로컬 제품 POST, 비공개 Storage 검증 및 프로젝트 저장, 자막 수정의 실제 MP4 재렌더와 SRT·VTT를 확인했습니다. Tester 독립 검수를 요청합니다. 운영 쓰기는 현재 로컬 POST와 별도의 조립 및 승인된 Storage·DB 역할/버전 판정이 필요합니다.
