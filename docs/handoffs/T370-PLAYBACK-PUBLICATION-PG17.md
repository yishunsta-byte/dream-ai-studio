# T370 공개 미디어 게시 및 PostgreSQL 검증

2026-11-19 KST · 기준 `942d5ad` · 로컬 자체 검수

게시 서비스는 렌더 증빙의 소유자, 작품, 결과물 ID·리비전·SHA를 권리와 표지 증빙에 대조한다. 완료 직전에 세대별 비공개 객체 전체를 구간으로 읽어 SHA-256을 재계산한다. 모든 구간의 강한 ETag·범위·길이가 일치하고 권리가 유효해야 게시된다. 게시 목록에는 종류와 확장자만 추가한다.

| 구성 | 경로와 동작 |
|---|---|
| 렌더 파일 검증 | `scripts/inspect-publication-media.ts`, `rendered-media-evidence.ts`. 한 비공개 사본에서 해시, 바이트 수, 컨테이너, 트랙 종류와 코덱을 확인한다. MP4 영상은 moov가 mdat 앞에 있어야 한다. |
| 서버 게시 및 조회 | `admin-publication-service.ts`, `publication-verified-adapters.ts`. 확정된 렌더 증빙과 현재 결과물을 결합한다. 원본 또는 저장소 버전 변경은 해당 세대 게시를 차단한다. |
| 위임 설치 | `lib/db/postgres/publication/delegated/0002_playback.sql`과 `probe.ts`. 설치 API의 마지막 인수로 3을 선택하면 기존 v2 SQL과 이력·카탈로그를 확인한 뒤 v3를 트랜잭션으로 설치한다. 기본 인수는 2다. 기존 v2 봉인 및 이미지 읽기를 지원한다. |
| 권한 | `t295.find_media(text,bigint)`를 사용할 수 있는 런타임 역할은 파일 조회 역할이다. 활성 세대의 미디어 manifest와 고정된 권리·표지 manifest가 일치해야 내부 객체 키가 나온다. |

렌더 호스트에서 `node --conditions=react-server --import tsx scripts/inspect-publication-media.ts <렌더_파일>`을 실행한다. 출력된 증빙의 SHA와 게시할 결과물 SHA를 대조한다. 기존 게시 권한 운영자가 이 증빙에 결과물 ID·리비전, 소유자, 작품, 세대별 객체 키와 강한 저장소 ETag를 결합해 `t293.evidence.media`를 준비한다. 권리 manifest에는 같은 종류·확장자·MIME·크기·해시·ETag가 필요하다. 실제 작품의 증빙 준비와 비공개 버킷의 불변 버전 보장은 운영 입력이다.

### 자체 검증

- 서명된 PG17.12 도구로 격리된 TLS 클러스터를 실행했다. `node --conditions=react-server --import tsx tests/public-showcase/t328-publication-db-preflight.pg17.ts --delegated-publication-installer`에서 기존 v2 봉인, 이미지 게시와 철회를 통과했다.
- 같은 명령의 `--playback-publication-installer` 모드에서 v2→v3, 실제 FFmpeg MP3의 렌더 증빙, 준비 상태 404, 같은 크기 변조 파일의 게시 거절, 정상 게시 후 206의 실제 24바이트 일치, 만료·고정 manifest 불일치·철회 후 404를 확인했다. 관리자와 목록 로그인은 `find_media` 실행이 거절됐다. 테스트 종료 시 해당 클러스터와 리스너를 정리했다.
- 렌더 검사 명령으로 H.264 MP4, VP9 WebM, MP3, AAC M4A를 확인했다. moov가 뒤에 있는 MP4는 검사에서 거절됐다. 기존 관리자 서비스 Vitest 14건 및 변경 경로 ESLint가 통과했다.

관리형 DB·Storage에서의 설치와 실제 작품 게시, Vercel 배포·전송량 실측은 이 검수에 포함되지 않는다. 대용량 게시 완료 시 전체 무결성 검사를 위한 객체 읽기와 DB 트랜잭션 시간이 필요하므로 운영 크기·플랜 한도 실측이 남아 있다.

> 플래너 전달문 — 공개 재생 게시 경로를 격리 PG17에서 연결했습니다. 렌더 해시와 저장소 버전을 확인했고, 구간 응답 및 만료·철회 차단을 재현했습니다. 운영에서는 비공개 버킷의 버전 동작, 실제 작품의 증빙, DB 설치·봉인과 Vercel 실측이 남았습니다.
