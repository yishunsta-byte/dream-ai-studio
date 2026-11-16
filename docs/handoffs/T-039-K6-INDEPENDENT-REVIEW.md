# T-039 · K6/s4 독립 검수 — FAIL

- 담당: CX-REVIEW-04, 구현 미참여 독립 검수. 수신: Codex Master CX-MASTER-01.
- 기준: `e860711ea4819d75d9fc8c733e7439010122e3ba`, 구현 `ebd0dff`는 HEAD의 ancestor(명령 종료 0). 새 child worktree `k6-independent-review`에서 시작했고 최초 git status는 clean이었다.
- 범위: PLAN 14장 K-6, T-017 3장, T-034, T-035. AI_TEAM_RULES/AGENTS/CLAUDE/PLAN/REVIEW/TEAM/역할 문서를 확인했다. 구현·fixture·공용 보고서 수정, commit, push, 실제 사용자 데이터 접근은 하지 않았다. 저장소 변경은 이 보고서 하나뿐이다.
- 판정: **K6 준비 전체 수용은 FAIL**. 아래 F039-1/2 필수 수정 및 회귀 검수가 필요하다. 테스트 통과와 제품 수용 판정은 구분한다. P2 진입·0005 추가를 승인하는 보고서가 아니다.

## 1. 직접 실행한 검사

| 실행 | 실제 결과 |
|---|---|
| `npm.cmd ci` | 종료 0, 265 packages 설치. npm audit 출력 moderate 7건(이 검수에서 dependency 변경 없음) |
| `DREAM_DATA_ROOT` 제거 후 `npm.cmd test` | 28파일, **257 pass / 2 skip**. 생성모드 및 ffmpeg/ffprobe 부재 조건 skip |
| 같은 조건 + `FFMPEG_PATH`/`FFPROBE_PATH`에 원본 checkout의 `.tools/ffmpeg/*.exe` 읽기 전용 경로를 지정해 `npm.cmd test` | 28파일, **258 pass / 1 skip**. 남은 skip은 S4_WRITE 생성 전용 검사. 고정 fixture를 덮어쓰는 생성 모드는 실행하지 않음 |
| `npm.cmd run lint` | 종료 0 |
| `npm.cmd run typecheck` | 종료 0 |
| `npm.cmd run build` | 종료 0, build trace 검사에서 로컬 데이터·비밀 설정 추적 없음 |
| `git diff --exit-code ebd0dff^ ebd0dff -- lib/db/migrations` 및 구현→HEAD 동일 비교 | 종료 0, 제품 0001~0004 원문 변경 없음 |
| migration 폴더 목록 | 0001~0004만 존재, 제품 0005 없음 |
| s4.zip 시작·종료 SHA256 | 모두 `6e492c61799d0a87c986a0145e27e702f11457f81d97d689d281bea8f7776392` |

위 수치는 Master/구현자의 결과를 인용한 것이 아니라 이 검수자가 직접 실행한 결과다. 최초 추가 skip은 미디어 바이너리 조건이었고, 바이너리 위치를 명시한 재실행에서 해소됐다.

## 2. 필수 결함

### F039-1 · P1 · terminal restore 실패 뒤 UI가 재검사를 막음 (Master 전달 D1 독립 재현)

위치: `components/settings-panel.tsx:21`, 저장 ticket 복구 useEffect, ticket 조건부 검사/확정 UI. 서버의 `lib/services/restore.ts` failed ticket 처리와 상태가 맞지 않는다.

실제 브라우저 재현(현재 baseline 제품 코드, 가상 s4 복사본만 사용):

1. 전용 서버 `127.0.0.1:31939`, 설정 화면에서 가상 s4 선택 → 새 빈 목적지 `browser-failed` → 검사하기.
2. 검사 성공 후 **OS 임시 runtime/backups/s4.zip 복사본**에 0 바이트 한 개를 append.
3. 키보드로 새 폴더에 복원 실행.
4. 화면 alert: `검사한 뒤에 원래 백업 파일이 바뀌었어요. 목적지와 지금 데이터는 그대로예요. 다시 검사해 주세요.`
5. 동시에 화면 보조 설명은 `폴더를 지우거나 새로 검사하지 말고 같은 검사로 복원을 다시 확인해 주세요.`라고 반대로 안내한다.
6. DOM에서 backup select와 destination input은 둘 다 disabled=true, 검사하기 버튼 없음, `같은 검사로 복원 다시 확인` 버튼만 존재한다.
7. sessionStorage `restore-pending`에는 ticket `01a1e29c-192a-7712-a86f-87bb2059edf7`이 유지된다. 새로고침 후에도 저장 ticket이 복구돼 검사하기가 없고 `새 폴더에 복원`만 남는다.
8. 소스 DB를 별도 연결로 확인한 실제 ticket.status는 **failed**. staging 디렉터리는 제거됐고 목적지는 만들어지지 않았다. 따라서 같은 ticket 재요청은 복구 경로가 될 수 없다.

