# T-009 인계 · 새 폴더 격리 복원 서비스

2026-11-16. 기준 HEAD `a1926ae1e7a18c330a9f6d2867f0aa80d73d8016`와 T-007/T-008의 미커밋 구현. TEAM T-003/T-006/T-009, PLAN K-5, DESIGN 6.7 및 작업 지시를 적용했다. 직접 구현한 복원 서비스의 **자체 검증이며 최종 P1 독립 검수가 아니다.** HTTP/UI·현재 데이터 교체 기능은 구현하지 않았다.

## 변경 파일

- 신규 `lib/services/restore.ts`: backup ID 기반 inspect, 30분 ticket, claim/CAS·lease, 복원본 정규화, 원자적 rename 확정, 기록 실패 replay, public startup wrapper.
- `lib/backup/schema.ts`: restoreTicket의 ready/finishing/prepared/completed/failed 상태, claim/lease·counts·정규화 DB hash·시각 및 strict restore-info marker schema.
- `lib/backup/paths.ts`: empty 검사와 분리된 validateRestoreBoundary. 이미 rename된 정상 복원본 replay에서도 동일한 현재 데이터 경계 검사를 재사용한다.
- `lib/backup/archive.ts`: 배타 추출 root 생성 직후 onCreated 콜백, staged 전체 트리의 파일/디렉터리 allowlist 및 모든 junction 거부, 검증기가 생성한 빈 WAL/SHM sidecar 정리. 기존 backup ZIP/worker 검사도 계속 통과한다.
- 신규 `tests/restore.test.ts`: OS 임시 실제 SQLite/ZIP 기반 19개 검사.
- 이 보고서 외 planner 문서는 수정하지 않았다. 실제 앱 data/storage/backups 변경, 실제 DB 마이그레이션 적용, 커밋은 하지 않았다. 다른 기존 미커밋 변경은 그대로 두었다.

## 검사 단계

클라이언트가 전달하는 입력은 strict `{backupId: UUIDv7, destination: absolute path}`뿐이다. archivePath 등 추가 키와 임의 ZIP 경로는 받지 않는다. 서버가 backup succeeded 행 및 불변 `backup.<id>.meta`를 조회하고 다음을 검증한다.

1. 서버 backup.path의 일반 파일/비연결 여부, ZIP 전체 SHA256·크기가 immutable meta와 일치.
2. manifest backupId, database.sha256, inventorySha256, 파일 수가 성공 backup 행/meta와 일치.
3. 목적지는 현재 runtime root/code, 실제 data/storage/backups, 선택한 ZIP의 서버 보관 위치 및 현재 configured backup directory와 양방향으로 겹치지 않는 새/빈 폴더. 기존 leaf junction과 nonempty 폴더는 거부한다.
4. 목적지와 같은 부모의 아직 없는 `.dream-restore-<ticketUUID>`를 verifyBackupArchive에 전달한다. 함수가 mkdir로 배타 생성한 경우만 콜백으로 소유권을 기록한다. 기존에 있던 다른 폴더를 실패 cleanup 대상으로 삼지 않는다.
5. ZIP을 다시 열어 파일별 hash·크기·누락·중복·manifest·스키마를 검사하고, verifyStagingFiles로 실제 트리·DB hash·migration journal·integrity_check·foreign_key_check·파일 참조·edit snapshot schema를 검증한다.
6. 모든 검사가 끝난 뒤 source settings의 `restore.check.<UUID>`에 30분 만료 ticket을 저장하고 source activity에 restore.inspected를 append한다. staging이나 manifest 전체는 DTO로 보내지 않는다.

검사 실패는 소유권이 확인된 staging만 removeOwnedStaging의 canonical 부모/이름/id/비연결 경계를 통과해 정리한다. ZIP hash/meta 검증 전에는 추출하지 않는다.

## 확정과 복원본 처리

finish 입력은 **ticket UUID 하나**다. source DB의 BEGIN IMMEDIATE에서 ticket의 claim UUID와 60초 lease를 획득한다. 이미 active claim이 있으면 CONFLICT이고, 20초 heartbeat가 유효 claim만 갱신한다. 중요한 source 상태 변경과 최종 filesystem 확정은 같은 token/lease를 재확인하는 즉시 트랜잭션에서 수행한다. 같은 ticket을 처리하는 오래된 호출은 claim을 잃으면 다른 호출의 staging이나 복원본을 삭제하지 않는다.

새 확정은 ticket 만료, 현재 목적지 경계·empty 및 전체 staged hash/트리를 다시 검사한다. 모든 파일뿐 아니라 추가 파일/빈 디렉터리, DB WAL 주입, 내부로 향하는 junction도 거부한다. 정상 staging의 원래 DB hash가 일치한 뒤 **복원본 DB에만** 다음 정규화를 하나의 DB 트랜잭션으로 적용한다.

