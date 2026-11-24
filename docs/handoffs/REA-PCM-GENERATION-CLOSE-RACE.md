# PCM 발급 도중 외부 세대가 종료되는 경우의 검증

2026-11-20 KST · Codes(Backend) · 배정 `msg_2d6b11ab6505` · 기준 `f451761`, `2d2500b`

**기존 격리 시험의 외부 세대 확인은 정상 연결에서 COMMIT과 종료를 직렬화한다. 성공 응답 보류와 제어 연결 소실에서는 간극 두 건을 재현했다.** 소유 루프백 PostgreSQL 17.12의 발급 SQL과 복원 시험의 `withBinding`을 고정해 실행했다. 제어 전용 DB와 발급 DB를 같은 시험 클러스터에 열었고 복원 실행기는 호출하지 않았다. [발급 원장 시험](REA-PCM-ISSUANCE-LEDGER-VERIFICATION.md) · [복원 세대 시험](REA-PCM-RESTORE-GENERATION-VERIFICATION.md)

| 상황 | 실제 관측 |
| --- | --- |
| 종료 전에 완료한 발급 | 리비전 5로 한 번 확정됐다. 종료 전에 같은 키를 재전송해 같은 결과를 받았고 변경은 없었다. |
| 제어 연결 유지 중 종료와 COMMIT 경합 | 실제 COMMIT 두 건을 지연시키자 별도 조회에는 이전 포인터와 예약만 보였다. B의 COMMIT을 취소해 `57014`를 받아도 외부 종료 UPDATE는 A가 보유한 제어 행 잠금을 기다렸다. A가 리비전 6을 커밋한 뒤에만 종료가 확정됐다. B는 이전 포인터·예약 상태를 유지했다. 종료 뒤의 구 확정·예약 조회, 재전송과 재예약은 모두 거절됐다. |
| 간극 1 · 지연된 성공 응답 | A의 성공 결과를 호출자에 보류했다가 외부 종료가 확정된 뒤 반환하면 리비전 6의 성공 결과가 그대로 전달됐다. 이전 세대의 포인터·원장에는 추가 변경이 없었다. 호출자 반환을 관측한 시험이며 HTTP/TLS 바이트 전송은 계측 범위 밖이다. |
| 간극 2 · 제어 연결 소실 중 종료와 COMMIT | 새 합성 세대에서 실제 COMMIT을 잠금으로 멈춘 채 해당 시험 제어 세션만 종료했다. 외부 종료가 확정된 후에도 COMMIT은 여전히 잠금 대기였고 당시 원장은 예약 상태였다. 잠금을 풀자 포인터 리비전 1과 성공 원장이 함께 저장됐다. 호출자는 끊긴 제어 연결에서 오류를 받았고, 이후 구 요청 재시도는 거절됐다. |

실제 대기 지점은 `pg_stat_activity`와 `pg_blocking_pids`로 대조했다. 종료 확정은 별도 제어 연결의 읽기, COMMIT과 취소 결과는 해당 발급 연결의 반환과 별도 DB 행 읽기로 확인했다.

## 최소 보완 설계

1. 외부 제어를 먼저 **종료 중**으로 기록해 해당 세대의 새 발급·조회와 응답 시작을 닫는다. 전환 ID·대상·이전 세대·작업 번호를 고정한다. 제어 세션 연결이 끊겨도 종료 중 상태를 남겨 같은 전환을 이어간다.
2. 대상 DB에서 제한 전환 역할이 현재 제어 행을 배타적으로 잠근 뒤 해당 세대의 작업 번호를 닫는다. 발급은 같은 행의 공유 잠금을 잡고 현재 상태와 세대·작업 번호를 확인하며 잠금을 COMMIT까지 유지한다. 먼저 잠근 구 트랜잭션은 커밋이나 취소를 확인할 때까지 기다린다. DB 차단이 확정된 뒤에는 뒤늦게 도착한 이전 번호를 거절한다. DB 차단의 결과나 대상이 불명확하면 외부 종료를 **종료 중**으로 유지한다. 외부 연결이 끊어졌다는 사실만으로 대상 DB의 작업 종료를 판정할 수 없다. [T309 DB 저장 경계](T309-REA-AUTHORITY-EVIDENCE-ISSUANCE-DESIGN.md)
3. 성공 응답은 DB 커밋과 별도로 판정한다. 보호된 송신자는 현재 세대와 해당 응답의 일회성 허가를 확인하고, 허가 소비와 첫 보호 바이트의 큐 삽입을 종료 장벽에서 직렬화한다. 외부 상태가 종료 중이면 대기 중인 본문을 폐기한다. 앞서 시작한 응답의 종료와 미전송 버퍼 정리까지 확인한 뒤 외부 제어를 **종료 확정**으로 바꾼다. DB 확정과 사용자 전달 여부는 따로 기록하고, 응답 유실로 업무 쓰기를 반복하지 않는다. 전달 여부를 잃으면 같은 키의 원장을 대조하되 현재 권한이 없으면 결과를 반환하지 않는다. [T309 전송 설계](T309-REA-AUTHORITY-EVIDENCE-ISSUANCE-DESIGN.md) · [T320 전송 시험](T320-REA-HTTPS-DURABLE-EGRESS-INTEGRATION.md) · [T323 검증 전제](T323-REA-TWO-HOST-STAGING-READINESS.md)

## 재현과 인계

```powershell
node --conditions=react-server --import tsx tests/reference-analysis/registered-pcm-wav-close-race-run.mjs
node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit
node node_modules/eslint/bin/eslint.js tests/reference-analysis/registered-pcm-wav-close-race-run.mjs tests/reference-analysis/registered-pcm-wav-close-race.pg17.ts
```

전용 실행기는 발급 시험의 코드·SQL과 복원 시험의 외부 확인 함수를 해시로 고정한다. 종료 코드 0은 정상 경계와 두 간극이 재현됐음을 뜻한다. 소유 시험 세션·리스너·임시 클러스터를 정리했다. 운영 연결·런타임·운영 백업·승격 변경은 미실행이다. 보완 설계의 구현과 실제 두 호스트 송신 검증은 후속이다. [실행기](../../tests/reference-analysis/registered-pcm-wav-close-race-run.mjs) · [경합 시험](../../tests/reference-analysis/registered-pcm-wav-close-race.pg17.ts)

**Master 인계** · 기존 외부 제어 연결이 유지될 때는 종료 UPDATE가 진행 중 발급의 COMMIT 또는 취소를 기다렸고 종료 뒤 재실행은 행을 바꾸지 않았다. 지연된 성공 반환과 제어 연결 소실 뒤의 늦은 COMMIT 두 건을 재현했다. 기존 PG Tester 순차 검수에 인계한다. 다음 후보는 소유 루프백에서 **종료 중 → 대상 DB 쓰기 차단 → 외부 종료 확정** 순서를 구현해 늦은 COMMIT을 차단하는 검증 한 건이다.
