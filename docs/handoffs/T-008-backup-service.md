# T-008 인계 · 백업 서비스와 작업 큐

2026-11-16. 기준 HEAD `a1926ae1e7a18c330a9f6d2867f0aa80d73d8016` 및 T-007 후속 미커밋 작업트리. AGENTS.md/CLAUDE.md, TEAM T-008, PLAN K-1~K-5와 T-006 복원본 정책을 확인했다. 이 문서는 직접 구현한 백업 서비스의 **자체 검증(독립 최종 검수 아님)** 이다. 복원 서비스·확정·UI, 설정/이력 UI 및 최종 P1 검수는 이번 범위가 아니다.

## 구현 파일과 동작

- 신규 `lib/services/backups.ts`: 수동 요청, 설정 경로 allowlist, 안전한 목록 DTO, 서울 날짜 자동 enqueue 및 실제 백업 처리.
- `lib/services/jobs.ts`: backup kind의 claim/recover/cancel/fail/retry/list. `lib/jobs/runner.ts:18`: 실제 backup dispatch. `worker/main.ts:9`: 초기 시작 점검 통과 후 루프마다 시작 점검을 재확인하고 오늘 자동 백업을 enqueue한다. 시작 점검이 실패하면 enqueue/처리 전에 워커를 종료한다. 실행 중 작업은 다음 정상 시작에서 lease 정책으로 회복한다.
- `lib/backup/archive.ts`: 환경 파일과 최상위 tmp 제외를 대소문자 무관하게 적용해 Windows `.ENV.*`도 제외한다. T-007의 안전한 ZIP/배타 staging 검증과 정리 경계를 그대로 재사용했다.
- 신규 `tests/backup-service.test.ts`: OS 임시 fixture 기반 19개 검사. 그 외 기존 미커밋 파일·planner 문서·실제 앱 데이터는 변경하지 않았다. 새 마이그레이션 적용과 커밋을 하지 않았다.

### 요청과 일정

`backupService(handle, now)`의 요청은 BEGIN IMMEDIATE 안에서 backup kind의 queued/running을 조회하여 수동·자동 요청 간 중복을 막고, backups/job/activity를 함께 기록한다. 자동 작업은 Asia/Seoul 날짜를 사용하며 `backup.auto.lastDay`를 enqueue와 같은 트랜잭션에 저장한다. 여러 날을 놓쳐도 현재 날짜 1건만 만든다. 진행 중 수동 백업 때문에 자동 요청이 대기할 때는 오늘 표식을 기록하지 않으므로 그 작업 종료 후 오늘 자동 1건을 만들 수 있다. 같은 날의 자동 작업이 실패·취소되어도 새 자동 작업을 무한 생성하지 않고 기존 retry 정책을 사용한다. 수동 백업은 날짜 제한이 없으며 현재 backup 작업과는 중복되지 않는다.

기본 경로는 `<runtimeRoot>/backups`, 외부 위치는 `backup.directory` 한 키로만 지정한다. 설정 시 validateBackupDirectory로 실제 경계와 쓰기 권한을 검증하고 canonical 경로만 저장한다. queued backup은 요청 당시 목적지를 backups.path에 고정하며, 처리 시 그 경계를 다시 검사한다. 이후 설정 변경은 기존 요청의 목적지를 바꾸지 않는다. 일반 settings 행을 조회하거나 반환하는 API는 추가하지 않았다.

### 스냅샷·ZIP·확정

