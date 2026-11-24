# T334 게시 표지용 비공개 Storage 읽기

2026-11-19 KST · Codes(Backend) · 기준 `146b68f` · Master 배정 `msg_c78a1e6c28f7` · 공용 설정 변경 승인 `msg_fd1be21d28e8`

`createPublicationCoverStorageReaders()`는 T332가 받는 두 서버 전용 함수 `readAdminCover`와 `readPublicCover`를 반환한다. 서버에서 전달한 프로젝트·자격·제한을 검증하고, 후보 고정 버킷 `publication-covers-private`과 정규 `slug/generation/<sha256>.webp` 키만 사용한다. 관리자 읽기에는 서버 설정에 바인딩된 운영자 UUID도 필요하다. 환경변수와 HTTP 요청에서 프로젝트·자격·버킷을 선택하는 기능은 없다. [표지 읽기](../../lib/public-showcase/publication-cover-storage.ts)

기존 자산 리더는 `ownerId/assets/uuidv7/<sha>` 및 사전 검증된 정확한 크기를 요구한다. 이번에는 두 리더가 프로젝트 URL·TLS 대상 형식·자격·한도 검증을 공유한다. 기존 UUID·소유권·정확한 크기·MIME·해시·임시 파일 검증은 기존 자산 리더 경로에 남아 있다. [공유 설정 검증](../../lib/storage/supabase/config.ts)

표지 리더는 Supabase SDK의 버킷 조회와 인증된 객체 다운로드만 수행한다. 두 GET의 대상 주소를 각각 고정하며, 실제 버킷 응답에서 ID 일치와 `public: false`를 확인한 뒤 객체를 읽는다. 리디렉션과 압축 응답을 거절한다. 버킷 메타데이터는 64KiB, 표지 본문은 서버·호출자 한도 중 작은 값과 최대 5MiB 안에서 메모리로 스트리밍한다. 중단·시간 초과·초과 크기·실패 때 스트림을 취소하고 동시 읽기 슬롯을 돌려준다. 임시 파일을 생성하지 않는다.

관리자 호출에서 실제 객체 GET의 404만 `null`로 돌려준다. 공개 읽기와 나머지 오류는 고정 코드로 반환하며 자격, 객체 경로, 제공자 오류 본문은 응답에 포함하지 않는다. T332는 저장소 읽기 전 DB에서 승인 세대와 크기를 확인하고, 기존 표지 응답 코드는 바이트의 SHA-256과 이미지 형식을 검증한 뒤 현재 권한을 다시 확인한다. 표지 리더는 이 DB 권한 검사 뒤에 쓰는 서버 의존성이다. [T332 어댑터](../../lib/public-showcase/publication-verified-adapters.ts) · [표지 응답](../../lib/public-showcase/cover-source.ts)

## 자체 검증

설치된 Supabase SDK와 소유한 `127.0.0.1` HTTP 서버를 사용했다. 정규 키와 두 GET, 비공개 버킷 확인, 관리자 UUID 바인딩, 요청·설정 한도, 헤더 및 청크 초과, 리디렉션, 오류 구분, 스트림 중단·시간 초과와 슬롯 반환을 검증했다. 제공자 바이트가 변하면 기존 응답 코드가 503을 반환하고, 바이트 읽기 뒤 승인 상태가 바뀌면 404를 반환하는 것도 확인했다. 시험 리스너를 종료했다. [전용 시험](../../tests/public-showcase/publication-cover-storage.test.ts)

전용 루프백 사례 14건을 포함해 기존 Storage·관리자·공개 회귀 376건이 통과했고 20건은 실행 조건에 따라 건너뛰었다. 변경 TypeScript ESLint와 생성된 `.next` 검증 파일을 제외한 소스 525개 진입 파일의 타입 검사도 통과했다.

## 인계

이번 변경은 읽기 후보를 구현했다. 운영 후보가 사용할 실제 버킷·제한 자격 발급, 객체 등록, 운영 설정과 배포는 후속 범위다. 서버가 공급하는 서비스 자격을 공통 설정이 검사하며, 이번 시험에서는 합성 자격만 사용했다.

> T334 게시 표지용 비공개 Storage 리더를 구현했습니다. 격리 루프백에서 실제 SDK 호출과 고정 키·버킷 검사, 크기 제한, 중단과 정리, T332 표지의 해시·권한 경계를 확인했습니다. Tester 독립 검수를 요청합니다.
