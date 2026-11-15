# Dream AI Studio

현재 마일스톤: **P1-4 자료·캐릭터 보관함 완료**. 자료를 올리고 출처·권리 메모와 캐릭터 설정을 저장한 뒤 프로젝트에 연결할 수 있습니다. 요구 확인·기획·생성은 이어지는 단계입니다.

서버 시작 시 `docs/spec/menus.json`을 검증합니다. 오류가 있으면 작업실 대신 잘못된 항목 경로와 한글 안내를 표시합니다. 설정 수정 후 서버를 다시 시작하세요. 메뉴 설정을 사용하는 서버 코드는 `lib/menus/server.ts`의 `getMenuConfig()`로 검증된 복사본을 읽습니다. 검증 실패 시 이 함수도 요청을 거부합니다. 정상 화면도 요청 시 렌더링하여 빌드 당시의 정상 화면이 시작 점검 실패를 우회하지 않도록 했습니다.

## 실행

Node.js 22.13 이상인 22.x 또는 24 이상과 npm 10 이상이 필요합니다. 현재 PC의 Node 26에서 검증했습니다. ESLint와 Vitest의 공통 지원 범위에 맞췄습니다.

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run dev
```

브라우저에서 http://127.0.0.1:3000 을 엽니다. 웹 서버는 개발·운영 모두 127.0.0.1에만 바인딩합니다. PowerShell 실행 정책이 npm.ps1을 차단하면 위처럼 `npm.cmd`를 사용합니다. 다른 셸에서는 `npm`을 사용할 수 있습니다.

```powershell
npm.cmd run build
npm.cmd run start
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
```

| 명령 | 현재 동작 |
|---|---|
| dev / build / start | 웹 개발 / 빌드 / 운영 실행 |
| lint / typecheck / test | ESLint / Next 타입 생성과 TS strict / Vitest 단발 실행 |
| test:watch | 테스트 감시 |
| worker | P1-6에서 구현 예정, 현재 안내 후 종료 코드 1 |
| db:migrate | data/app.db에 누락된 마이그레이션을 트랜잭션으로 적용. 재실행 시 기존 데이터 유지 |
| db:seed | 빈 DB에만 샘플 프로젝트 1개 추가. 데이터가 있으면 변경 없이 건너뜀 |
| dev:all | 웹·워커 동시 실행; 현재 워커 미구현으로 둘 다 종료 |

`dev:all`은 워커 도입 전까지 개발 서버 실행에 사용하지 않습니다. 시드는 선택 사항이며 웹 서버가 자동으로 실행하지 않습니다. 마이그레이션이 없거나 기록이 맞지 않으면 시작 점검이 작업실 진입을 차단합니다. API 키는 필요 없으며 향후 비밀값은 `.env.local`에만 저장합니다. `MOCK_MODE=false`일 때만 위 띠의 샘플 모드 표시가 숨겨집니다. 현재 실제 AI 생성 기능은 없습니다.

SQLite는 foreign_keys ON과 WAL을 사용하며, SQL 마이그레이션 파일과 체크섬을 기록합니다. 이미 적용한 SQL 파일을 수정하면 적용이 거부되므로 새 번호의 마이그레이션을 추가해야 합니다. JSON은 zod 경계 함수를 통해 저장·읽기하고 DB도 JSON 문법을 검사합니다. 금액은 안전한 정수 마이크로 단위와 통화로 저장합니다. DB 파일은 Git에서 제외됩니다.

## 구조와 협업

### 미디어 도구

Windows에서는 다음 명령으로 프로젝트의 Git 제외 폴더 `.tools/ffmpeg`에 FFmpeg/ffprobe 9.0.2를 준비합니다. 시스템 PATH나 전역 실행 정책은 변경하지 않습니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-media.ps1
```

설치 스크립트는 FFmpeg 공식 다운로드 페이지가 안내하는 Gyan의 고정 버전 ZIP을 받고 게시된 SHA256을 확인합니다. 라이선스는 같은 로컬 폴더의 LICENSE.txt에 보관합니다. 다른 환경에서는 설치된 ffmpeg/ffprobe를 PATH에 두거나 FFMPEG_PATH/FFPROBE_PATH를 설정하세요.

`/library`에서 PNG/JPG/WebP, MP4/MOV/WebM, MP3/WAV/M4A, PDF/TXT/MD를 등록합니다. 기본 한도는 파일당2GB(MAX_UPLOAD_BYTES로 조정)이며 요청 본문을 파일로 스트리밍합니다. 실제 서명·확장자를 대조하고 이미지는 실제 디코딩, 오디오/영상은 ffprobe로 검사합니다. 링크는 원격 요청 없이 메타데이터만 저장합니다. 보관은 파일을 지우지 않으며 보관한 항목에서 되살릴 수 있습니다. 자료는 public 폴더가 아닌 storage에 저장되고 검증된 라우트에서 내려받습니다.

`app`은 화면, `components`는 공통 UI, `lib/services`는 업무 로직, `lib/domain`은 순수 규칙, `lib/repo`와 `lib/db`는 DB 접근을 맡습니다. 작업·AI·저장소 모듈은 각각 `lib/jobs`, `lib/providers`, `lib/storage`로 분리합니다. DB·파일·비밀을 다루는 구현에는 `server-only` 경계를 적용합니다. 폴더의 `.gitkeep`은 이후 단계의 자리이며 구현 완료를 의미하지 않습니다.

최상위 기준은 [PLAN](docs/PLAN.md), 구현 규칙은 [CLAUDE.md](CLAUDE.md), 실제 검증 기록은 [PROGRESS](docs/PROGRESS.md), 검수 기록은 [REVIEW](docs/REVIEW.md)입니다. 제품 디자인은 플래너의 `docs/design/` 산출물을 따릅니다. 최신 사용자 지시에 따라 단계별 구현과 자체 검증을 연속 수행합니다.

의존성은 정확한 버전과 package-lock.json으로 고정합니다. npm 레지스트리의 engines/peerDependencies와 공식 설치 문서를 확인했습니다. SQLite는 better-sqlite3 13.2.0, ORM은 Drizzle 0.45.4입니다. 개발 부품 모음 `/dev/ui`는 운영 빌드에서 404입니다.