1. 현재 claim의 attempt/lease/취소 및 시작 후 30분 한도를 검사한다.
2. 최종 백업과 같은 디렉터리에 `.dream-backup-<id>-<attempt>-<uuid>` staging을 배타 생성한다. SQLite `handle.sqlite.backup()` API로 신규 `data/app.db`를 만든다. DB 파일 복사나 live DB 교체는 하지 않는다. API progress callback에서도 claim/취소/시간을 검사한다.
3. storageInventory로 환경 파일·최상위 tmp를 제외한 실제 파일·크기·SHA256을 얻는다. 참조는 live DB가 아니라 **캡처한 스냅샷 DB**의 assets 및 성공 exports에서 읽어 모든 참조의 인벤토리 존재·해시·크기를 대조한다. 내용은 immutable source 파일을 스트리밍해서 사용하며, 생성 중 내용이 바뀌면 후속 ZIP 해시 검사에서 거부한다.
4. 스냅샷 migration journal 전체(version/name/sha256), DB 해시, inventory 해시를 backupManifestSchema로 검증하여 ZIP64/store 모드로 스트리밍 저장한다. 실제 ZIP을 다시 열어 verifyBackupArchive로 검증·새 staging 하위에 추출하고 verifyStagingFiles를 실행한다. 여기서 DB hash, integrity_check, foreign_key_check, 실제 앱 migration journal 일치, DB 파일 참조 및 편집 스냅샷 schema까지 검증한다.
5. ZIP digest와 크기·검증 시각·파일 수를 backupMetaSchema로 검증한다. 파일 수는 DB+storage 인벤토리 수이며 backup-manifest.json 자체는 제외한다.
6. BEGIN IMMEDIATE 안에서 claim/취소/30분 제한을 다시 검사한 뒤 linkSync로 최종 `<id>.zip`을 **새로만** 만든다. 같은 트랜잭션에서 backups success+DB/inventory hash, 불변 `backup.<id>.meta`, job success, activity를 기록한다. SQL 실패 시 linked 플래그가 있는 **이번 트랜잭션이 생성한 링크만 같은 DB 락 안에서** unlink한다. 기존 final은 실패해도 지우거나 덮지 않는다. COMMIT 자체 실패·프로세스 강제 종료처럼 링크만 남으면 아래 orphan 재개로 처리한다.
7. 정리는 removeOwnedStaging의 canonical 부모·이름·소유 id·junction 거부 경계를 통과한 이번 attempt의 staging에만 수행한다.

기존 final이 있으면 일반 파일인지 확인하고 backupId 및 원래 createdAt이 같은 매니페스트를 요구한다. ZIP 전체/DB/참조를 다시 검증한 후 기존 파일의 dev/ino가 유지된 경우에만 같은 성공 트랜잭션을 수행한다. 기존 파일을 새 ZIP으로 교체하지 않는다. 다른 worker가 만든 정상 final을 오래된 worker가 삭제할 수 있는 락 밖 정리 경로는 없다.

### 작업 정책

전역 동시 실행 1개와 60초 lease, 20초 heartbeat는 기존 runner/jobs 정책을 사용한다. 백업 내부에서는 250ms마다 취소·deadline·claim을 확인해 스트림을 abort한다. TIMEOUT/STORAGE_FAILED 등 기존 retryable code는 30초→60초 간격, 최대 3회이다. 백업의 반복 crash/lease 만료도 현재 retry batch의 최대 횟수에 도달하면 terminal failed로 남긴다. 취소된 만료 작업은 recover가 canceled/finishedAt으로 정리하고 backup은 failed로 표시한다.

백업 수동 retry는 프로젝트 승인/기획 검사를 요구하지 않으며, 다른 active backup이 있으면 CONFLICT를 반환한다. attempt 번호를 0으로 되돌리면 오래된 worker의 attempt와 같아져 fencing을 우회할 수 있으므로 **번호는 단조 증가**시키고 maxAttempts를 현재 attempts+3으로 설정한다. 새 retry batch는 시작 시각을 갱신하고 다시 30/60초 정책을 사용한다. 생성/내보내기의 기존 retry 동작은 이번 범위에서 바꾸지 않았다.

## 실제 검증 결과

- `npm.cmd run lint`: 성공, 오류/경고 0.
- `npm.cmd run typecheck`: 성공 (next typegen + tsc --noEmit).
- `npm.cmd test`: **19파일/157검사 통과** (T-007 138검사 대비19개 추가).
- 이후 WAL 파일의 실제 존재/크기를 확인하는 assertion을 보강하고 `npm.cmd test -- tests/backup-service.test.ts`: 1파일/19검사 재통과.
- `git diff --check`: 성공. 기존 LF/CRLF 안내 외 whitespace 오류 없음.

검사 증거:

