# T-010 인계 · 설정·백업/복원·기록 UI와 API

2026-11-16. 기준 HEAD `a1926ae1e7a18c330a9f6d2867f0aa80d73d8016`와 T-007~T-009 미커밋 구현. AGENTS.md, TEAM T-010/T-003/T-006, PLAN P1-9/K-5, DESIGN 6.7을 기준으로 기존 (studio)·components/ui를 재사용했다. 구현 전 로컬 Next16 문서의 route handler, page의 Promise searchParams, output tracing 설정을 읽었다. **구현 자체검증이며 최종 P1 독립 검수가 아니다.**

## 구현 내용

### 설정 `/settings`

- 준비 placeholder 대신 실제 백업 위치 읽기/저장, worker 켜짐/꺼짐, 마지막 성공·실패 시각, 수동 백업 enqueue, 검증된 백업 목록을 표시한다.
- 위치 저장 성공 메시지는 "백업 위치만 저장했어요"이며 실제 백업 성공과 구분한다. hard link를 지원하지 않는 일부 외장 디스크에서는 실제 백업이 실패할 수 있음을 위치 설명에 표시한다. 위치 저장을 실제 백업 검증 완료로 표시하지 않는다.
- 검증된 backup ID 선택·새 빈 폴더 입력 → 검사 → 프로젝트/자료/파일/대기작업 수·만료·목적지 요약 → 같은 ticket으로 확정한다. pending 중단 및 복원본 backups 분리 안내를 포함한다.
- 확정 성공 후 "지금 데이터는 그대로예요", 복원본 위치, 별도 포트의 복원본 웹·worker 실행 방법을 표시한다. 입력 destination은 PowerShell single quote를 escape해 예시 명령에 넣는다. 현재 서버/worker를 자동 실행하거나 환경을 전환하지 않는다.
- 실패하면 ticket을 유지하고 같은 ticket으로 다시 확인하도록 한다. RESTORE_EXPIRED만 ticket을 해제하고 재검사를 허용한다. 이미 ticket이 있으면 백업/목적지 입력과 새 inspect 버튼을 잠그므로 rename 후 오류에 새 ticket으로 덮거나 목적지를 삭제하지 않는다. 자동 삭제 동작은 없다.
- public ticket DTO는 strict client schema로 검사해 sessionStorage에 보관하고 화면 재진입/새로고침 시 같은 ticket을 회복한다. staging/manifest/내부 setting은 저장하거나 표시하지 않는다. sessionStorage가 차단되면 현재 화면의 state만 유지한다.
- 백업 active queued/running 동안 `/api/backups`만 2초 간격으로 갱신한다. idle에는 멈추며 명시적 상태 새로고침을 제공한다. 복원 검사·확정의 자동 반복 호출은 없다.
- 실제 AI 연결·예산은 P3 잠금이며 키 입력/실제 AI 요청이 없다. 샘플 모드가 꺼져 있으면 생성 잠김으로 표시한다. 복원본의 restore.info는 허용된 백업/복원 날짜 두 필드만 읽어 앱 정보에 "이 데이터는 ○월 ○일 백업에서 복원했어요"로 표시한다.
- labels, role=alert/status, loading/disabledReason과 시작 점검 실패 안내를 사용했다. 정상/오류 페이지에도 h1을 둔다. 경로와 명령은 작은 화면에서 줄바꿈한다.

### 생성·활동 기록 `/history`