- queued/running jobs → canceled, error_code=RESTORED_NOT_RESUMED; lease/heartbeat/nextRun 초기화, finishedAt 기록.
- queued/running scene_versions → canceled.
- running exports/backups → failed, error=RESTORE_INTERRUPTED.
- worker.heartbeat 및 backup.auto.lastDay 제거, operational restore.check.* 모두 제거.
- backup.directory → `<destination>/backups`로 지정.
- restore.info 설정에 ticket/backup/destination/백업 날짜/복원 시각을 저장하고 복원본 activity에 restore.completed 1건 append.

성공 exports/scene_versions, 승인 plans, edit snapshots, generations, assets 및 원본 파일에는 UPDATE/DELETE를 하지 않는다. 트리거를 끄거나 기존 migration SQL을 바꾸지 않았다. 복원본 연결에도 recursive_triggers가 켜져 있고 원본과 같은 trigger SQL을 유지한다. 복원본 DB를 checkpoint하고 journal_mode=DELETE로 닫은 뒤 새 DB SHA256·크기를 계산한다. 이 값은 원래 backup manifest DB hash와 **별도**로 source ticket에 persisted prepared 상태로 저장한다.

`restore-info.json` marker는 ticketId/backupId/destination/원래 백업 날짜/복원 시각/source DB hash/정규화 DB entry를 strict schema로 가진다. marker는 16KB 이하 일반 파일이어야 하며, source ticket의 persisted normalized hash/시각과 정확히 같아야 한다. 디스크 marker의 자기 주장만으로 완료를 인정하지 않는다. 정규화된 DB도 새 hash를 넣은 manifest와 원래 storage inventory로 다시 전체 DB/참조 검증한다. prepared retry는 정규화를 반복하지 않으므로 복원본 로그를 중복 생성하지 않는다.

최종 BEGIN IMMEDIATE에서 claim, canonical 부모와 staging root identity, 목적지의 실제 nonempty/연결 여부를 다시 확인한다. 기존 빈 폴더만 rmdirSync(empty only)로 제거하고 **같은 부모의 staging을 renameSync**하여 확정한다. rename 전 실패하면 자신이 제거한 빈 목적지를 같은 mode로 복구하려고 시도한다. 그 사이 다른 데이터가 들어오면 덮거나 지우지 않는다. rename 후에는 source ticket completed와 source restore.completed 로그를 같은 트랜잭션에 기록한다.

rename 성공 후 source ticket/log 기록이 실패해도 이미 확정된 복원본은 삭제하지 않는다. source에는 그 전에 persisted prepared hash가 남는다. 같은 ticket으로 재호출하면 destination marker·identity·전체 hash/DB를 다시 검증한 뒤 source 완료 기록만 복구한다. 이 replay는 이미 rename된 정상본을 확인하는 동작이므로 30분 ticket TTL이 지나도 허용한다. 반면 아직 rename하지 않은 ticket은 30분 이후 새 확정하지 않고 실패/소유 staging 정리한다.

## WAL 검증 보완

검증용 read-only SQLite 연결도 WAL 모드 스냅샷에 빈 app.db-wal 및 SHM을 만들 수 있음을 실제 실행에서 확인했다. 기존 sidecar를 허용하면 inspect 후 WAL 삽입으로 main DB hash만 우회할 수 있으므로, verifyStagingFiles는 **DB 열기 전 모든 미등록 파일/sidecar를 거부**한다. read-only 검증기를 닫은 뒤에만 생성된 일반 파일·비연결 sidecar를 정리하고, WAL에 내용이 있으면 검증을 실패시킨다. 원래 DB 파일 내용은 바꾸지 않는다. 정규화된 copy는 DELETE 모드로 닫아 최종 새 hash를 안정적으로 계산한다.

## 실제 검증

- `npm.cmd run lint`: 성공, 오류/경고 0.
- `npm.cmd run typecheck`: 성공 (next typegen + tsc --noEmit).
- `npm.cmd test`: **20파일/176검사 통과**. T-008의157검사 대비 복원19개 추가.
- `git diff --check`: 기존 LF/CRLF 안내 외 whitespace 오류 없음.

새19개 검사의 근거:

