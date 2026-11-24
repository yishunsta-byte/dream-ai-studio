# PCM 세대 종료 전 대상 DB의 쓰기 차단 검증

2026-11-20 KST · Codes(Backend) · 배정 `msg_7e9a5980e9eb` · 기준 `f451761`, `37dbb1e`

소유 루프백 PostgreSQL 17.12에서 **외부 종료 중 → 대상 DB의 쓰기 차단 커밋 → 실제 대상의 차단 증거 확인 → 외부 종료 확정** 순서를 검증했다. 발급 요청은 대상 제어 행의 공유 잠금을 잡고 세대와 작업 번호가 맞으며 닫히지 않은 경우에만 기존 발급 함수를 호출한다. 전환 설치자는 같은 행을 배타적으로 잠그고 전환 ID를 기록한다. 외부 조정자는 별도의 읽기 연결에서 실제 DB 이름·OID·세대·작업 번호·전환 ID가 일치할 때만 종료를 확정한다. [앞선 경합 재현](REA-PCM-GENERATION-CLOSE-RACE.md) · [T309 전환 설계](T309-REA-AUTHORITY-EVIDENCE-ISSUANCE-DESIGN.md)

| 상황 | 관측 결과 |
| --- | --- |
| 진행 중인 발급 두 건 | 기존 요청 A·B의 실제 COMMIT을 잠금으로 멈췄다. 외부 상태를 종료 중으로 기록하자 새 요청 허가는 닫혔다. B는 `57014`로 취소돼 기존 포인터와 예약이 유지됐다. 대상 쓰기 차단은 A의 공유 잠금을 기다렸다. 잠금을 풀자 A의 포인터와 원장이 리비전 5로 확정된 뒤에만 대상 차단이 진행됐다. |
| 대상 차단 결과가 미확정 | 차단 함수가 완료됐어도 해당 트랜잭션이 커밋되기 전에는 별도 읽기에 증거가 없었다. 외부 종료는 계속 종료 중이었다. 대상 차단 행을 기다리던 구 요청은 실제 COMMIT 뒤에 깨어났으며, 이전 원장을 재실행하지 못했다. |
| 조정 제어 연결 손실 | 종료 중 상태를 저장한 직후 소유 시험 조정자의 실제 PostgreSQL 세션을 종료했다. 교체 연결은 같은 전환 ID를 확인했다. 대상 차단 증거가 없거나 다른 DB에서 확인을 시도하면 성공을 반환하지 않았으며, 다른 전환 ID는 거절됐다. |
| 대상 차단 성공 응답의 유실 | 대상의 실제 COMMIT을 확인한 뒤 조정자에게 완료 응답을 전달하지 않는 방식으로 재현했다. 교체 조정자는 제한 읽기 연결에서 동일한 전환 증거를 확인해 외부 종료를 확정했다. 같은 전환을 다시 실행해도 대상·외부 제어 행의 PostgreSQL 행 버전이 바뀌지 않았다. |
| 오래된 재시도 및 역할 격리 | 종료 확정 뒤 기존 확정·예약 요청의 재전송과 재예약, 처음 쓰는 요청 키, 다른 세대·작업 번호 모두 거절됐다. 발급 포인터와 요청 원장의 전체 행은 차단 직후와 같았다. 발급 역할의 원래 발급 함수 직호출·제어 행 직접 수정, 설치자의 발급 포인터 수정, 관찰자의 쓰기 차단 호출은 권한 오류로 거절됐다. |

잠금 순서는 `pg_stat_activity`와 `pg_blocking_pids`로 확인했다. 쓰기 차단·발급·폐기의 근거는 소유 시험 DB에 한정했다. 대상 DB와 외부 제어 DB는 같은 시험 클러스터에 있으며, 외부 조정은 시험 부트스트랩 연결이 수행했다. 다른 호스트에서의 대상 증명, 실제 플랫폼 권한 및 응답 송신은 별도 검증 범위다. 이번 결과는 DB 쓰기에 관한 종료 확정이다. HTTP/TLS 전송과 하위 큐 정리를 포함하는 전체 종료는 후속이다. 운영·제품·실제 계정·백업·승격 변경은 없었다. [T320 송신 시험](T320-REA-HTTPS-DURABLE-EGRESS-INTEGRATION.md) · [T323 두 호스트 전제](T323-REA-TWO-HOST-STAGING-READINESS.md)

## 재현

```powershell
node --conditions=react-server --import tsx tests/reference-analysis/registered-pcm-wav-write-fence-run.mjs
node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit
node node_modules/eslint/bin/eslint.js tests/reference-analysis/registered-pcm-wav-write-fence-run.mjs tests/reference-analysis/registered-pcm-wav-write-fence.pg17.ts
```

발급 시험의 고정 코드·SQL 및 기존 소유 런타임을 재사용한다. 외부 대상 인수를 허용하지 않으며, 신규 SQL은 소유 루프백 PG17.12의 해당 시험 DB에서만 설치한다. 실행 뒤 시험 세션·리스너·임시 클러스터를 정리했다. [실행기](../../tests/reference-analysis/registered-pcm-wav-write-fence-run.mjs) · [검증 코드](../../tests/reference-analysis/registered-pcm-wav-write-fence.pg17.ts) · [시험 SQL](../../tests/reference-analysis/registered-pcm-wav-write-fence.fixture.sql)

**Master 인계** · 제어 연결과 대상 확정 응답이 유실된 경우에도 대상의 커밋된 쓰기 차단을 확인한 뒤에만 외부 종료를 확정했다. 늦은 발급과 구 재시도는 포인터·원장을 바꾸지 않았다. 기존 PG Tester 순서에 인계한다. 다음 후보는 이미 커밋된 성공 본문을 보류했다가 종료 뒤 재개해도 보호된 송신이 시작되지 않는지 확인하는 소유 루프백 HTTPS 시험이다.
