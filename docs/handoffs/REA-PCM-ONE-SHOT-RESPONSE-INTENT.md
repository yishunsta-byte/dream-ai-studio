# PCM 발급 요청별 일회 송신 의도 검증

2026-11-20 KST · Codes(Backend) · 배정 `msg_20bcb74b086c` · 고정 기준 `42b2584`, `40e7241`, T322

소유 PostgreSQL 17.12와 두 루프백 HTTPS 리스너에서 **저장소·복원 세대·소유자·발급 요청별 송신 의도를 하나로 제한**했다. 검증 기준으로 실제 PCM 발급 원장의 확정 결과를 읽어 시험에 등록했다. 발급 리비전과 응답 본문의 SHA-256을 논리 키에 묶고, T320 송신 허가와 의도를 같은 트랜잭션에서 기록했다. 송신 리스너는 실제 응답 바이트의 다이제스트를 확인하는 제한 함수만 사용한다. [앞선 중복 재현](REA-PCM-FIRST-WRITE-UNCERTAIN.md) · [T322 송신 의도](T322-REA-EGRESS-INTENT-REVOCATION-PROBE.md)

| 검증 | 관측 결과 |
| --- | --- |
| 정상 및 별도 발급 | 같은 요청의 허가 발급을 별도 DB 연결 두 개에서 겹치자 한 번만 성공했다. 실제 TLS에서 하나의 전체 본문을 받았고, 같은 허가 반복은 409·0바이트였다. 같은 저장소·세대·소유자의 새로운 실제 발급 요청에는 다른 허가를 발급하고 정상 전체 본문을 받았다. |
| 범위와 본문 위조 | 잘못된 저장소·복원 세대·소유자·요청 ID·리비전·다이제스트는 허가 발급에서 거절됐다. 기존 허가로 바뀐 본문을 내보내려 한 실제 TLS 요청은 409·0바이트였고 허가는 준비 상태로 남았다. 정상 본문으로 교체한 뒤 한 번만 전송됐다. 제한 발급자의 기존 허가 함수 직접 호출·원장 조회와 송신자의 기존 함수 직접 호출은 권한 오류로 거절됐다. |
| 첫 바이트 뒤 결과 미확정 | 클라이언트가 실제 보호 접두부를 받은 뒤 첫 송신 원장의 COMMIT 성공 응답 유실과 미커밋 원장 세션 종료를 나눠 재현했다. 별도 DB 읽기에서 각각 `sending`과 `starting`을 확인했다. 두 경우에 같은 발급 요청을 다시 읽으면 기존 리비전과 `changed=false`였다. 새 송신 허가 시도는 `duplicate_request`로 거절돼 DB에 허가 행이 생기지 않았다. 기존 허가와 발급되지 않은 교체 허가를 HTTPS에 보내도 추가 보호 본문은 0바이트였다. |
| 종료와 격리 | 대상 DB 쓰기 차단이 확정된 상태에서도 실제 HTTPS 소켓과 송신 작업·구 리스너 종료를 확인하고 격리를 기록하기까지 외부 종료는 보류됐다. 종료 뒤 이전 허가 재전송과 이전 발급 재시도가 거절됐다. 이전 전송 세대에서 준비한 발급 결과는 허가를 한 번도 받지 않았어도 새 송신 세대에서 사용할 수 없었다. |
| 행 대조 | 정상 2건과 장애 2건에 해당하는 허가·송신 의도는 각 4행이었다. 전환 뒤에도 논리 키·허가 ID·리비전·다이제스트가 그대로 유지됐다. 송신 및 종료 시험 전후 발급 포인터와 요청 원장의 전체 행도 같았다. |

## 재현

```powershell
node --conditions=react-server --import tsx tests/reference-analysis/registered-pcm-wav-one-shot-run.mjs
node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit
node node_modules/eslint/bin/eslint.js tests/reference-analysis/registered-pcm-wav-one-shot-run.mjs tests/reference-analysis/registered-pcm-wav-one-shot.pg17.ts
```

실행기는 고정 HTTPS·장애 시험의 코드를 유지하며 전용 로더에서 시험 관측 지점만 연결한다. 송신 의도는 보호 바이트를 넣기 전에 확정되고, 종결 상태는 연결된 T319 허가의 기록을 사용한다. 시험 부트스트랩이 실제 발급 원장 결과를 별도 송신 DB에 넣었으며, 두 리스너는 한 시험 프로세스에서 실행됐다. 장애 중 COMMIT 응답 유실은 전달 보류를 사용했고, 미커밋 세션 종료와 DB·HTTPS 상태는 실제 관측이다. 태넌트·배포에 적용할 증거 전달, 다중 호스트·프록시 큐 및 제품 경로는 별도다. 원격·제품·운영 변경 없이 시험 소켓·포트·DB 세션·임시 인증서·소유 클러스터를 정리했다. [실행기](../../tests/reference-analysis/registered-pcm-wav-one-shot-run.mjs) · [시험 시나리오](../../tests/reference-analysis/registered-pcm-wav-one-shot.pg17.ts) · [시험 SQL](../../tests/reference-analysis/registered-pcm-wav-one-shot.fixture.sql)

**Master 인계** · 첫 송신 원장 커밋 응답 유실 및 롤백 두 경우 모두 같은 PCM 발급 요청에 새 허가를 붙인 재송신이 차단됐다. 정상 단일 송신과 같은 소유자의 별도 발급, 실제 소켓·리스너 격리 뒤 외부 종료, 발급 원장 무변경을 확인했다. PG Tester의 현재 순서에 인계한다. 다음 후보는 T323의 두 호스트 시험에 가져갈 고정 PCM 근거, 필요한 독립 원장·감독 및 담당 확인을 실행표 한 건으로 갱신하는 작업이다.