원인: `act()`는 RESTORE_EXPIRED만 ticket을 해제한다. BACKUP_SOURCE_CHANGED/RESTORE_INVALID/BACKUP_UPGRADE_FAILED와 서버 failed 상태를 UI가 구별하지 않는다. prepared 재시도는 보존해야 하므로 모든 오류에서 무조건 ticket을 지우는 수정도 부적절하다.

요청: terminal failure와 retryable prepared 상태를 명확히 구별하고 terminal일 때 ticket/sessionStorage 해제 또는 명시적인 다시 검사 기능을 제공한다. 오류 설명과 실제 가능한 동작을 일치시킨다. T041 수정 후 원본변경·upgrade 실패·invalid·expired 및 prepared 재시도를 양쪽 상태로 재검수해야 한다.

### F039-2 · P1 · journal 없는/빈 nonempty DB를 신규로 취급해 스냅샷 없이 변경

위치: `lib/db/live-migrate.ts:31`, `lib/db/migrate.ts:42`.

독립 임시 스크립트에서 아래 두 DB를 각각 생성했다(원본 DB 사용 안 함).

```sql
CREATE TABLE survivor(id TEXT PRIMARY KEY);
INSERT INTO survivor VALUES('do-not-relabel');
-- 두 번째 DB에만 추가:
CREATE TABLE __schema_migrations(
  version INTEGER PRIMARY KEY, name TEXT NOT NULL,
  sha256 TEXT NOT NULL, applied_at TEXT NOT NULL
) STRICT;
```

각각 `migrateLiveDatabase(handle,{snapshotDirectory:<own-temp>/snap-<case>})` 실행 결과:

```text
NONEMPTY_missing {"applied":4,"from":0,"to":4,"snapshot":null}
NONEMPTY_empty   {"applied":4,"from":0,"to":4,"snapshot":null}
survivor [ { id: 'do-not-relabel' } ]
```

기존 행은 이 재현에서는 남았으나 알 수 없는 기존 DB에 제품 표와 1~4 적용 기록을 추가했고, 사전 사본은 없었다. 이는 데이터 손실을 관찰했다는 주장이 아니라 **출처를 검증할 수 없는 nonempty DB를 fail-closed하지 않고 변경하는 안전성 결함**이다. 제품 표와 이름이 충돌하는 DB라면 우연히 SQL 오류로 rollback될 수 있지만, 그 우연은 신규 DB 판정 기준이 될 수 없다. compareMigrations(null/[])의 mismatch 정책도 이 경로가 우회한다.

요청: 실제 빈 DB인지 sqlite_schema의 사용자 객체까지 확인한 경우에만 신규 초기화를 허용한다. nonempty + journal 누락/빈 기록은 SCHEMA_MISMATCH로 거부하고 변경·스냅샷 생성 없이 원본을 유지한다. 직접 migrateDatabase 호출도 같은 정책을 지킬지 명확히 하고 회귀 검사를 추가한다. 이미 올바른 제품 DB에 대한 snapshot 경로와 진짜 빈 DB 초기화는 계속 통과해야 한다.

## 3. 명세 차이와 보완 조건

### F039-3 · P2 · 시작 점검의 이관 실패 안내 누락

T-017 3.5.3은 이관 실패 후 시작 점검에 `바꾸기 전 데이터는 그대로이고, 따로 복사본도 남겨 두었어요` 안내를 요구한다. CLI `scripts/db.ts`에는 해당 문구가 있으나 실패 상태를 시작 화면에 전달하는 코드가 없다. `checkDatabase()`는 verifyMigrations 예외만 전달하며 이전 스키마에는 일반적인 버전/기록 불일치를 보여 준다. T035도 이 미구현을 명시했다.

코드 읽기 기반으로 확인한 **미충족**이며 브라우저에 실패 상태를 주입해 검증한 PASS가 아니다. DB rollback/snapshot 보존 자체가 깨진 증거는 없어 P1 데이터 결함과 분리한다. PLAN은 K6 상세로 T017을 참조하므로 K6 전체 완료라 쓰려면 안내를 구현하거나 Master/Claude design이 명세 적용 범위를 공식 정리해야 한다. 실패 기록 저장이 실패할 때도 기존 DB를 건드리지 않는 경로를 유지해야 한다.

