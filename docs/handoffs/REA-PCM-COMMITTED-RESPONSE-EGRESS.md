# PCM 커밋 이후 세대 종료와 보호 응답 송신 검증

2026-11-20 KST · Codes(Backend) · 배정 `msg_29e9dce177b1` · 기준 발급 `f451761`, 경합 `37dbb1e`, 대상 DB 차단 `2c5e3c1`, T319/T320

소유 루프백 PostgreSQL 17.12에서 실제 등록 PCM 자료의 확정된 발급 결과로 응답 본문을 만들어 시험했다. T319/T320의 고정 허가·소비·송신·종료 원장과 대상 DB 쓰기 차단 SQL을 재사용했다. 별도 제어 DB와 127.0.0.1 HTTPS 리스너 두 개를 사용하고, 클라이언트는 임시 인증서로 IP·신뢰·피어 지문을 확인했다. 송신 로그인은 각 리스너에 별도로 묶었다. [대상 쓰기 차단](REA-PCM-TARGET-WRITE-FENCE.md) · [T320 송신 계약](T320-REA-HTTPS-DURABLE-EGRESS-INTEGRATION.md)

| 상황 | 실제 관측 |
| --- | --- |
| 종료가 첫 송신보다 앞섬 | 확정된 발급 결과에 대해 준비 상태로 보류한 허가는 외부 종료 중 전환에서 취소됐다. 이미 HTTPS 연결에서 허가를 소비했으나 첫 쓰기 전 보류하던 요청도 같은 전환 뒤 재개하자 409·보호 본문 0바이트였다. 최종 종료 뒤 보류 결과 및 이전 성공·중단 허가를 실제 후속 리스너에 재전송했을 때도 모두 409·0바이트였다. 송신 원장에 구 허가의 새 시작 기록은 없었다. |
| 첫 송신이 종료보다 앞섬 | 첫 쓰기 직전 T320 허가 검사가 잡은 게이트 행 잠금을 보유한 채 송신을 멈췄다. 외부 종료 중 UPDATE가 같은 잠금을 기다리는 것을 `pg_blocking_pids`로 확인했다. 첫 보호 바이트를 실제 소켓에 넣고 `sending`을 기록한 후에만 종료 중 전환이 진행됐다. 클라이언트는 접두부를 실제 수신했다. |
| 배출 및 종료 근거 대기 | 첫 송신이 끝난 연결은 남은 본문까지 받았다. 다른 연결은 접두부 수신 뒤 클라이언트가 끊어 추가 바이트가 없었다. 두 소켓이 실제 닫힌 뒤에도 종료 원장 보고를 보류하자 외부 상태는 종료 중으로 남았다. `finished`와 `cancelled`가 기록되고 소켓 쓰기 버퍼·진행 작업·구 리스너가 정리되며 대상 DB의 차단 증거를 재확인한 뒤에만 종료를 확정했다. |
| 응답 유실과 같은 요청 재시도 | 접두부만 받고 중단한 응답의 같은 발급 키를 종료 전에 재조회하자 기존 성공 리비전과 `changed=false`를 받았다. 외부 종료 뒤에는 같은 키가 거절됐다. 발급 포인터와 요청 원장의 전체 행이 시험 전후 같았다. |

두 HTTPS 리스너는 같은 시험 프로세스에서 다른 포트·로그인으로 동작했다. 구 송신 격리 근거로 실제 리스너 종료, 포트 접속 거절, 열린 소켓과 작업 0건을 확인했다. 첫 바이트 큐 삽입과 종료 진입은 살아 있는 PostgreSQL 연결의 행 잠금으로 순서를 고정했다. 첫 바이트 삽입 직후 원장 COMMIT 결과를 잃는 경우, 호스트 분할, 프록시 하위 큐, 운영 TLS와 제품 라우트는 후속 검증 범위다. [T309 전송 설계](T309-REA-AUTHORITY-EVIDENCE-ISSUANCE-DESIGN.md) · [T323 두 호스트 전제](T323-REA-TWO-HOST-STAGING-READINESS.md)

## 재현

```powershell
node --conditions=react-server --import tsx tests/reference-analysis/registered-pcm-wav-egress-run.mjs
node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit
node node_modules/eslint/bin/eslint.js tests/reference-analysis/registered-pcm-wav-egress-run.mjs tests/reference-analysis/registered-pcm-wav-egress.pg17.ts
```

전용 실행기는 고정 발급·대상 차단·T319/T320 자료를 대조하고 외부 접속 인수를 거절한다. 두 HTTPS 리스너, DB 세션과 소유 클러스터, 임시 키·인증서를 정리했다. 원격·운영·제품 수정은 없었다. [실행기](../../tests/reference-analysis/registered-pcm-wav-egress-run.mjs) · [HTTPS/PG17 시험](../../tests/reference-analysis/registered-pcm-wav-egress.pg17.ts)

**Master 인계** · 실제 소유 HTTPS에서 종료 선행 구 요청의 보호 본문 0바이트, 송신 선행 응답의 배출·소켓 종료 확인까지 종료 보류, 유실 응답 재시도의 발급 원장 무변경을 검증했다. 기존 PG Tester 순서에 인계한다. 다음 후보는 첫 보호 바이트 큐 삽입과 송신 원장 확정 사이에 연결이 끊길 때 재송신과 조기 종료를 막는지 소유 루프백에서 확인하는 한 건이다.
