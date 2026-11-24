# 로컬 PG MP4의 한글 자막과 필수 표기

## 구현 범위

자막 저장 `0dbc51d`, 두 PNG 렌더 `2b892d9`, 새 프로젝트 종단 `b3a97be`를 이어, 승인된 PG 타임라인의 글자를 기존 Remotion 컴포지션으로 합성한다. 저장된 글꼴과 스타일을 쓰며 검증한 PNG와 작업 전용 글꼴 복사본만 루프백으로 제공한다. 글자가 없는 영상은 기존 FFmpeg 경로를 쓰고, 두 경로 모두 기존 WAV 믹싱과 MP4 검증 및 16MB 상한을 적용한다.

광고·AI 생성·가상인물 표기가 필요한 프로젝트에서는 현재 PG 타임라인 입력을 검사한다. 해당 잠긴 표기가 없거나 전체 장면 구간을 덮지 않으면 실행이 HTTP 409 `RENDER_REQUIRED_DISCLOSURE_MISSING`으로 종료된다. 브라우저 및 글꼴 문제는 `RENDER_BROWSER_UNAVAILABLE`, `RENDER_FONT_MISSING`으로 반환한다. 로컬 검증 DB의 읽기 역할에 소유자 프로젝트 설정 열 조회를 추가했다.

## 변경 경로

- `lib/render/local-pg-still-render.ts` 글자 렌더 분기, 핀 검사, 작업 전용 파일 서버 및 기존 WAV 믹싱 연결.
- `lib/render/props.ts` SQLite 준비 단계와 PG 양쪽에서 쓰는 컴포지션 입력 필드.
- `lib/render/local-pg-wav-input.ts`와 `lib/db/postgres/private-wav-upload/render-input.sql` 승인 버전의 타임라인과 필수 표기 입력 확인.
- `lib/cloud/local-render-execute.ts` 필수 표기 실패 코드와 HTTP 상태.

## 실제 로컬 Next·PG17.12 검증

- `63c8ed9` 격리 사본에 변경 파일을 반영했다. `D:/starwork/p2-pg-first-work-e2e`의 `tests/postgres/first-work-e2e.probe.mjs`에서 서로 다른 PNG 두 장과 WAV를 같은 새 프로젝트에 연결했다. 브리프·기획·제작·자막 저장·검수 승인·렌더는 실제 제품 경로를 사용했다. DB 직접 조회는 결과 확인에 사용했다.
- 광고 설정이 켜진 상태에서 표기 없이 검수 승인한 r5는 실행 HTTP 409였다. 파일 조회는 404였다. 한글 자막 저장으로 r6이 됐고 이전 렌더를 다시 요청하면 409였다. r6을 다시 검수·승인한 뒤 390px Chrome에서 요청·실행·다운로드했다.
- 한글 두 줄의 저장 구간은 `[15,70)`였다. 페이드가 있는 기본 스타일에서 두 줄 모두 판정 임계값을 넘긴 범위는 0부터 센 15~67프레임이었다. 마지막 구간 차이는 2프레임이다. 30프레임을 열어 두 줄 원문과 ‘광고’를 직접 읽었다. 광고는 0~89프레임에 표시됐고 빈 대조 영역은 0건이었다. 프레임 29·30·89의 중심 RGB는 `[254,0,0]`, `[0,1,255]`, `[0,1,255]`였다.
- MP4는 H.264 1080×1920·30fps·90프레임·3초와 AAC-LC 48kHz 스테레오 1트랙이었다. 모노 디코드 144,000샘플에서 600Hz 음원과 이후 무음을 확인했다. 71,614바이트 SHA-256 `c86f5e51dc67f554129518ecbcc537f010c5e4b496ee18e63c46cb58597a1930`이 응답과 DB에 일치했다. 타 계정 다운로드는 404였다.
- 글자 렌더 프로필을 만든 뒤 실행 요청을 중단했다. 작업이 `RENDER_CANCELED`로 기록됐고 임대·임시 폴더가 정리됐다. 출력 0건이었다. 같은 작업을 재실행하고 성공 응답을 다시 조회해 DB 시도 2회, 완료·결과 각 한 건을 확인했다.
- 같은 실행에서 한글과 필수 표기가 없는 새 프로젝트의 두 PNG·WAV 렌더도 통과했다. 90프레임 MP4의 장면 경계와 SHA를 확인했다.

`npm.cmd run typecheck`, 변경 TypeScript ESLint, 관련 Vitest 5파일·53건 통과. 격리 시험은 `T371_VERIFY_HTTP=1`, `T371_VERIFY_RENDER_AUDIO=1`, `T371_VERIFY_FIRST_WORK_ONLY=1`, `T371_VERIFY_FIRST_WORK_MODE=two`, `T371_VERIFY_FIRST_WORK_CAPTIONS=1`, `T371_VERIFY_FIRST_WORK_CANCEL=1`로 `node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs`를 실행했다. 운영 환경과 실사용 작품에 대한 검증은 후속이다.

> 승인된 PG 쇼핑 숏폼의 한글 두 줄과 잠긴 광고 표기를 실제 MP4에 합성했습니다. 390px Chrome 다운로드에서 두 PNG 컷, 90프레임, AAC와 DB SHA를 확인했습니다. 표기 누락은 실행 409, 렌더 중단은 임시 폴더·임대를 정리했고 같은 작업 재실행은 출력 한 건을 남겼습니다. 독립 검수는 이 고정본에서 이어갈 수 있습니다.
