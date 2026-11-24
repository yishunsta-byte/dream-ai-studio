# T370 공개 재생 HTTP와 화면 검수

2026-11-19 · 기준 c6c49c5와 T370-B 설계 · Codex 자체 검수

공개 목록은 활성 세대의 slug, generation, 매체 종류와 확장자로 정규 주소를 조립한다. 기존 표지만 있는 행도 표시한다. 게시, 권리, 저장소 조건을 확인한 공급원이 활성일 때만 MP4·WebM·MP3·M4A를 내려준다.

## 구현

- 공개 목록과 기존 플레이어의 연결은 `lib/public-showcase/showcase-source.ts`, `published-works.ts`, `playback-path.ts`가 담당한다. 표지 권한 공급원과 같은 연결 및 sealed runtime에서 매체 권한도 재확인한다.
- `playback-source.ts`는 GET 전체, 단일 Range, HEAD, If-Range, 416을 처리한다. 비공개 원본에서 최대 256 KiB씩 읽고 그 구간과 전체 길이, 강한 ETag, 실제 수신 바이트 수를 대조한다. 각 구간을 보내기 직전에 게시 상태와 권리, 버전을 다시 조회한다.
- Next 16.4.6의 App Router는 응답 길이 헤더를 삭제한다. 정규 공개 경로를 `next.config.ts`에서 `pages/api/publication-playback.ts`로 내부 연결했다. 인증 프록시는 정규 요청을 검사하고 내부 주소 직접 접근과 외부에서 넣은 라우팅 헤더를 거부한다. Node 초기화는 `instrumentation.ts`와 `playback-http-runtime.ts`에 있다. Node 응답은 길이 헤더와 스트림 중단을 보존한다.
- `components/studio-shell.tsx`는 Next의 혼합 라우터 타입에서 현재 경로가 준비되기 전에도 기존 기본 제목을 표시한다.

## 확인 결과

| 검사 | 확인한 결과 |
|---|---|
| `node_modules/.bin/vitest.cmd run tests/public-showcase` | 14파일 157개 통과. 잘못되거나 여러 개인 구간, 접미 구간, 권한 없는 요청의 크기 은닉, 비공개 원본의 버전·범위·길이 오류, 권리 재확인, 최초 바이트 제한과 요청 중단 포함 |
| 실제 Next 16.4.6 HTTP, faststart MP4 | 6,751,180바이트 전체 GET의 상태 200, 길이 헤더와 실제 길이 및 원본 SHA-256 일치. If-Range도 동일한 전체 길이와 200 |
| HTTP 단일 구간 및 HEAD | 3,376,406바이트 MP4에서 55–77 구간의 206과 길이 23 확인. HEAD에 동일 Range를 보내면 200, 전체 길이 3,376,406, 빈 본문 |
| 전송 중 철회 | 6,751,180바이트 GET에서 클라이언트가 첫 64 KiB를 읽은 뒤 권한 철회. 총 262,144바이트에서 HTTP 불완전 전송 오류 확인. 다음 요청은 충족 불가능한 Range라도 404, 크기 헤더 생략, no-store |
| 격리 Chromium 및 실제 Next | 1280px에서 15초 MP4를 재생하고 8초로 이동. 390px에서 M4A를 재생하고 5초로 이동. 표지를 받지 못한 상태에서도 두 파일 모두 재생됐다. 320px에서 철회된 음악은 재생 오류 안내를 표시했다. 재시도도 404였고 Esc로 상세를 닫으면 기존 작품 버튼으로 초점이 돌아왔다 |
| 이미 받은 데이터 | 같은 탭의 기존 영상 버퍼는 철회 후에도 남을 수 있음을 확인했다. 서버가 철회 직후 막는 단위는 새로 전송하는 바이트다 |

HTTP·브라우저 검수에는 격리한 로컬 Next, FFmpeg로 생성한 영상·음악, 교체 가능한 로컬 권한 공급원을 사용했다. 이 검수의 전송량은 Vercel 실측값과 구분한다. Vercel 공식 제한 문서는 일반 함수 응답 한도가 4.5 MB이며 스트리밍 응답이 예외임을 명시한다. 실제 플랜에서의 실행 시간, 비용, 모바일 Safari 및 Android 기기 동작과 운영 저장소 버전 고정은 아직 별도 확인 대상이다. [Vercel Functions 한도](https://vercel.com/docs/functions/limitations#request-body-size)

## 플래너 전달문

T370 공개 영상·음악 재생의 로컬 HTTP와 화면 자체 검수를 마쳤습니다. 6.75 MB 전체 전송, 단일 구간, 헤더 길이, 철회 후 전송 중단과 다음 요청 차단을 확인했습니다. 운영 승인은 실제 게시 권한·불변 저장소와 Vercel 배포에서 같은 동작을 재현한 뒤 판단해 주세요.