### F039-4 · P2 · V_RUN 예외 값의 독립 assertion이 일부 약함

`tests/k6-compat.test.ts:88`은 restore.info.protectedRoots를 배열인지밖에 검사하지 않는다. `:90`은 새 activity created_at을 ISO인지밖에 검사하지 않고 기대 stamp와 대조하지 않는다. A4/A5는 restore.info 행과 새 활동 행을 통째로 실행별 비교에서 제외한다. A2/A3의 다른 필드 검증 덕에 광범위한 업무 데이터 손실을 숨기는 구조는 아니지만 T034의 "제외 값은 해당 실행의 실제 경계/시각과 따로 대조"를 완전히 증명하지 않는다. protectedRoots가 빈 배열로 바뀌거나 활동 시각이 임의의 ISO여도 해당 assertion은 통과할 수 있다(코드 분석, mutation 실행 안 함).

요청: 기대 sourceBoundaries와 정확한 protectedRoots, 예상 stamp와 created_at을 각각 검증한다. 새 칼럼/새 표를 추가할 때 X_NEWCOLS도 행 수·PK 집합·각 값 독립 검사를 유지한다.

### 미래 코드 데이터 이관 해시 계약

지금 Migration은 SQL + 선택적인 verify만 있으며 코드 이관 실행/원문 해시 결합 계약은 없다. verify는 검사 함수이므로 그 자체를 데이터 이관 구현으로 오인하면 안 된다. 현재 제품에 코드 데이터 이관이나 0005는 없으므로 **현재 SQL 호환성의 결함으로 확대하지 않는다**. 코드로 데이터를 옮길 첫 migration 전에 실행 코드 원문까지 번호/name/hash에 묶는 계약·결정성·직접 migrate/restore 동일성 검사를 구현해야 한다. 이를 구현 완료로 표시하거나 SQL hash만으로 향후 코드 이관까지 보장한다고 쓰면 안 된다.

## 4. 독립 추가 재현 및 읽기 검토

### 실제 제품 s3 → s4

- productMigrations().slice(0,3)로 **실제 제품 1~3 SQL**을 적용한 가상 DB를 만들고 settings에 `review.sentinel = "s3 text 한글"`을 넣었다.
- 해당 DB·정확한 3행 journal로 ZIP/manifest를 생성하고 현재 s4 소스에 등록했다. 제품 0005를 추가하지 않았다.
- inspect 실제 결과: compat=upgrade, fromVersion=3, toVersion=4, appVersion=old-s3-review.
- finish 성공 후 readonly DB 확인: 4행 정확한 제품 journal, sentinel 원문 보존, restore-info 3→4 경로. 같은 completed ticket finish 재요청도 성공했다.
- 처음 writable openDatabase로 복원본을 열었을 때 journal_mode 변경이 인증 해시에 영향을 주어 재요청이 거부됐다. 이를 버그로 보고하지 않고 readonly로 고친 **새 임시 재현**에서 인증 replay 성공을 확인했다. 복원본을 실제로 변경한 뒤의 replay 성공을 보장하는 검사가 아니다.
- 이 추가 s3 데이터는 0 projects/0 assets의 작은 최소 사례다. 풍부한 업무 행/파일/한글·정규화 비교는 커밋 s4 fixture 회귀가 담당한다. 과거 실제 릴리스로 작성한 별도 s3 보관 ZIP의 검사는 아니다.

### 검사 뒤 앱 업데이트

- s4 소스에서 s4 백업 inspect → 소스만 시험 전용 5단계로 migrate → 새 service factory에 확장 목록을 주어 finish.
- 실제 `RESTORE_INVALID`, ticket failed, staging 제거. 제품 파일은 건드리지 않았으며 시험 전용 표/기록은 임시 소스에서만 사용했다.
- prepared 이전 단계 재판정이 작동한다. 이미 prepared인 상태에서 앱 목록이 바뀌는 조합은 독립 추가 실행하지 않았고 normalized 검증의 현재 journal 대조를 읽기 검토했다.

### prepared + 원본 변경

