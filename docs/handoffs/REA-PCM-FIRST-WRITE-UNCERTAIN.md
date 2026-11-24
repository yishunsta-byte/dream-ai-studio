# PCM 첫 송신 뒤 송신 원장 확정 불명 검증

2026-11-20 KST · Codes(Backend) · 배정 `msg_2ccf0cd93d60` · 기준 `42b2584`

**같은 송신 허가의 재사용은 두 경우 모두 0바이트였다. 같은 발급 요청에 새 송신 허가를 붙이면 종료 진입 전에는 보호 본문이 다시 전송됐다.** 고정된 PCM 발급·대상 차단·T319/T320 송신 시험의 실제 소유 PostgreSQL 17.12와 두 루프백 HTTPS 리스너를 사용했다. 신뢰된 TLS 클라이언트가 보호 접두부를 받은 다음 송신 원장 연결에 장애를 주입했다. [선행 시험](REA-PCM-COMMITTED-RESPONSE-EGRESS.md) · [T320 계약](T320-REA-HTTPS-DURABLE-EGRESS-INTEGRATION.md)

| 상황 | 실제 관측 |
| --- | --- |
| 송신 원장 커밋 성공, 호출자 응답 유실 | 실제 `COMMIT` 뒤 별도 DB 세션이 `sending` 행을 관측했다. 시험기가 보낸 쪽에 완료 응답을 넘기지 않은 채 해당 원장 세션을 종료했다. 송신자는 연결 오류를 받았으며, 클라이언트에는 이미 수신한 접두부만 남았다. |
| 송신 원장 롤백 | 첫 보호 접두부를 수신한 뒤 `first_report`가 미커밋인 실제 원장 세션을 종료했다. 별도 관찰에는 이미 확정된 `starting`과 기존 사건만 남았다. 최초 송신 기록이 롤백된 경우에도 접두부는 클라이언트가 실제 수신했다. |
| 재전송 | 두 경우 모두 동일 허가를 활성 상태와 종료 중 상태에서 재사용하면 409·0바이트였다. 같은 발급 요청을 DB에서 재시도하면 종료 전에는 기존 리비전과 `changed=false`를 받았다. 이 결과에 새 허가를 발급하자 두 경우 모두 동일 본문이 실제 HTTPS 200으로 다시 전달됐다. 종료 중에는 새 허가 발급이 거절됐고, 종료 확정 뒤에는 최초 및 교체 허가의 HTTPS 재전송이 409·0바이트, DB 재시도도 거절됐다. 발급 포인터와 요청 원장은 전체 행 비교에서 불변이었다. |
| 종료 확정 | 대상 DB 차단이 커밋된 뒤에도 소켓이 열려 있는 동안 외부 종료는 진행되지 않았다. 원장 오류를 전달한 뒤 두 실제 소켓이 닫혔지만, 종료 보고가 없는 `sending`과 `starting`이 남아 종료는 계속 보류됐다. 소켓과 송신 작업 0건, 구 리스너 종료와 포트 접속 거절을 확인한 뒤 감독자가 격리를 기록했다. 두 허가가 `isolated`가 되고 활성 미종결 허가가 0건이 된 다음 외부 종료가 확정됐다. |

## 최소 보완 설계

1. 서버가 확인한 저장소·복원 세대·소유자·발급 요청 ID를 송신 원장의 고유 키로 사용한다. 발급 결과의 리비전과 본문 다이제스트를 해당 키에 묶는다. 같은 발급 요청의 재시도는 기존 결과 확인과 중복을 구분하고, 같은 키에 다른 허가를 발급하는 요청은 원장에서 차단한다.
2. 첫 보호 바이트를 넣기 전에 위 논리 키의 일회성 송신 의도를 영속 기록한다. 최초 삽입을 기록하기 전에 원장이 롤백되거나 연결이 끊기면 미송신으로 분류하지 않는다. 같은 키 재송신은 닫고, 송신자·소켓·큐를 실제 정리했다는 근거를 확인한 뒤 격리를 기록한다. 발급 원장 조회와 발급·송신 재실행은 별개로 판정한다. [T309 송신 및 재실행](T309-REA-AUTHORITY-EVIDENCE-ISSUANCE-DESIGN.md) · [T322 전송 의도 시험](T322-REA-EGRESS-INTENT-REVOCATION-PROBE.md)

## 재현

```powershell
node --conditions=react-server --import tsx tests/reference-analysis/registered-pcm-wav-egress-uncertain-run.mjs
node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit
node node_modules/eslint/bin/eslint.js tests/reference-analysis/registered-pcm-wav-egress-uncertain-run.mjs tests/reference-analysis/registered-pcm-wav-egress-uncertain.pg17.ts
```

실행기는 `42b2584`의 두 시험 파일을 고정하고, 메모리 로드 단계에서 시험 시나리오와 COMMIT 관측 지점만 교체한다. 첫 경우 COMMIT 응답 유실은 시험 송신자에 대한 전달을 보류하는 방식이며, DB 세션 종료·COMMIT 가시성·HTTPS 접두부·소켓 종료는 실제 관측이다. 두 HTTPS 리스너는 한 시험 프로세스에서 실행됐으며, 두 포트·송신 작업·DB 세션·클러스터·임시 인증서 정리를 확인했다. 제품·운영·실제 원격 호출이나 보완 구현은 없다. [실행기](../../tests/reference-analysis/registered-pcm-wav-egress-uncertain-run.mjs) · [시험 시나리오](../../tests/reference-analysis/registered-pcm-wav-egress-uncertain.pg17.ts)

**Master 인계** · 첫 보호 바이트 수신 뒤 원장이 커밋된 경우와 롤백된 경우 모두 기존 허가 재사용은 0바이트, 새 허가를 이용한 같은 발급 요청 재전송은 가능했다. 두 경우 모두 소켓·송신자 격리 근거가 확인돼야 종료됐고 발급 행은 바뀌지 않았다. PG Tester 순차 검수에 인계한다. 다음 후보는 논리 발급 요청에 일회성 송신 의도를 결합해 두 장애 경로에서 새 허가를 통한 재전송을 막는 시험 한 건이다.