- 서버 읽기 전용 화면. `type=generation|activity`, `page=1...1000000`, 선택적 `projectId=UUIDv7` 필터. 50개 pagination과 전체 수/이전·다음 링크를 제공한다. 중복 배열 page·지수/소수·잘못된 project ID·알 수 없는 query key는 거부한다.
- generationInputSchema로 입력 snapshot을 검증하고 종류/비율/시간/기획 버전만 표시한다. reference snapshot은 같은 schema의 refs/characters 규칙으로 읽고 UUID 자료/캐릭터 식별자와 개수만 반환한다. description/dialogue/rightsNote/lockedJson/voiceProfileJson/원시 params/ref JSON은 내보내지 않는다.
- 제공사는 샘플 제공자 또는 기록된 제공사로, 모델은 현재 P1의 허용 sample 모델 이름만 그대로 표시하고 다른 값은 "기록된 모델"로 요약한다. 상태·샘플·실패/취소·생성/종료 시각·결과 자료 링크와 프로젝트 링크를 표시한다. 실패 메시지도 원시 제공자 오류 대신 고정 요약을 쓴다.
- activity는 action별 고정 한글 요약 또는 "변경 기록"을 사용한다. 허용 UUID id와 안전 정수 revision만 요약에 포함하며 detailJson/알 수 없는 action 원문/경로/내부 key를 출력하지 않는다.
- 프로젝트/장면 label도 경로·키/토큰·이메일/전화 패턴과 과도한 길이를 방어적으로 숨긴다. 이는 입력 본문을 공개하는 기능이나 범용 개인정보 탐지 서비스를 뜻하지 않는다. 원본 snapshot은 DB에 그대로 보존하며 읽기 화면에서만 최소화한다.
- 기록 편집/삭제 버튼·설정 목록 API는 추가하지 않았다.

### 작업실·탐색·작업 목록

작업실에 최근 성공/실패 백업과 최근 성공 내보내기5건의 링크를 추가했다. 현재 자료 경로를 반환하지 않는다. 시작 점검이 실패하면 작업실/settings/history/jobs는 추가 데이터 조회 전에 안내를 반환하며 jobs GET도 같은 gate를 둔다. 최근 작업 요약 조회 실패가 작업실 전체를 멈추지 않도록 했다.

주 메뉴·settings·jobs에 생성/활동 기록 링크를 추가했다. jobs의 backup은 음성/편집용 묶음으로 표시하지 않고 백업 제목, 백업 완료 toast, 백업 취소 문구와 settings 링크를 사용한다. backup 오류/제공사 DTO를 고정 안전 문구/local로 제한해 내부 operation path가 client props나 API에 실리지 않도록 했다. retryable 계산/실제 job claim 정책은 바꾸지 않았다. 작업 목록 polling은 active job이 있을 때만 실행하며 idle에는 새로고침 버튼을 사용한다. shell count는 화면 이동 시 한 번 확인하고 active가 있는 동안만 계속 갱신한다.

## Route 계약

| Route | Body/반환 | 정책 |
|---|---|---|
| GET `/api/backups` | BackupsData + workerOnline | no-store, startup 실패면 DB 목록을 읽지 않고503. directory/settings/job input은 없음 |
| POST `/api/backups` | strict `{}` → `{id,jobId,duplicate}` | 202, 기존 requestBackup wrapper 사용. filepath/kind/settings 입력 금지 |
| PATCH `/api/backups/configuration` | strict `{directory:string}` → `{directory:canonicalPath}` | 설정 화면에 명시 허용한 실제 path 필드만. 기존 configureBackupDirectory 사용 |
| POST `/api/restore/inspect` | strict `{backupId:UUIDv7,destination:string}` → T-009 allowlist DTO | 임의 archivePath/manifest/staging 추가 입력 거부. 기존 inspectRestore wrapper |
| POST `/api/restore/finish` | strict `{ticketId:UUIDv7}` → 같은 allowlist DTO | 기존 finishRestore wrapper. destination/path/manifest를 다시 받지 않음 |
| `/history` | Promise searchParams에서 strict query 검증 | 서버 페이지 조회, 범용 history/settings JSON API는 만들지 않음 |

모든 추가 API는 nodejs이며 기존 mediaErrorResponse 패턴과 WorkflowError status/code를 사용한다. malformed JSON/추가 필드/형식 오류는 한글400, RESTORE_EXPIRED 등 서비스 오류 code는 유지한다. body의 directory/destination은 trim·길이 제한 후 서버 서비스의 절대경로/realpath 경계 검사를 계속 통과해야 한다. route가 서비스 startup gate를 우회하지 않는다.