- before-publish 관찰점에서 목적지를 새 nonempty 디렉터리로 만들어 publish를 막았다(시험 전용 옵션, route는 옵션을 받지 않음).
- 첫 실패 실제 code=RESTORE_INVALID, ticket.status=prepared, normalizedDatabase 존재. 목적지의 blocker 파일을 지운 뒤 원본 **임시 ZIP**을 변경했다.
- 같은 ticket 재요청 실제 code=BACKUP_SOURCE_CHANGED, status=failed, staging 제거, 목적지는 비어 있음. 준비된 사본이 있어도 source hash 최종 재대조를 우회하지 않았다.
- rename 후 소스 로그 실패의 authenticated replay, normalized staging tamper 거부, 기존 빈 목적지 복구는 직접 실행한 기존 restore.test.ts에서 통과했다.

### K6 비교·검증·스냅샷

- 직접 실행한 k6-compat/s4/restore/backup-archive 검사에서 exact prefix, gaps, duplicates(단위), future, hash/name 변경, manifest↔DB 양방향 불일치, missing journal(restore), 형식2 거부/appVersion 기록용 허용, file hash·FK 거부, 단계 실패 cleanup, 전후 source hash, 시험 전용 5단계 rollback/data verify, 정규화 전 직접 migrate 동일성·복원 2회 동일성 통과.
- restore는 추출 전 manifest 판정, 추출 후 DB 기록 일치, staging-only upgrade, integrity/FK/file references/edit schema 재검사 후 정규화, 최종 source ZIP hash 후 rename 순서다. 새 migration verify들은 전체 SQL 적용 후 transaction 안에서 호출된다. 향후 중간 스키마만 대상으로 하는 verify를 작성한다면 이 호출 순서를 인지해야 한다.
- VACUUM INTO 앞 `wx` 예약은 기존 이름 충돌을 거부한다. VACUUM이 transaction 밖인 대신 data_version을 복사 전 읽고 복사 후 BEGIN IMMEDIATE 안에서 비교한다. 타 연결 commit은 거부되고 lock 획득 후에는 다른 writer가 commit할 수 없다. 현재 함수는 전용 CLI connection에서 자체 쓰기를 하지 않는 전제다.
- 직접 실행한 E 검사에서 committed WAL 행 포함 snapshot 논리 일치/integrity, 미커밋 WAL 제외, 동시 write/lock 거부, 기존 snapshot bytes 보존, snapshot 디렉터리 생성 실패, migration 실패 rollback+snapshot 보존이 통과했다. F039-2의 신규 판정 우회는 이 정상 journal 경로와 별개다.
- 성공/이관 실패의 유효 snapshot 자동 삭제 코드는 없다. VACUUM 자체 실패 때 비어 있는 예약 파일만 지우는 경로는 유효 snapshot 삭제와 구분한다.
- live checkMigratedData는 migration/FK/integrity/edit 검사이고 파일 inventory 검사는 없다. live DB에는 backup manifest가 없다는 명시적 한계다. 이 보고서는 live 파일 참조의 실파일 전체 검증까지 PASS라 부르지 않는다.

### s4 bytes·의미·D_R

- A1: ZIP/manifest/journal 원문 hash·schema·논리 hash, input 위치 대조. P_REGEN은 적용 시각만 제외하고 timestamp 형식 확인. DB/ZIP 재생성 바이트 동일성은 요구하지 않는다.
- A2: jobs 4, scene_versions 2, exports 1, backups 1, 삭제 settings 3 조건을 실제 행 수로 assert. 조건 밖 행은 전체, 조건 행은 변경 대상 외 칼럼 전부 대조하며 삭제/추가 PK도 검사한다. job.*.startedAt 보존. 표 전체 제외 없음.
- export-r4.zip은 고정 입력 bytes와 exports.sha256/기록/복원 파일을 모두 대조하고 verifyZip 및 manifest 의미도 확인한다.
- A3 새 test 표는 settings_key/project_id/content_revision/layer_count 두 행을 독립 기대값과 대조한다. P_MIGRATE의 >4 journal applied_at만 제외. P_POSTNORM의 예외는 앞의 F039-4 보완 범위와 구분한다.

## 5. 실제 브라우저

