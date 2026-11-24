# PCM 등록 승인과 발급 원장의 복원 세대 검증

2026-11-20 KST · Codes(Backend) · 배정 `msg_cf3a92c9c3f1` · 기준 `f451761`

소유 루프백 PostgreSQL 17.12에서 실제 PCM WAV가 등록된 원본 DB를 `pg_dump -Fc`로 백업하고, `pg_restore --single-transaction --exit-on-error`로 별도 DB에 복원했다. 원본과 복원본이 공유하는 클러스터에 제어 전용 DB를 따로 만들고 대상 백업에서는 제외했다. 외부 제어의 현재 상태·DB 이름·OID·복원 세대·작업 번호를 대조하는 시험 서버 경계를 두고, 실제 접속한 데이터 DB의 증거도 같은 트랜잭션에서 확인했다. [발급 원장 선행 시험](REA-PCM-ISSUANCE-LEDGER-VERIFICATION.md) · [T309 전환 설계](T309-REA-AUTHORITY-EVIDENCE-ISSUANCE-DESIGN.md)

| 검증 항목 | 관측 결과 |
| --- | --- |
| 실제 복원과 오래된 승인 | 합성 소유자 A·B의 WAV 바이트·등록·승인, 발급 포인터, 확정·예약 상태의 요청 원장을 복원했다. 백업 뒤 원본에서 B 승인을 철회하자 원본의 B 조회는 막혔지만 복원 직후 B의 활성값은 백업 시점 상태였다. 새 역할은 전환 설정 전에 원래 발급·읽기 역할로 전환할 수 없었고, 원본 발급 로그인은 복원본에 접속할 수 없었다. |
| 외부 확인 및 구·신 세대 전환 | 외부 제어가 원본을 가리키는 동안 복원본 접속의 DB 이름·OID가 일치하지 않아 A 조회·기존 요청 확인 및 재실행을 닫았다. 제어가 닫힌 상태에서는 원본의 이전 요청도 막히고 이전 발급 로그인을 종료·비활성화했다. 복원본에서 새 복원 세대와 작업 번호를 설정하고 백업 속 활성 승인 2건을 닫았다. 외부 제어가 준비 상태인 동안 새 세대 읽기·예약도 닫혔다. |
| 기존 확정 결과와 대기 요청 | 같은 세대의 확정 요청 재전송은 기존 리비전 4를 반환하고 변경하지 않았다. 전환 뒤에는 이전 확정·대기 요청 모두 조회 결과가 없었고, 이전 세대나 작업 번호로 읽기·재실행·재예약을 할 수 없었다. 이전 요청 ID만 새 작업에 넣어 실행해도 예약이 없어 완료 결과가 반환되지 않았다. 이전 세대 원장 및 포인터는 JSON 행 전체 비교에서 변하지 않았다. |
| 현재 재검증과 명시 재승인 | 새 세대가 활성 상태여도 A·B의 승인과 발급 포인터가 없어 조회되지 않았다. 복원본의 소유 WAV 바이트를 다시 읽어 RIFF 구조와 SHA-256을 원본과 대조한 뒤 A의 등록 세대만 먼저 올렸을 때 발급이 거절됐다. A의 명시 재승인과 새 예약을 마친 뒤에만 새 포인터 리비전 1이 확정됐다. 같은 요청 재시도는 변경 없이 이 결과를 반환했다. B와 교차 소유자 읽기는 계속 닫혔다. |
| 외부 제어 종료 | 새 세대의 유효한 로컬 포인터가 남은 상태에서 외부 제어를 닫자 새 읽기·조회·재전송도 거절됐다. 닫기 전후 새 세대 포인터와 원장 행은 같았다. |

## 재현

```powershell
node --conditions=react-server --import tsx tests/reference-analysis/registered-pcm-wav-restore-run.mjs
node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit
node node_modules/eslint/bin/eslint.js tests/reference-analysis/registered-pcm-wav-restore-run.mjs tests/reference-analysis/registered-pcm-wav-restore.pg17.ts
```

실행기는 `f451761`의 실행기·판정 코드·SQL과 기존 소유 런타임을 고정해 재사용한다. 인수로 외부 접속 대상을 받지 않으며, 백업·복원 도구도 소유 경로와 SHA-256을 확인한다. 복원 시험의 DB 세션과 루프백 리스너, 시험 클러스터, 백업 파일 제거를 확인했다. [실행기](../../tests/reference-analysis/registered-pcm-wav-restore-run.mjs) · [판정 코드](../../tests/reference-analysis/registered-pcm-wav-restore.pg17.ts)

복원과 제어 DB는 같은 소유 클러스터에 있다. 시험 제어기는 로컬 DB 이름·OID를 사용하고, 기존 SQL 발급·조회 호출은 시험 서버가 외부 제어 확인을 거쳐 실행한다. 다른 호스트나 관리형 서비스의 세션 귀속·TLS·자동 승격, 실제 공급자의 SQL4 정책/버전 및 전체 권한 이력 재생, 전송 중인 소켓과 대기열 격리는 별도 검증 범위다. 운영 백업·복원·승격·역할 변경과 제품 배포는 미실행이다. [T311 스토리지 증거](T311-REA-CURRENT-STORAGE-EVIDENCE-PG17-PROBE.md) · [T312 요청 원장](T312-REA-ISSUANCE-LEDGER-STORAGE-INTEGRATION.md) · [음악 운영 연결 전제](REA-CLOUD-MUSIC-ISSUANCE-BOUNDARY.md) · [T323 두 호스트 기준](T323-REA-TWO-HOST-STAGING-READINESS.md)

**Master 인계** · 소유 PG17.12 실제 백업·복원에서 외부 복원 세대 일치 전 조회·발급 차단, 새 검증과 명시 재승인 뒤 A만 신규 발급, 이전 확정·예약 행과 포인터 무변경을 작성자 시험으로 확인했다. 기존 PCM 원장 검수 순서에 이어 독립 PG Tester에게 인계한다. 다음 후보는 외부 제어 전환과 이미 허가된 DB 트랜잭션의 경합을 소유 루프백에서 검증하는 한 건이다.