1. T-008 실제 backupService와 SQLite backup API로 만든 ZIP을 새 위치에 inspect/finish했다. fixture에는 승인 기획·정적 글자 스냅샷·generation·성공 버전/내보내기·원본·queued/running 작업과 running export가 있다. 독립 restored DB 연결에서 전체 참조·성공 행/approved plans/edit/generations/원본 바이트와 trigger SQL의 보존을 확인했다. source jobs/versions 행과 원본/성공 ZIP 전체 hash는 같았다.
2. 복원본 pending 3개(당시 진행 중 백업 포함)가 재개되지 않고 정규화됐으며 backups 위치 분리·heartbeat/autoDay/ticket 제거·restore-info·복원본 로그1건을 확인했다.
3. 임의 archivePath 추가 입력·nonempty/현재 source 또는 ancestors/backup 중첩을 거부하고 기존 sentinel bytes를 보존했다.
4. ZIP bytes 변조, manifest에 등록된 파일 누락, 실제 journal이 다른 지원 불가 migration, 잘못된 edit snapshot을 가진 **유효한 hash/meta의 실제 ZIP**을 거부했다. 각 실패 뒤 소유 staging이 남지 않았다.
5. inspect 뒤 staged 파일 내용 변조·삭제·내부 junction 교체·추가 WAL·추가 빈 폴더를 거부했다. 원본은 그대로였다.
6. 30분 만료 시 미확정 staging만 정리했다. active finish claim은 CONFLICT이고 61초 후 lease 회복은 정상 확정했다.
7. 두 실제 source DB 연결에서 concurrent finish를 호출해 하나만 성공하고 다른 호출은 CONFLICT였다. 재호출은 idempotent이며 source/copy restore.completed 로그가 각각1건이었다.
8. 실제 목적지 빈 폴더를 rmdir한 후 renameSync 실패를 mock 주입하여 빈 목적지가 복구되고 prepared staging을 같은 ticket으로 재시도해 정규화를 중복하지 않는 것을 확인했다.
9. rename 뒤 source activity INSERT를 실패시키는 **source 임시 DB trigger**를 설치했다. 호출은 실패했지만 destination DB/marker를 보존하고, trigger를 제거한 뒤 31분 후 같은 ticket으로 완료를 복구했다. DB hash와 copy 로그1건은 그대로였다.
10. prepared staging의 DB 추가 변조, persisted normalized hash 없는 위조 marker, inspect 후 destination junction/nonempty 변경을 거부했다. 연결된 target/sentinel을 삭제하지 않았다.
11. public inspect/finish wrapper의 startup 실패 gate 및 low-level service 생성 시 live source migration journal 검증을 확인했다.

모든 fixture는 OS 임시 `dream-restore-test-*` 안에 생성했다. cleanup 전에 realpath(root)의 dirname이 realpath(tmpdir())와 같은 canonical 절대 부모임을 확인했다. 실제 source 앱의 DB/data/storage/backups에 접근하거나 마이그레이션/worker를 실행하지 않았다. source 운영 상태 쓰기는 임시 DB의 ticket·activity에만 추가했고, 자료·기획·완료 결과는 보존했다. 실패·시간 경계는 제어 시각/일부 rename mock 및 임시 DB trigger로 재현했으며 OS 전원 차단이나 실제 30분 대기는 하지 않았다.

## HTTP/UI 통합용 계약

아직 HTTP route/UI는 없다. 서버 API는 다음과 같다.

| 호출 | 입력 | 결과 |
|---|---|---|
| `inspectRestore(input)` | strict `{backupId:UUIDv7,destination:absolutePath}` | 검사 성공 DTO |
| `finishRestore(ticketId)` | UUIDv7 문자열 하나 | 완료 확인 DTO. 입력에 backup path/destination/manifest를 다시 받지 않음 |
| `restoreService(handle,now).inspect/finish` | 동일 입력 | 이미 시작 점검한 내부 caller용. handle을 모든 await 동안 caller가 소유 |

inspect와 finish의 반환 키는 **ticketId,fileCount,projects,assets,pendingJobs,destination,expiresAt**만이다. staging/claim/lease/status/manifest/settings key/ZIP path는 반환하지 않는다. fileCount는 DB+storage 파일 수이며 marker/manifest 자체는 제외한다. finish Promise가 성공하면 확정 또는 정상 완료 replay가 끝난 것이다. source ticket 상태는 내부 구현이다.

주요 오류는 RESTORE_INVALID(파일·검사 불일치), RESTORE_EXPIRED(다시 검사 필요), CONFLICT(다른 finish 처리 중), RESTORE_FAILED(확정 실패, 같은 ticket 재시도 가능 여부 확인)다. 실패 직후 destination이 보이더라도 UI가 폴더를 삭제하거나 새 ticket으로 덮으려 해서는 안 된다. **rename 후 기록 실패일 수 있으므로 기존 ticket으로 finish를 재호출**한다. 정상 completed replay는 marker와 새 DB hash를 다시 확인하므로, 사용자가 복원본 앱을 열어 DB를 변경한 뒤에는 같은 hash를 보장하지 않는다. 완료 안내 후 복원본을 열기 전에 완료 응답을 먼저 수신하는 흐름이 적합하다.

