# T-007 백업 기반 읽기 전용 코드 검토

검토일: 2026-11-16 (로컬 실행 시각). 기준 HEAD `a1926ae1e7a18c330a9f6d2867f0aa80d73d8016`와 현재 미커밋 변경. AGENTS.md, CLAUDE.md, PLAN K-1~K-5, TEAM T-006/T-007, REVIEW 및 P1-8 인계를 확인했다. 이 작업은 백업 기반 교차 검토이며 서비스/UI 미완성 상태의 최종 P1 독립 검수가 아니다.

범위: lib/backup/{archive,paths,schema}.ts, lib/config/runtime.ts, 0004 및 연결된 DB/migrate/storage/startup/ZIP/scripts/runtimeRoot 변경과 maintenance repository. 코드·기준 문서·실제 data/storage/backups는 수정하지 않았다. 유일한 영속 산출물은 이 보고서다. 아래 세 결함은 수정 필요하며 검토 작업의 완료가 제품 통과를 뜻하지 않는다.

## F-007-1 · P1 · ZIP 추출이 대상 내부 junction을 따라 외부 파일을 생성한다

위치: `lib/backup/archive.ts:25` (verifyBackupArchive의 mkdir 및 createWriteStream).

재현: OS 임시 폴더의 stage와 outside를 만든 뒤 `stage/storage`를 outside로 향하는 Windows junction으로 만들었다. DB fixture와 `storage/new.txt`, 유효한 해시·매니페스트를 가진 ZIP을 `verifyBackupArchive(zip, manifest, stage)`로 추출했다. 함수가 성공하고 `outside/new.txt` 내용이 `fixture`가 됐다 (`junction outside write accepted: fixture`). ZIP 자체의 이름은 정상이며 공격 entry의 symlink 속성도 필요 없다.

원인/영향: within(destination,target)는 문자열 경계만 검사한다. mkdir와 파일 열기 직전 실제 부모 체인의 reparse point/realpath 검사가 없다. wx는 기존 최종 파일 덮어쓰기는 막지만 외부 새 파일 생성은 막지 않는다. 나중 verifyStagingFiles가 거부해도 외부 쓰기는 이미 일어났다. 서비스가 추출 전에 안전한 staging을 만들더라도 추출 중 하위 폴더 교체에 같은 창이 있다 (동시 교체 자체는 실험하지 않음).

제안: 호출자가 배타적으로 만든 전용 staging만 받고, 각 부모 생성/파일 열기 때 root 및 모든 부모의 실제 경계와 junction 여부를 확인한다. 검증과 open 사이 경쟁도 줄일 수 있는 파일 핸들/플랫폼 방어 또는 명시적인 staging 접근 통제가 필요하다. 외부 write가 발생하지 않는 회귀 검사를 추가한다.

## F-007-2 · P1 · 현재 데이터 하위 junction의 실제 위치를 보호하지 못한다

위치: `lib/backup/paths.ts:10-11`, 관련 `lib/storage/paths.ts:9`, `lib/storage/upload.ts:15`, `lib/config/runtime.ts:3`.

재현: 임시 runtime을 DREAM_DATA_ROOT로 지정하고 `runtime/storage -> outside` junction을 만들었다. `validateBackupDirectory(outside,false)`가 outside를 반환했고 `validateRestoreTarget(outside/new-restore)`도 허용했다. 검사는 쓰기 준비 false로 수행하여 실제 사용자 데이터 없이 재현했다.

원인/영향: runtimeRoot 자체는 realpath하지만 보호할 data/storage는 join(root,"storage") 등의 논리 경로로만 비교한다. 실제 자료 읽기/업로드는 storage의 realpath를 사용하므로, 앱이 현재 자료로 사용하는 물리 위치를 백업/복원 위치로 다시 허용한다. 원본과 복원본 격리 및 K-5의 현재 데이터 불변 보장이 깨진다. data 하위 junction에도 같은 비교 구조가 있다 (storage만 실증).

제안: 실제 사용 중인 DB 파일/부모 및 storage/backups 경계를 각각 canonicalize하고 입력과 양방향 중첩을 검사한다. 또는 startup에서 현재 데이터 하위 junction을 명시적으로 거부하고 모든 접근에 같은 정책을 적용한다. Windows 대소문자/8.3 alias도 canonical realpath 기준으로 검사해야 한다.

## F-007-3 · P1 · INSERT OR REPLACE가 감사/성공 백업/메타데이터 불변 트리거를 우회한다

위치: `lib/db/migrations/0004_audit_backups.sql:1-12`, `lib/db/connection.ts:9-13`.

