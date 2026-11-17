# T205 ZIP 시험 시계 수정 독립검수

- 검수자: Codex(Tester), T204 구현 비참여.
- 날짜: 2026-11-17 KST.
- 고정 기준: **`1c36974b48e11aaa525c3ba82f43d8b2f1a02f03`**, 배정 `msg_f0adda5445ae`.
- **판정: 두 ZIP 시험의 Date 시간축·cleanup 수정 지정 범위 PASS. 새 필수 수정 없음.** 과거 원로그 없는 단발 실패는 원인 미확인으로 남긴다.
- T204 원보고서와 T203 진단을 읽었다. 공유 저장소에서는 본 고유 보고서만 수정했으며 제품·기대값·fixture·B5 WIP·OS 시계·3013·공유 .next를 변경하지 않았다.

## 소스·assertion·fixture 불변 확인

새 격리 사본 `D:/starwork/t205-clock-1c36974`에 고정 commit을 LF archive로 풀고 기존 node_modules/ffmpeg 도구를 물리 복사했다. 설치하지 않았다. 종료 후 **830개 tracked 파일이 고정 Git blob과 전부 일치, 차이0**(`evidence/baseline-integrity.json`).

부모 `cb791fea532d0d8346e4eafc8ebdd1dbacb74a4a` 대비 변경은 T204 보고서와 시험2파일뿐이다. app/lib/worker/fixture/package 제품 변경이 없다.

독립 TypeScript AST 비교(`source-audit.mjs`)에서 각 파일의 새 expression statement3개만 제거한 뒤 나머지 AST leaf token(kind+원문)을 전부 대조했다.

- `vi.useFakeTimers({toFake:["Date"]})`
- `vi.setSystemTime(time-1000)`
- `vi.useRealTimers()`

**이3개를 제외한 모든 토큰이 부모와 동일**했다. 주석·줄바꿈을 제외하고 assertion/fixture 경로/고정 time/검증 분기/cleanup 나머지 로직을 바꾸지 않았다. useRealTimers가 cleanup 첫 실행문임도 읽고 실제 예외 대조로 확인했다.

s9.zip은 부모 blob과 바이트 동일, SHA256 `50e850aec0c2c8a3137c4280943e3de295d32e6bad9b998f0e02cf20af41ca95`다. 다른 fixture/제품 파일은 해당 commit diff에 없다. T204 전체시험 기준 c067d03과 고정1c36974의 app/lib/worker/package/tests 차이도 이 시험2파일뿐임을 확인했다.

## 실제 14건·프로세스 시계 대조

OS 시계는 그대로 두고 별도 Node preload로만 **인자 없는 Date 생성자와 Date.now**에 offset을 적용했다. 명시 날짜 parse/UTC/생성자 인자는 유지한다. NODE_OPTIONS는 자기 시험 프로세스/worker에만 전달했다. preload는 변경 전 native Date를 별도로 보존해 realNow/processNow 차이를 로그로 남겼다.

| 실행 조건 | 실제 결과 |
|---|---|
| 고정 수정본, 기본 실제 프로세스 시계, 원래 두 시험파일 명령 | **exit0,14/14**, native14.log |
| 수정본, 실제 시계, 종료 probe+추가 cleanup 예외2건 | **exit0,14+2 PASS**, native-probe.log/jsonl |
| 수정본, 프로세스만 **+365일** | **exit0,14+2 PASS**, future-probe.log/jsonl |
| 같은 제품/fixture + 부모의 원본 시험2파일, 프로세스+365일 | **기대 exit1,13FAIL/1PASS**, original-future-control.log |
| 같은 제품/fixture + 부모의 원본 시험2파일, 프로세스−1일 | **exit0,14/14**, original-past-control.log |

원본 미래 대조는 시계 이동이 실제로 작동한다는 양성 대조다. 고정 claim 시각보다 request의 Date가 뒤에 놓여 작업이 queued에 남는 기존13건 실패를 재현했다. 기대값을 바꾸거나 timeout으로 기다려 통과시키지 않았다. 원본 시험은 자기 사본에서만 잠시 대체했고 finally에서 고정1c36974의 두 파일로 정확히 복원했다.

기본 명령:

```text
npm.cmd test -- tests/t162-audio-bundle.test.ts tests/t166-late-source-change.test.ts
```

계측 명령은 `node node_modules/vitest/vitest.mjs run --config tmp/t205/vitest.config.mjs`다. 미래 조건에서는 자기 `clock-preload.cjs`를 NODE_OPTIONS --require로 로드하고 T205_SHIFT_MS=31536000000만 추가했다. 모든 사용 환경변수는 해당 PowerShell 프로세스의 finally에서 제거했다. 원본 대조에서도 수정 대상 assertion은 그대로다.

## Date-only·cleanup 복원 독립 관찰

검수용 setup은 원래 vi.useFakeTimers/setSystemTime을 한번씩 그대로 호출한 뒤, Date-only 옵션과 실제 timer 함수 identity를 기록했다. onTestFinished는 실제 afterEach 뒤에 실행되며, 설치된 Vitest5.1.0 runner 코드에서도 cleanup 예외 후 실행 위치를 확인했다. 제품 시험 source는 계측을 위해 수정하지 않았다.