- ego-browser skill v2.2.1, taskSpace 30, 소유한 가상 데이터 전용 production server `127.0.0.1:31939`. 기존 서버를 사용하지 않았다.
- 1280×900: 가상 s4 선택/목적지 입력 → Tab으로 검사하기 focus 확인 → Enter → `데이터 구조 버전 맞음(4) · 만든 앱 0.1.0` 실제 표시 → 복원 버튼 focus/Enter → 완료.
- 390×844: 같은 s4 흐름과 키보드 복원 완료. 실제 document scrollWidth=375, innerWidth=390. 1280에서 scrollWidth=1265, innerWidth=1280. 양쪽 가로 overflow 없음.
- 스크린샷 두 장을 직접 열어 문구 줄바꿈/카드/버튼/초점 표시를 시각 확인했다. 보관 위치: OS temp `dream-t039-review/1280.png`, `390.png`.
- 별도 p2에서 실제 s3 백업 선택, 390에서 `이전 버전(데이터 구조 3)…지금 구조(4)…원래 백업 파일은 바꾸지 않아요. · 만든 앱 old-s3-review` 표시와 키보드 복원 완료, 가로 overflow 없음.
- F039-1은 같은 브라우저의 실제 UI 동작/DOM/sessionStorage와 소스 ticket 조회를 결합한 재현이다. 오류 코드를 화면 텍스트만으로 추정하지 않았다.
- screen reader, 터치 실기기, upgrade 문구 1280 별도 screenshot은 미실행. 같은 버전은 두 너비에서 실제 수행했다.

## 6. 재현 산출물·정리·한계

- 독립 스크립트는 저장소 밖 OS temp `dream-t039-review/review.ts`, `prepared.ts`, `browser1.mjs`~`browser6.mjs`에 있다. `node --conditions=react-server --import tsx <script>`로 이 worktree cwd에서 실행했다. 스크립트 내 fixture 읽기와 import는 이 worktree의 절대 경로다. 실행 중 발생한 ESM path/모듈 형식 오류는 수정 후 재실행했으며 실패한 bootstrap을 제품 검증 PASS로 세지 않았다.
- 가상 데이터 root 두 개만 만들었다: `dream-t039-data-G9iIbV`, `dream-t039-data-5UwnOS`. 첫 root는 위 writable replay 관찰 실행, 둘째는 최종 추가 재현/UI 실행이다. 증거 script/screenshot 및 데이터 root는 남아 있다. 임시 경계 확인을 포함한 PowerShell 삭제 요청을 자동 승인 검토가 `blocked by policy`로 거부했다. 우회 삭제는 하지 않았다. 프로세스 정리는 아래와 같이 완료했다.
- 브라우저 taskSpace는 finish keep=[]로 닫았다. 소유한 Next server session 28839에 Ctrl-C 후 종료 1을 확인했고 31939 listening connection 및 해당 포트 node process가 없음을 확인했다. 별도 worker는 시작하지 않았다. DB handle/타이머는 닫혔다.
- Windows의 같은 권한 공격자가 wx 예약과 VACUUM 사이 파일을 바꾸는 경쟁, reparse/hardlink 교체, 최종 경로 검사와 rename 사이 경쟁은 OS 수준 배타성을 증명하지 못했다. ACL 강제 실패, 전원 차단/디스크 full/실제 대용량, 다른 플랫폼은 실행하지 않았다. E2는 경로가 파일인 directory-creation 실패이며 ACL 시험이 아니다. bigdata에서 긴 integrity/해시 처리와 lease 만료도 미검증이다.
- 실제 사용자 data/storage/backups와 다른 팀 서버는 열지 않았다. 원본 committed fixture hash는 불변이다. 임시 ZIP 변경은 오직 시험용 복사본에서 했다.

## 7. 다음 단계와 전달문

필수 수정 F039-1(기존 D1/T041 연결), F039-2를 별도 구현 담당이 처리한 뒤 독립 재검수가 필요하다. F039-3의 시작 안내 적용 범위와 F039-4의 비교 assertion도 정리하고, 미래 코드 이관 hash 계약은 첫 해당 migration 전 진입 조건으로 유지한다. Master는 이 보고서와 실제 수정 결과를 통합한 뒤 K6 완료/다음 마일스톤을 판단한다.

플래너/총괄에게 복사할 메시지:

> Claude design / Codex Master: T039 독립 검수는 FAIL입니다. 독립 실행은 28파일258통과·생성모드1skip 및 lint/typecheck/build 통과이나, terminal restore 실패 후 재검사 UI 막힘(F039-1, D1/T041 연결)과 nonempty DB의 missing/empty journal 무스냅샷 초기화(F039-2)를 실제 재현했습니다. 가상 실제 제품 s3→s4 및 1280/390 같은 버전 키보드 복원은 성공했으며 시작 실패 안내·V_RUN assertion 보완과 미래 코드 이관 hash 계약을 구분해 기록했습니다. 제품·fixture·공용 문서는 수정하지 않았고 별도 담당 수정 뒤 독립 재검수가 필요합니다.