재현: openDatabase(':memory:')와 migrateDatabase로 실제 0001~0004를 적용했다. `PRAGMA recursive_triggers`는 0이었다. settings의 backup.fixture.meta에 대해 UPDATE는 `backup metadata is immutable`로 실패했지만 동일 key에 INSERT OR REPLACE한 결과 value_json이 {"v":3}으로 바뀌었다. activity_log의 동일 id를 REPLACE하면 action이 original에서 changed로 바뀌었고, succeeded backup의 동일 id를 REPLACE하면 path가 other.zip, status가 failed로 바뀌었다. 메모리 DB만 사용했다.

원인/영향: SQLite REPLACE의 암묵 DELETE는 recursive_triggers가 꺼져 있으면 DELETE trigger를 실행하지 않고 UPDATE trigger도 타지 않는다. 현재 repository의 onConflictDoUpdate는 UPDATE 보호를 받지만 DB 불변 제약 자체는 우회된다. 다른 쓰기 경로나 향후 restore SQL이 REPLACE를 사용하면 완료 백업과 감사 이력을 교체할 수 있다.

제안: 모든 앱 DB 연결에서 recursive_triggers=ON을 보장·검증하고 REPLACE 회귀 검사를 추가하거나, 기존 보호 행의 동일 key/id INSERT 자체를 BEFORE INSERT에서 막는 방식으로 보호한다. 일반 insert/upsert와 마이그레이션 동작도 함께 확인한다.

## 검증 결과와 한계

- `npm.cmd test -- tests/backup-archive.test.ts`: 1파일/5검사 통과. 정상 ZIP 재열기·추출, 동일 이름 중복/누락/미등록, 인벤토리·내용·매니페스트 변조, 환경/임시 제외, storage junction 거부 및 staged 외부 연결 재검증을 확인했다. 이 통과는 위 추출 전 쓰기 경계를 다루지 않는다.
- 추가 실험은 프로젝트 모듈을 `node --conditions=react-server --import tsx --input-type=module -`로 불러 실행했다. fixture ZIP, junction, 폴더는 OS 임시 폴더의 dream-t007-* 아래에만 생성하고 실제 canonical 임시 부모와 dirname 경계를 확인 후 삭제했다. DB 실험은 :memory:였다.
- 이 환경 tmpdir는 `C:\Users\ADMINI~1\AppData\Local\Temp`, realpath는 `C:\Users\Administrator\AppData\Local\Temp`였다. 최초 자체 실험의 문자열 기반 cleanup guard가 삭제를 거부했으며 canonical parent로 경계를 재확인한 뒤 해당 fixture를 삭제했다. 이는 8.3 alias를 resolve만으로 동일시할 수 없음을 직접 확인한 사례다. 제품의 removeOwnedStaging도 canonical parent와 비정규 staging 문자열을 섞으므로 short-name 입력의 안전한 정리가 거부될 가능성이 있다 (`paths.ts:13-14`, 정적 관찰; 별도 제품 재현은 하지 않음).
- safeArchivePath는 ../, 절대 경로, 역슬래시, colon, NUL을 거부하고 ZIP 검증은 암호화/ZIP symlink/등록 외 entry/해시·크기 불일치를 거부하는 구조다. Windows 대소문자·trailing dot·8.3가 같은 파일로 매핑되는 논리 중복은 Set 문자열만으로 판별하지 않는다. wx 때문에 기존 파일 덮어쓰기는 거부되겠지만 정상화된 중복 사전 거부와 잔여 staging 정리는 서비스에서 확인해야 한다. 악성 원시 ZIP 헤더, device name, UNC/네트워크 볼륨, 동시 junction 교체, 대용량·디스크 고갈은 별도 실험하지 않았다.
- DB 검증은 migration journal 일치, integrity_check, foreign_key_check, assets와 성공 exports의 인벤토리 참조/해시/크기 및 편집 snapshot schema를 검사한다. 불변 trigger의 실제 존재/SQL을 journal 외에 검증하지 않으므로 manifest와 journal을 함께 변조한 DB의 의미적 신뢰성까지 증명하지 않는다. 전체 DB 관계/스냅샷 포인터의 악의적 재작성은 검사하지 않았다.
- runtimeRoot 전환에서 DB/storage/startup/scripts가 같은 기준을 사용하고 제공자·마이그레이션·정적 리소스는 코드 cwd를 사용하는 것을 확인했다. K-1 일관 스냅샷, K-3 자동 백업/실패 표시, K-4 설정 UI, K-5 확정/실패 정리와 T-006 작업 취소·백업 경로 재설정·복원본 로그는 아직 서비스/UI 미완성으로 이 검토에서 통과 판정하지 않는다. build/lint/typecheck/전체124검사는 요청자의 기존 증거이며 여기서 재실행하지 않았다.

## 전달 메시지 초안

