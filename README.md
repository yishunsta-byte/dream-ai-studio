# Dream AI Studio

현재 마일스톤: **P1-8 정적 글자·검수·편집용 ZIP 완료**. 문구와 장면 순서를 새 버전으로 저장하고 필수 검수 후 편집용 묶음을 만들 수 있습니다. 문구 수정은 생성 없이 검수 자격을 무효화하며 이전 ZIP은 보존합니다. 실제 AI 호출·완성 영상 합성은 없습니다. 기록·백업·새 폴더 격리 복원 서비스와 화면은 P1-9 통합 검증 중이며 최종 독립 검수는 아직 남아 있습니다.

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
| worker | 승인된 입력의 샘플 작업을 동시 1개 처리, heartbeat·재시도·복구 지원 |
| db:migrate | data/app.db에 누락된 마이그레이션을 트랜잭션으로 적용. 재실행 시 기존 데이터 유지. 이미 쓰던 DB를 올릴 때는 먼저 `backups/pre-migrate/<시각>_s{전}-s{후}.db` 새 파일로 일관 복사본을 남기고(있는 파일은 덮지 않음, 자동 삭제 없음), 복사본을 못 만들거나 앱·작업기가 그사이 데이터를 쓰면 바꾸지 않습니다. 앱과 작업기를 끈 뒤 실행하세요 |
| db:seed | 빈 DB에만 샘플 프로젝트 1개 추가. 데이터가 있으면 변경 없이 건너뜀 |
| dev:all | 웹·샘플 워커 동시 실행 |

`npm.cmd run dev:all` 또는 웹 서버와 별도 터미널의 `npm.cmd run worker`로 실행합니다. 시드는 선택 사항이며 웹 서버가 자동으로 실행하지 않습니다. 마이그레이션·샘플 설정이 없거나 잘못되면 시작 점검이 차단합니다. API 키는 필요 없으며 향후 비밀값은 `.env.local`에만 저장합니다. `MOCK_MODE=false`면 샘플 생성 요청도 거부합니다. 실제 AI 생성 기능은 없습니다.

샘플 모델 이름과 수동 시험 옵션은 `config/providers.json`에서 읽습니다. 기본은 항상 성공하며 같은 입력·버전은 같은 결과를 만듭니다. 화면에서 콘텐츠 거절·일시 중단·10초 지연·취소 후 도착 시나리오를 고를 수 있습니다. `manualQa.randomFailureEnabled`는 기본 false이며 직접 켠 경우만 `failureRate`(기본0.1)로 일시 오류를 섞습니다. 영상 도구가 없으면 PNG로 대체하고 자료 메모에 표시합니다. 무음 WAV는 실제 음성이 아니며 비용은 0원입니다.

워커는 60초 처리권과 20초 heartbeat를 사용합니다. 비정상 종료 후 처리권이 만료되면 복구하고, 제공자 작업 번호가 있으면 재제출하지 않고 폴링합니다. 재시도 가능한 오류만 30·60초 간격으로 최대3회 시도합니다. 취소 후 도착한 결과는 버전으로 저장하며 자동 선택하지 않습니다. 워커 종료 안내는 마지막 heartbeat 후 최대45초 이내 표시됩니다.

수정·조립은 정적 글자 미리보기와 수동 자막 시간 설정입니다. 광고 표기는 삭제·내용/시간 변경을 막고 위치만 바꿀 수 있습니다. 글자/순서는 settings의 새 스냅샷 행으로 저장하며 이전 행의 수정·삭제는 DB도 거부합니다. 업데이트 후 `npm.cmd run db:migrate`로 0003 보호 규칙을 적용하세요.

검수는 현재 내용 버전에만 유효합니다. 보류 사유는 필수이며 자동 근거만으로 통과하지 않습니다. 내보내기는 워커에서 ZIP64를 스트리밍 작성한 뒤 다시 열어 모든 manifest 파일의 크기·SHA256을 확인합니다. 성공 파일만 내려받을 수 있고 내려받기 직전 ZIP 해시도 재확인합니다. 묶음에는 선택 결과·대본/기획·수동 SRT·글자 설정·출처/생성/검수 기록·Pretendard와 OFL이 들어가며, P1에는 final 영상이 없습니다. 샘플 파일명과 manifest에 샘플을 표시합니다.

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

## 백업과 새 폴더 복원 (P1-9)