DESIGN6.7 통합 시 pendingJobs로 "백업 당시 진행 중이던 작업 n개는 복원본에서 이어서 하지 않고 취소로 남겨요"를 표시하고, backups 위치 분리와 "지금 데이터는 그대로예요"를 안내할 수 있다. destination을 새 인스턴스의 DREAM_DATA_ROOT로 지정해 여는 UI/실행 안내와 restore.info의 백업 날짜 표시는 후속 UI 작업이다. 현재 프로세스의 runtimeRoot나 source DB를 자동 전환하지 않는다.

공개 wrapper는 startup gate를 통과한 뒤 live source DB를 열고 verifyMigrations를 명시 호출하며 await 작업이 모두 끝난 후 finally에서 닫는다. sync-only withDatabase에 async callback을 넣지 않았다. low-level 생성 시에도 verifyMigrations를 실행한다.

## 실제 한계와 남은 작업

- T-007의 Node/Windows 경로 검사와 실제 파일 열기 사이 TOCTOU 한계가 남는다. 부모 canonical 경계·모든 junction 거부·ticket CAS·root identity·sync final 재검사로 정상 서버 요청 간 경합을 막지만 같은 OS 권한의 적대적 프로세스가 검증 직후 파일/부모를 바꾸는 일을 원자적으로 봉쇄하는 네이티브 핸들 상대 I/O/ACL 격리는 없다.
- rename은 같은 부모의 동일 파일시스템 내 확정이다. rmdir(empty)와 rename의 두 호출 전체가 하나의 OS 원자 동작은 아니다. failure rollback은 빈 폴더의 존재/mode 복구를 시도하며 Windows의 기존 사용자 ACL·파일 ID까지 복원하지는 못한다. 복구 위치를 다른 프로세스가 차지하면 그 새 데이터를 보존한다. 실제 네트워크/외장/동기화 볼륨, 전원 차단/fsync 내구성은 검증하지 않았다.
- normalized DB hash는 source ticket에 저장한 뒤 rename하므로 source 완료 기록 실패 replay가 가능하다. 정규화 도중 또는 hash/marker를 source에 저장하기 전 강제 종료되면 원래 hash로 재검증할 수 없어 새 inspect가 필요할 수 있다. 완성 전 copy만 잃고 source/기존 destination 데이터는 보존하는 방향으로 실패한다. 모든 kill 시점을 프로세스 단위로 시험하지는 않았다.
- source DB 자체가 unavailable하여 완료 실패 뒤 claim 해제가 기록되지 못하면 기존 60초 lease가 만료될 때까지 CONFLICT일 수 있다. 만료 후 marker+persisted hash로 회복한다. source ticket의 terminal 상태 저장도 실패한 경우 stale 호출이 공유 staging을 cleanup하지 않도록 했다.
- 임의의 오래된/미사용 ticket을 자동 sweep하는 작업은 없다. 정상 오류와 사용자가 만료 ticket finish를 호출한 경우만 소유 staging을 정리한다. prepared rename 실패 staging은 같은 ticket retry를 위해 보존한다. OS 강제 종료 후 잔여 staging의 운영 정리는 별도 안전한 정책이 필요하다.
- DB integrity_check 등 동기 native 호출이 길면 heartbeat 갱신이 지연될 수 있다. final claim/CAS를 통과하지 못하면 확정하지 않는다. 다GB/10000파일·장시간·실제 disk-full 부하는 미수행이다.
- 검사기 sidecar cleanup은 배타 소유 staging에서만 사용해야 한다. live DB/다른 사용자가 연결한 DB 폴더를 verifyStagingFiles에 넘기는 계약은 지원하지 않는다.
- 복원 UI/HTTP, 설정/이력 통합, build/브라우저 흐름 및 최종 P1 독립 검수는 아직 남아 있다. planner 문서나 사용자 승인 상태를 변경하지 않았다.

## 복사용 전달 메시지

T-009 backup ID 검사→30분 서버 ticket→복원본 작업 중단/백업 위치 분리→atomic rename 확정과 기록 실패 replay를 구현했습니다. 실제 T-008 ZIP·참조/원본/완료 결과·동시 finish·만료·변조/누락/migration·rename rollback·rename 후 로그 실패 replay를 검증했고 lint/typecheck 및20파일176검사가 통과했습니다. 인계는 docs/handoffs/T-009-restore-service.md이며 UI용 allowlist DTO·wrapper 수명 계약과 Windows 경쟁/빈 폴더 ACL/강제 종료·staging 정리 한계를 기록했습니다. 실제 앱 데이터·마이그레이션·커밋·planner 문서는 변경하지 않았고 구현 자체검증이며 최종 P1 독립 검수는 아닙니다.