T-007 읽기 전용 교차 검토에서 P1 수정 필요 3건을 재현했습니다: ZIP 추출 대상 junction을 통한 외부 쓰기, 현재 storage junction 실제 위치의 백업/복원 중첩 허용, REPLACE에 의한 감사·성공 백업·메타데이터 불변 트리거 우회입니다. 기존 백업 테스트 5건은 통과했고 OS 임시 가상 데이터 및 메모리 DB만 사용했습니다. 상세 재현·위치·수정 제안과 Windows short-name/ZIP/DB 검증 한계는 docs/handoffs/T-007-backup-foundation-review.md에 있으며 서비스/UI 완료나 최종 P1 독립검수 통과를 의미하지 않습니다. 이 문구는 전달 초안이며 coordinator에 worker_done으로 별도 보고합니다.

## 후속 필수 수정 완료 · 2026-11-16

새 dispatch `task_28239532eeb2 / ctx_fe2ec94bf829`에서 F-007-1~3 코드 수정·회귀 검사 권한을 받았다. 위 읽기 전용 검토 기록은 당시 증거이며, 이 절은 직접 구현한 변경의 **자체 검증(독립 검수 아님)** 이다. 서비스/UI는 여전히 미완성이며 최종 P1 통과 판정이 아니다.

### 수정 위치와 동작

- **F-007-1 수정:** `lib/backup/archive.ts:21-50`. 추출 전에 ZIP 전체의 내용·매니페스트·해시를 먼저 검증한다. 추출 대상은 기존 폴더를 재사용하지 않고 mkdir로 배타 생성한다. 기존 빈 폴더·root junction·하위 junction이 들어 있는 기존 대상은 EEXIST로 거부하여 DB fixture를 포함해 아무 파일도 추출하지 않는다. 부모는 canonical 경로를 기준으로 각 단계마다 lstat/realpath/경계 검사를 하고 root의 dev/ino가 처음 생성한 대상과 같은지도 검사한다. 파일은 O_CREAT|O_EXCL로 열고 POSIX에서는 O_NOFOLLOW도 사용하며, 열린 핸들과 lstat 결과의 dev/ino·일반 파일 여부 및 실제 경계를 확인한 뒤 핸들로 쓴다. Windows 장치명·끝 점/공백·8.3 형태의 tilde 이름과 대소문자로만 다른 inventory 경로도 추출 전에 거부한다.
- **호출 계약 변경:** verifyBackupArchive의 destination은 부모만 존재하고 leaf는 아직 없는 전용 staging 경로여야 한다. validateRestoreTarget은 최종 목적지의 기존 빈 폴더 검사를 계속 지원하지만, 추출 staging은 이와 별도로 신규 생성해야 한다. 같은 staging으로 동시 추출하면 한 작업만 점유한다. 실제 복원 확정 및 staging 정리는 미완성 서비스의 책임이다.
- **F-007-2 수정:** `lib/backup/paths.ts:12-30`. runtime data/storage/backups 각각의 실제 경로를 구하고 없는 leaf는 가장 가까운 실제 부모를 정규화한다. data/storage와 백업 대상의 양방향 중첩, root/code/data/storage/backups와 복원 대상의 양방향 중첩을 거부한다. 기본 backups의 물리 트리 안은 백업 저장 목적상 허용하되 그 조상 폴더는 거부한다. removeOwnedStaging도 실제 부모와 basename 조합으로 검사하여 Windows short alias로 접근한 소유 staging을 안전하게 정리할 수 있다.
- **F-007-3 수정:** `lib/db/connection.ts:13-14`, `lib/db/migrations/0004_audit_backups.sql:16-23`. 앱 연결마다 recursive_triggers=ON을 설정하고 활성 상태를 확인한다. 기존 감사·성공 백업·백업 메타데이터·편집 스냅샷 DELETE 보호가 REPLACE에도 실행된다. 이전 UPDATE 전용이던 성공 scene_versions/exports 및 승인 plans에는 DELETE 보호를 0004에 추가하여 REPLACE의 암묵 삭제도 막는다. 0001~0003의 내용과 체크섬은 바꾸지 않았다. 아직 미적용인 0004 파일만 확장했고 실제 앱 DB에는 마이그레이션을 적용하지 않았다.

### 실제 검증