설정의 "지금 백업"은 작업을 등록합니다. 작업 처리기가 실제 SQLite WAL 스냅샷과 파일 목록·해시를 ZIP64로 저장하고 다시 검증한 뒤에만 성공으로 표시합니다. 작업 처리기가 켜져 있을 때 서울 날짜 기준 하루 한 번 자동 백업하며 놓친 날짜를 모두 다시 만들지는 않습니다. 외부 백업 위치는 경계·쓰기 검사를 통과해야 하고, 위치 저장 자체가 백업 성공을 뜻하지 않습니다. 현재 확정 방식에는 hard link 지원이 필요하므로 FAT/exFAT 등 일부 외장 디스크에서는 STORAGE_FAILED로 실패할 수 있습니다. 기존 성공 백업을 덮거나 지우지 않습니다.

복원은 성공 백업을 선택하고 **비어 있는 새 폴더**를 검사한 뒤 그 폴더에만 확정합니다. 현재 데이터를 교체하지 않습니다. 진행 중이던 작업은 복원본에서 취소되고 실행 중이던 내보내기·백업은 실패로 남습니다. 복원본의 다음 백업 위치는 복원 폴더 안 backups입니다. 확정 오류가 나면 화면에 유지된 **같은 검사로 다시 확인**하세요. rename이 이미 끝났을 수 있으므로 목적지를 삭제하거나 새 검사로 덮으려 하지 마세요. RESTORE_EXPIRED이면 다시 검사합니다.

복원본을 열 때 앱 **소스 폴더의 cwd는 그대로** 유지합니다. 기존 서버와 다른 loopback 포트를 사용하고, 웹과 작업 처리기에 동일한 DREAM_DATA_ROOT를 지정합니다. 이 환경 변수는 data/storage/backups 위치만 바꾸며 config·migration·fonts 등 앱 리소스는 소스 폴더에서 읽습니다. 빌드된 앱 기준 예시이며 기존 앱의 .next를 사용하는 서버가 실행 중일 때 다시 빌드하지 마세요.

```powershell
# 소스 폴더에서 별도의 웹 터미널
$env:DREAM_DATA_ROOT='D:/MyRestoredStudio'
npm.cmd run start -- --port 3041

# 같은 소스 폴더의 별도 작업 처리기 터미널에도 동일하게 지정
$env:DREAM_DATA_ROOT='D:/MyRestoredStudio'
npm.cmd run worker
```

http://127.0.0.1:3041 을 엽니다. 이미 사용 중인 포트이면 다른 포트를 지정합니다. 원래 데이터에 연결된 서버·작업 처리기의 환경 변수는 바꾸지 않습니다. 정상적으로 복원된 DB에는 필요한 migration이 들어 있으므로 복원본에 마이그레이션을 다시 적용하는 절차는 필요하지 않습니다. 코드 버전과 DB 버전이 다르면 시작 점검에서 멈춥니다. 비밀 키는 기존 원칙대로 .env.local에만 두며 복원 ZIP에는 포함하지 않습니다.

**이전 백업 호환 (K-6).** 검사하기에서 백업의 마이그레이션 기록과 manifest 기록이 같고, 그 기록이 지금 앱 기록의 정확한 앞부분인지 판정합니다. 같으면 "데이터 구조 버전 맞음", 짧으면 "이전 버전에서 만든 백업이에요. 복원하면서 지금 구조로 바꿔요"로 보이고 새 폴더 복원 중에 **복원 사본에서만** 남은 단계를 한 번에 적용한 뒤 다시 검사합니다. 더 새 앱의 백업은 BACKUP_TOO_NEW, 기록이 다르거나 없거나 manifest 형식을 모르면 BACKUP_SCHEMA_MISMATCH로 검사에서 멈춥니다. 원본 백업 ZIP은 읽기만 하며 확정 직전에 해시를 다시 대조합니다(바뀌었으면 BACKUP_SOURCE_CHANGED). 올리기가 실패하면 BACKUP_UPGRADE_FAILED이고 복원 사본은 지워지며 원본과 지금 데이터는 그대로입니다. manifest의 앱 버전은 기록용으로만 보여 줍니다.

고정 가상 백업 s4(`tests/fixtures/backups/`)는 `npm.cmd test`에서 보관 원본 해시·재현·복원·거부·실패 격리 시험에 쓰입니다. 처음 한 번만 `S4_WRITE=1`로 만들며 이미 있으면 거부합니다. 새 마이그레이션을 추가하는 마일스톤은 s4를 덮지 않고 그 시점의 s{n}을 더합니다.

생성·활동 기록은 /history에서 프로젝트별로 50개씩 읽습니다. 입력은 종류·비율·시간·기획 버전, 참조는 자료/캐릭터 식별자 등 필요한 요약만 표시하고 원시 JSON·내부 설정·키·경로·민감 입력 본문을 표시하지 않습니다. 기록을 편집하거나 지우는 기능은 없습니다.