복원 UI는 finish 오류 뒤 session에 저장한 ticket으로만 재확인한다. rename이 이미 성공했을 수 있으므로 destination 존재를 보고 삭제/새 inspect하지 않는다. 정상 완료 응답을 수신한 후 복원본 앱을 여는 흐름이다. T-009 replay는 normalized DB hash를 다시 확인하므로 복원본 앱을 사용해 DB가 바뀐 다음에는 이전 hash와 다를 수 있다.

## 복원본 실행 안내 계약

README 및 .env.example에 DREAM_DATA_ROOT를 추가했다. 앱 소스 cwd는 그대로 두고 웹·worker에 동일한 값을 지정한다. 코드/config/migrations/fonts는 source cwd, data/storage/backups는 runtime root에서 읽는다. **빌드된 앱**을 서로 다른 loopback port로 실행하는 예시다.

```powershell
# 소스 폴더의 별도 웹 터미널
$env:DREAM_DATA_ROOT='D:/MyRestoredStudio'
npm.cmd run start -- --port 3041
# http://127.0.0.1:3041

# 같은 소스 폴더의 별도 worker 터미널
$env:DREAM_DATA_ROOT='D:/MyRestoredStudio'
npm.cmd run worker
```

기존 source 서버·worker의 환경을 바꾸지 않고 복원본을 마이그레이션하거나 자동 실행하지 않는다. 정상 복원본은 backup의 migration journal을 이미 갖는다. 버전이 다르면 시작 점검에서 멈춘다. 사용 중 포트이면 다른 포트를 고른다.

## 외부 runtime build 추적 방어

next.config.ts의 outputFileTracingExcludes에 프로젝트 밖 DREAM_DATA_ROOT의 data/storage/backups/tmp/.tools/.env 경로도 포함하도록 했다. 로컬 Next16 output 문서가 정한 project-root 상대 forward-slash glob을 사용하고 glob 특수 문자를 escape한다. 실제 Next production trace 생성은 아래 충돌 때문에 아직 재실행하지 못했다.

scripts/verify-build.mjs는 기본 경로와 외부 runtime 경계를 모두 검사하고 lexical 경로뿐 아니라 canonical alias/junction 대상도 확인한다. innocently named public link가 외부 data DB나 .env를 가리켜도 실패한다. 검사기는 .nft.json의 목록 및 경로 metadata를 확인하며 파일의 비밀 내용을 읽지 않는다. 추적 root나 glob에 누락이 있어도 verifier가 private entry를 발견하면 build를 실패시키는 구조다.

## 실제 실행 검증

- `npm.cmd run lint`: 성공, 오류/경고0.
- `npm.cmd run typecheck`: 성공 (next typegen + tsc --noEmit).
- `npm.cmd test`: **23파일/191검사 통과**. T-009176 대비15개 추가.
- 추가15개: maintenance routes6, history/DTO6, 외부 build-tracing fixture3.
- routes: 빈 manual body만 enqueue, directory 단일 필드, ID+destination만 inspect, ticket만 finish, 추가 archivePath/manifest/settings 거부, expiry code 유지, malformed JSON의 한글400, startup fail에서 backup read 미호출을 확인했다.
- history: 실제 메모리 DB의 snapshot과 활동을 조회해 raw prompt/ref/private JSON·경로·fixture key가 반환되지 않고 필요한 요약만 나오는 것을 확인했다. 53개 활동 중 프로젝트52개가 50/2로 pagination되고 DB 행 수가 보존됐다. unknown action/unsafe ID/query를 거부하고 backup/jobs DTO도 내부 오류 path를 숨겼다. restore.info는 날짜 두 필드만 반환했다.
- build tracing: OS 임시 app/.next/server와 외부 runtime fixture를 만들고 실제 verifier CLI를 child process로 실행했다. 외부 data DB·junction alias·.env·innocent env symlink는 nonzero, datastore처럼 이름만 비슷한 공개 파일은 zero였다. cleanup 전 realpath(root)의 canonical 절대 부모가 realpath(tmpdir())와 같은지 확인했다.
- `git diff --check`: 기존 LF/CRLF 안내 외 whitespace 오류 없음.