두 환경(실제/미래)에서 각각:

- Date 가짜 설정16회 모두 **toFake=[Date]만**, setTimeout/setInterval은 설정 중에도 실제 함수 그대로.
- setSystemTime16회 모두 `2026-11-17T09:59:59Z`(claim 고정10:00Z의1초 전).
- 종료16회 모두 Date가 환경 시작 시 보관한 원래 생성자 identity로 돌아옴, isFake=false, 실제 timeout/interval 유지.
- 실제 시계 환경은 native Date 복원. 미래 환경은 **의도적으로 offset된 프로세스 기준 Date로 복원**되며 OS native Date를 미래로 바꾼 것이 아님.
- future preload의 processNow−realNow는 정확히31536000000ms였고, 종료 probe에서도 같은 process offset을 확인했다.

추가2건은 각 고정 시험파일에서 **실제 afterEach callback 원문을 AST로 추출해 실행**했다. handle.close만 의도적으로 throw하도록 주입했으며, 그 예외가 발생해도 먼저 Date가 복원됐음을 단언했다. 실제 DB handle을 일부러 누수시키거나 temp 정리를 실패시킨 것은 아니다. 후속 cleanup 오류 이전의 복원 순서를 검증한 대조다.

`result-audit.json`: 환경별 원14+추가2, 복원 검사16/16 PASS. 같은14건과 보조2건의 환경별 반복이며 신규 시험 수로 합산하지 않는다.

## 과거 ‘원본+하루 전1실패’ 회수 결과와 남은 한계

요청을 Front로 실제 전송했다(`msg_450dc8fc254a`). Front 회신 **`msg_9ee8132cbaf2`**:

- 당시에는 **1 failed/13 passed 요약만 남겼고 실패 파일·시험명·원로그를 저장하지 않았다**고 확인했다.
- `%TEMP%/dream-t204` 사본도 삭제해 보존 경로가 없다.
- 실패명이 무엇인지 기억/추정할 근거도 없다고 했다.
- 같은 조건에서 곧바로2회 재실행한14/14와 수정본 시계별14/14만 작성자가 확인한 사실이다.

따라서 과거1실패는 **원인 미확인·원로그 부재로 재분석 불가**다. 이를 ‘제품 회귀가 아님을 독립 확정’하거나 특정 flaky 원인으로 꾸미지 않는다. 이번 고정 제품/부모 시험/−1일 대조는14/14였지만 과거 실패를 소급 해소하지 않는다. 현재 검수에서 제품 회귀의 새 근거는 발견하지 못했다는 제한된 판단이다.

## 전체 결과 검토·실행기 오류 구분

T204 보고의 격리 전체1177PASS/53skip, lint/type0은 **작성자 근거**로 검토했다. 이번 변경이 Date 설정/복원뿐이고 제품·assertion/fixture가 그대로임을 직접 확인했으며, 해당14건·미래 대조·cleanup 공백에 집중했다. 전체1177을 반복하거나 독립 수치로 계승하지 않았다. 별도 제품 build/공유 typegen도 실행하지 않았다.

소스 비교용 보조 도구의 최초 단순 scanner는 template literal 문맥을 올바르게 처리하지 못해 토큰 비교 오류가 있었다. AST leaf 비교로 고쳤고, 이후 s9.zip의 Git stdout이 기본1MB 상한을 넘어 생긴 ENOBUFS는64MB로 늘려 **실제 바이트 비교를 유지**했다. 최종 source-audit-final.log는 exit0이다. 이 보조 도구 오류는 제품 시험 실패로 세지 않으며 원로그를 보존했다.

## 정리·반환

모든 자기 Vitest/Node 명령이 종료됐다. 웹/DB 서버를 새로 시작하지 않았다. 기본 실제 Date 복원 및 프로세스 offset 기준 복원을 로그로 구분했고 OS 시계 설정 명령은 실행하지 않았다. 공유3013은 PID51032 유지, 공유 .next/Backend B5 WIP/실제 DB 접근·변경 없음. 물리 사본·source ZIP·CJS preload·검수 설정·JSONL·전체 대조 로그는 자기 격리 경로에 보존했다. 자동 승인 거절/거절 우회·설치·push/deploy는 없다.

Master 복사용: T2051c36974 고정 독립PASS입니다. 두 파일의 Date-only fake/setSystemTime/첫cleanup useRealTimers 외 AST토큰 전부 동일, assertion/fixture/제품 불변 및 s9 바이트 동일을 확인했습니다. 원14PASS, 실제/미래+365일 각각14+cleanup예외2PASS와 종료Date/timer복원16/16, 원본미래13FAIL/1PASS 대조로 시계혼용 재현, 원본−1일14PASS를 기록했습니다. Front 회신으로 과거−1일1실패는 실패명·원로그 미보존이 확정돼 원인 미확인으로 남겼고 소급 해소/제품 비회귀 확정을 주장하지 않습니다. 작성자1177/53skip은 검토만/독립합산없음. 종료830trackedblob 일치, OS시계·3013·공유.next·B5·실제DB 보호/증거보존, 고유보고서만 선택commit으로 반환합니다.