- 실제 file DB의 journal_mode=wal 및 app.db-wal 크기>32를 확인하고 스냅샷의 assets 행을 독립 연결로 읽었다. 실제 ZIP의 ZIP64 EOCD signature와 manifest migration4개·inventory·DB/파일 해시를 확인했고 별도 신규 추출본에서 verifyStagingFiles가 통과했다.
- lower/upper `.env.*`와 tmp fixture가 ZIP inventory에 없고 원본 자료 SHA256/크기가 보존됨을 검사했다. 두 번째 성공 백업 뒤에도 첫 성공 ZIP의 전체 SHA256/크기가 같았다.
- 수동/자동 중복 및 두 DB 연결에서의 단일 active claim, 서울 자정 전후 날짜, 4일 누락 후 오늘1건, 진행 중 수동 작업의 autoDay 미표식을 확인했다.
- 경로 설정은 별도 canonical 외부 폴더를 사용하고 storage 중첩은 거부했다. list JSON에는 경로가 없고 configuration의 directory만 명시적으로 반환한다. 공개 requestBackup은 startup 실패 mock에서 enqueue하지 않았다.
- queued/running 취소와 snapshot 진행 중 취소, 취소된 lease recover, 30분 제한, snapshot 참조 hash 변조 실패, 30/60초 재시도/3회 소진, manual retry의 attempt 단조 증가와 중복 거부, heartbeat 갱신, 반복 crash의 bounded recovery를 확인했다.
- 실제 orphan ZIP을 미리 만들고 동일 bytes 그대로 성공 재개했다. invalid 기존 final은 원래 bytes를 유지했다. 임시 DB의 metadata INSERT 실패 trigger를 사용하여 link 이후 SQL 오류를 주입했을 때 final만 제거되고 DB/meta 성공이 rollback되는 것을 확인한 뒤 다음 attempt 성공을 검사했다.
- 첫 worker를 snapshot API 진입에서 보류한 사이 lease를 만료시키고 새 worker가 완성하도록 실행했다. 예전 worker를 재개하면 CONFLICT가 나고 새 성공 final의 전체 hash는 그대로였다.
- 최신 성공 DTO는 원래 enqueue 순서가 아니라 verifiedAt 완료 시각 순으로 고른다. 이전 실패 작업이 나중에 재시도 성공한 경우도 검사했다.

모든 신규 파일 fixture와 임시 DB는 `OS tmp/dream-backup-service-*` 안에서만 생성했다. 삭제 전 realpath(root)의 dirname이 realpath(tmpdir())와 같은 canonical 절대 부모인지 확인했다. 일부 검사에서는 임시 DB의 상태/오류 trigger와 제어 시각을 사용했고 실제 30분 대기·OS 디스크 고갈·프로세스 kill은 하지 않았다. 원본 보존은 자료/기획 등 원본 데이터를 의미하며, enqueue/heartbeat/작업 상태/감사 기록의 정상 DB 쓰기는 fixture 안에서 수행했다. 실제 앱 data/storage/backups, 마이그레이션 적용, 운영 worker 실행, 커밋은 수행하지 않았다.

## 복원·설정 UI용 서비스 계약

HTTP route/UI는 만들지 않았다. 다음 함수는 서버에서만 호출한다.

| 함수 | 결과/정책 |
|---|---|
| `readBackups()` | `{rows,lastSuccess,lastFailure}`. row는 `id,kind,status,jobId,jobStatus,createdAt,finishedAt,error,verifiedAt,fileCount,sizeBytes`. 실제 경로·key·job input·설정 JSON·내부 메타는 없음. lastSuccess는 verifiedAt, lastFailure는 finishedAt 기준 최신. 없으면 null |
| `requestBackup()` | 시작 점검 통과 후 manual enqueue. `{id,jobId,duplicate}`. active backup이 있으면 같은 id/jobId와 duplicate=true |
| `readBackupConfiguration()` | `{directory:string}`. **설정 화면의 실제 경로 표시용으로만 명시 허용한 유일한 path 필드**. 다른 settings는 반환하지 않음 |
| `configureBackupDirectory(input:string)` | validateBackupDirectory 후 `{directory:canonicalPath}` 반환. 내부 settings는 `backup.directory`만 변경하고 감사 로그와 immediate txn으로 기록. 외부비용/AI 호출 없음 |
| 기존 `updateJob(jobId,"cancel" | "retry")` | startup gate와 backup별 취소/retry 정책 사용. retryable 실패만 수동 retry, 다른 active backup과 중복 금지 |