### 빌드 제외 사유 (실패를 통과로 기록하지 않음)

**`npm.cmd run build`는 실행하지 않았다.** 읽기 전용 process 확인에서 PID9968이 `D:/starwork/dream-ai-studio/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3016`으로 실행 중인 것을 확인했고 재확인 때도 그대로였다. 프로젝트 config는 별도 distDir 없이 기본 `.next`를 사용한다. root `.next`를 사용 중인 기존 fixture 서버가 있으면 임의 종료/승인 질문 없이 build 제외 상태로 보고하라는 task 지시를 적용했다. Next dev 프로세스도 확인됐으며 어느 프로세스도 종료·재시작하지 않았다. 기존 서버를 대상으로 요청/브라우저 조작도 하지 않았다. coordinator가 해당 fixture의 사용을 끝낸 뒤 공유 `.next`를 안전하게 재빌드하고 실제 trace 결과를 확인해야 한다.

## 미검증·후속 검수

이번에는 브라우저를 열지 않았고 **1280/390px 화면, 키보드/focus, 실제 live poll/toast, sessionStorage ticket 회복 및 UI 클릭 흐름은 미검증**이다. 후속 coordinator가 fixture에서 확인해야 한다. JSX/type/lint와 DTO/route 회귀 검사가 시각·행동 검수를 대신하지 않는다. production build, 신규 route의 실제 Next HTTP 통합 및 NFT 생성도 남아 있다.

우선 확인할 흐름은 설정 위치 저장이 백업 완료로 오인되지 않음 → manual queue/worker 완료 및 백업 toast/최근 상태 → 성공 ID inspect → pending/경로분리 요약 → 새 폴더 finish → 같은 ticket retry/expired 재검사 → 복원본 안내다. 기존 T-009 backend 테스트는 rename 후 log 실패 replay·source 불변을 계속 통과했지만 이번 새 UI에서 그 오류를 주입해 직접 클릭하지는 않았다. unknown model은 보수적으로 요약하므로 새로운 모델을 노출하려면 별도 안전 allowlist 검토가 필요하다. sessionStorage 차단/사용자가 직접 제거한 경우 새로고침 뒤 ticket 유지가 제한될 수 있어 실패 화면을 유지한 채 재시도하는 것이 안전하다. idle polling은 멈추므로 다른 창/자동 일정에서 새 작업이 생기면 화면 이동 또는 명시적 새로고침으로 확인한다.

실제 앱 data/storage/backups 변경·마이그레이션 적용·운영 worker/server 실행·커밋·planner 문서 수정은 수행하지 않았다. tests의 backend 실행은 OS 임시/memory fixture뿐이다. 남은 화면/빌드 검증과 최종 P1 독립 검수 전 제품 완료로 판정하지 않는다.

## 수정 범위 요약

settings/history/home/jobs pages, 새 settings panel, jobs panel·studio shell, app CSS, backups/configuration/restore routes 및 기존 jobs GET gate, 신규 history service, 필요한 backups/jobs 안전 DTO, README/.env.example, next.config.ts/verify-build.mjs, 전용 tests3개와 이 문서. backup/restore core 실행 정책·T-009 state machine은 변경하지 않았다.

## 복사용 전달 메시지

T-010 설정의 백업/복원 UI와 strict API, 50개 pagination의 안전한 생성·활동 기록, 작업실 최근 상태·backup 구분/기록 링크와 복원본 실행 안내를 구현했습니다. lint/typecheck 및23파일191검사가 통과했고 외부 runtime trace 차단·경로/비밀값 DTO·입력 회귀15개를 추가했습니다. 기존 root .next의 Next start PID9968/포트3016이 실행 중이어서 지시대로 build를 생략했으며 브라우저1280/390/UI흐름도 아직 검증하지 않았습니다. 인계는 docs/handoffs/T-010-settings-history-ui.md이며 coordinator의 안전한 build·실제 HTTP/브라우저 검증과 최종 P1 독립 검수가 남아 있습니다.