- `npm.cmd run lint`: 성공, 경고/오류 0.
- `npm.cmd run typecheck`: 성공 (next typegen 및 tsc --noEmit).
- `npm.cmd test`: **18파일/138검사 통과**. 기존124 대비 14개 회귀 검사 추가.
- `git diff --check`: 성공. 기존 작업트리의 LF/CRLF 안내만 출력됐다.
- `tests/backup-archive.test.ts`: 기존5 + 신규6 검사. 기존 junction tree/root junction/기존 빈 폴더의 추출 전 거부와 외부 sentinel 바이트 보존, 손상 ZIP의 staging 생성 전 거부, Windows 특수/alias 이름 거부, 대소문자 중복 거부, 동시 추출의 단일 점유와 정상 추출 바이트 일치를 검증했다. 기존 정상 추출·변조·누락 검사도 통과했다.
- `tests/backup-paths.test.ts`: 신규4 검사. runtime data/storage/backups의 외부 junction 물리 경계와 양방향 중첩 거부, 별도 backups 저장/독립 복원 허용, 실제 OS short spelling을 통한 canonical 정규화 및 staging 정리, 비어 있지 않은 복원 대상 거부를 검사했다. 이 환경의 tmpdir `ADMINI~1`와 realpath `Administrator`가 실제로 다른 것을 재확인했다.
- `tests/backup-immutability.test.ts`: 신규4 검사. recursive_triggers=1, 정상 신규 INSERT·mutable setting upsert·running→succeeded 백업 갱신, 정상 마이그레이션/재실행0, 감사/성공 백업/metadata의 REPLACE·UPDATE·DELETE 거부, 편집 snapshot REPLACE 거부/current 포인터 갱신 허용, 완료 버전·내보내기·승인 기획의 REPLACE 거부와 foreign_key_check=[]를 메모리 DB로 검사했다.
- 새 파일 fixture는 OS 임시 dream-* 폴더에만 생성했고 cleanup은 realpath(root)의 dirname과 realpath(tmpdir())의 canonical 절대경계 일치 후 수행했다. 실제 data/storage/backups 변경, 실제 마이그레이션 적용, 커밋, planner 문서 수정은 하지 않았다. 이 dispatch에서 직접 수정한 파일은 archive.ts, paths.ts, connection.ts, 0004, backup-archive.test.ts, 신규 backup-paths.test.ts/backup-immutability.test.ts 및 이 보고서다. 다른 기존 미커밋 변경은 그대로 두었다.

### 잔여 한계 및 후속 조건

Node/Windows는 부모 디렉터리 핸들에 상대적인 원자적 openat 및 모든 reparse-point 추적을 금지하는 API를 제공하지 않는다. 따라서 같은 OS 사용자/권한의 공격자가 staging 또는 그 부모를 검사와 mkdir/open 사이에 바꾸는 경쟁을 완전히 차단한다고 주장할 수 없다. 현재 방어는 배타 신규 staging·가능한 권한 제한·매 부모 재검사·root 동일성·최종 파일 O_EXCL 및 쓰기 전 핸들 동일성 확인이다. 부모 교체가 정확히 open 사이에 일어나면 내용 쓰기는 뒤 검사에서 거부해도 외부에 빈 파일/폴더가 만들어질 가능성이 남으며, 핸들 확인 뒤 폴더를 이동시키는 경쟁도 원자적으로 막을 수 없다. 위협 모델이 동일 권한의 적대적 로컬 프로세스까지 포함하면 네이티브 Windows 핸들 상대 I/O/ACL 격리가 별도 필요하다. 이 경쟁을 반복 스케줄링하는 스트레스 실험이나 네트워크/UNC 볼륨 검증은 수행하지 않았다.

ZIP 사전 검사와 실제 추출 사이 원본 ZIP이 교체될 수도 있으므로 추출 중 내용 검사도 계속 수행한다. 실패 시 일부 **소유 staging** 파일은 남을 수 있으며 서비스는 검증 실패를 성공 확정하지 않고 소유 경계를 재확인하여 정리해야 한다. 새 이름 정책은 이식성과 안전성을 위해 tilde가 포함된 일반 이름도 보수적으로 거부한다. 자동 백업 일정/일관된 DB 스냅샷/복원 확정·실패 정리/T-006 작업 중단·복원본 백업 위치·활동 로그/UI는 아직 이번 범위에서 완료 판정하지 않는다. build는 요청 범위에 없어서 실행하지 않았다.

### 수정 후 전달 메시지 초안

F-007-1~3을 직접 수정하고 Windows junction/short alias·배타 staging·REPLACE 회귀 검사를 추가했습니다. lint/typecheck 및 전체18파일138검사가 통과했고 실제 앱 데이터·마이그레이션·커밋·planner 문서는 변경하지 않았습니다. 인계는 docs/handoffs/T-007-backup-foundation-review.md 후속 수정 절이며, 신규 staging 호출 계약과 Node/Windows의 부모 교체 잔여 경쟁 한계를 명시했습니다. 직접 구현한 변경의 자체 검증이며 서비스/UI 완료나 최종 P1 독립 검수 통과를 뜻하지 않습니다.