`backupService(handle, now)`의 request/enqueueAuto/list/configuration/setDirectory와 runClaimedBackup은 이미 점검한 내부 caller가 DB handle 수명을 소유하는 low-level API다. async runClaimedBackup/setDirectory를 sync-only withDatabase 콜백에 넣으면 안 된다. 공개 configureBackupDirectory는 async 경로 검증을 **콜백 밖에서 완료**하고 DB 콜백은 동기로만 실행한다. worker는 열린 handle을 전체 await 작업 동안 유지한다.

후속 복원 서비스는 클라이언트가 보낸 파일 경로나 settings key를 신뢰하지 말고 **backup id**로 DB 행과 `backup.<id>.meta`를 서버에서 찾고 ZIP digest·schema·inventory·DB를 다시 검증해야 한다. T-007 계약대로 verifyBackupArchive 추출 대상 leaf는 없어야 하므로 최종 빈 복원 폴더와 분리된 신규 소유 staging을 사용한다. 검증/확정은 별도 ticket/id로 연결하고 T-006대로 복원본 jobs 중단·backups 위치 재설정·activity 기록을 수행해야 한다. 이 복원 처리는 이번에 구현하지 않았다.

## 한계와 후속 진입 조건

- T-007에서 보고한 Node/Windows 부모 junction 교체의 원자성 한계가 남는다. canonical 경계·배타 staging·열린 파일 동일성·최종 부모 재확인·DB claim 락으로 정상 worker 간 경쟁을 막지만 같은 OS 권한의 적대적 프로세스까지 원자적으로 격리하는 네이티브 핸들 상대 I/O/ACL은 추가하지 않았다.
- final 확정은 요구한 hard link 기반이므로 NTFS 등 hard link 지원 파일시스템이 필요하다. 외부 디스크가 FAT/exFAT이거나 hard link를 금지하면 STORAGE_FAILED와 retry/실패로 남기며 다른 파일을 덮어쓰는 fallback은 하지 않는다. 실제 외장/동기화/네트워크 볼륨은 시험하지 않았다.
- ZIP은 streaming이지만 확정 전 실제 전체 재추출로 검증하므로 스냅샷+ZIP+독립 추출본을 위한 추가 디스크 공간이 필요하다. 다GB/10000파일 경계·실제 디스크 고갈 부하는 미수행이다. 이식성 정책상 tilde/Windows 장치명 등 T-007에서 거부하는 파일 이름은 백업 검증도 실패시킨다.
- synchronous native DB integrity_check나 파일시스템 호출 중에는 JS heartbeat/취소 timer를 즉시 실행하지 못한다. 작업 재개 후 claim/deadline 검사를 통과해야만 성공 확정한다. 30분 자체는 제어 시각으로 확인했고 실제 장시간 성능/워커 kill 시험은 하지 않았다.
- 강제 종료로 남은 전용 staging을 무차별 정리하는 sweep는 추가하지 않았다. 정상 종료/fail에서는 소유 staging만 정리하고 orphan final은 검증해 재개한다. COMMIT/디스크 오류가 동시에 발생하면 next worker가 검증 가능한 final을 보존할 수 있다. 모든 프로세스/OS crash 조합을 실험한 것은 아니다.
- 자동 일정은 worker 루프가 켜져 있을 때 동작한다. 웹만 켜지고 worker가 꺼져 있으면 자동 실행하지 않는다. 실패 상태를 표시할 안전한 DTO는 제공했지만 화면 연결/restore/history UI는 별도 통합 작업이다. build/브라우저 검수는 이번 요청 범위가 아니어서 실행하지 않았다.

## 복사용 전달 메시지

T-008 백업 서비스·worker dispatch·서울 날짜 자동 enqueue와 취소/재시도/lease fencing을 구현했습니다. SQLite WAL backup API→실제 ZIP64→독립 추출/DB참조 검증→claim을 확인하는 immediate txn의 final link/meta/job/activity 확정 및 orphan 재개를 확인했고 lint/typecheck·19파일157검사가 통과했습니다. 인계는 docs/handoffs/T-008-backup-service.md이며 복원 UI용 서비스 계약과 Windows 경쟁·hard link 지원·추가 staging 공간·장시간 미검증 한계를 기록했습니다. 실제 앱 데이터/마이그레이션/커밋/planner 문서는 변경하지 않았고 구현 자체검증이며 최종 P1 독립 검수는 아닙니다.
