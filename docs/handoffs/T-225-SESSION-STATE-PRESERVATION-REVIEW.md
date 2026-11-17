# T225 입력 상태 보존·탐색 경계 독립 재검수

- **PASS — 배정된 fixed SHA 범위에서 F221-1(P1) 입력 소실과 F221-2(P2) 작업 수·탐색 잔류가 해소됐다.** 새 필수 수정 발견 없음. 원 T221 FAIL 보고서는 그대로 보존한다. Master의 통합 수용이나 제품 전체 완료를 대신하지 않는다.
- 고정 **`8ffe3c75b5eaa908ee000f574cf688dd65125378`**, 부모 `745882e`. 작성자 보고 `605d904:docs/handoffs/T-224-SESSION-STATE-PRESERVATION-FIX.md`, T221 원문/실제 local 재현 자료를 비교했다. 후속 WIP를 섞지 않았다.
- 제품 수정 없이 고유 보고서와 자기 archive/합성 SQLite·TLS PG·fakeAuth·브라우저 관측 도구만 작성했다. 운영1.1과 3013/공유 .next/타 WIP 보호를 유지했다. 턴 밖 자동 점검은 미설정이다.

## F221-1: 실제 폼의 노드·값·선택·초점 보존

T221와 같은 제품 `scripts/db.ts migrate/seed`로 만든 **새 소유 SQLite**와 실제 fakeAuth 폼 로그인을 사용했다. 실제 StudioLayout→SessionBoundary→StudioShell→`/menus/shopping-shorts/new` ProjectForm을 열었다. 정적 마크업 비교나 별도 시험용 폼으로 대신하지 않았다.

각 경우에 실제 제목·목표 입력 후 원 input/textarea **객체 참조**를 저장했다. textarea에 실제 Home/ArrowRight/Shift+ArrowRight 키로 **선택 [3,7,forward]**를 만들었다.

| 실제 경로 | 1280 | 390 |
|---|---|---|
| offline→다른 탭 비신뢰 BC 신호→online→실제 same | 의심 중과 복원 뒤 **원 두 노드 동일·연결 유지, 두 값 유지, 선택 [3,7] 유지**. 안내로 옮겼던 초점은 원 textarea로 복구 | 동일 |
| online 비신뢰 신호→실제 same 응답 전달 보류→해제 | 같은 document·같은 두 노드·값·선택 유지. textarea 초점 복구 | 동일 |
| 위 보류 중 사용자가 Shift+Tab으로 로그아웃에 이동 | 값/노드/선택 유지. same 뒤에도 **로그아웃 초점을 유지**, 사용자 초점을 빼앗지 않음 | 동일 |

**6개 실제 상태 전환 모두 통과**했다. 의심 중 원 노드의 isConnected=true, identity=true였다. hidden+inert만 바뀌고 본문은 같은 자리에 유지됐다. `local-<width>-<mode>-before/suspect/after.json`, user-focus JSON, `network-local-matrix.json`에 값·선택 방향·객체 identity·document marker·activeElement를 함께 보존했다. 원 T221의 disconnected/빈 값 재현이 없어졌다.

## F221-2: sidebar/drawer/머리글 및 늦은 jobs 응답

처음 합성 jobs는 queued1/failed1이었다. 정상 상태의 sidebar 수와 머리글 `진행 0 · 대기 1`을 실제로 확인한 뒤 검사했다.

- **의심 상태 1280/390**: aside visibility:hidden+inert, 보이는 nav 링크0, 표시 작업 수0, 메뉴 disabled, 머리글 제목/상위 표시가 일반 `작업실`로 바뀌었다. 본문도 hidden+inert다.
- **열린 390 drawer**: 실제 메뉴 버튼으로 열었다가 신호를 받으면 닫혔고 메뉴가 disabled가 됐다. 실제 Tab6회 모두 nav/보호 본문 밖이었다. same 뒤 메뉴가 다시 활성화됐다.
- **확정 guard 1280/390**: 실제 다른 탭 B 로그인으로 첫 재로드→빠른 A 로그인. 본문 DOM0, aside 숨김+inert, 작업 수0, 메뉴 disabled, 제목 일반화. 실제 Tab7회씩 nav/본문 진입0.
- **확정 후 same**: 원 epoch B로 callback 로그인하고 서버 same을 다시 받아도, 같은 문서의 confirmed 본문/nav는 복원되지 않았다. 수동 새로 고침으로만 해소됐다.

jobs 경합은 응답 내용을 조작하지 않고 **실제 응답 전달 순서**로 검사했다.

1. old `/api/jobs` 응답(queued1/failed1)을 실제 서버에서 받은 뒤 전달만 보류했다.
2. 다른 탭 신호와 actual same 응답을 보류해 확인 상태를 유지했다. 작업 수·탐색은 가려졌다.
3. **자기 합성 DB만** 바꿔 old 두 작업을 succeeded로, 새 queued3개를 준비했다.
4. same을 해제하면 current로 돌아가 **새 jobs 요청**이 실행됐다. 새 실제 응답(queued3/failed0)도 잠깐 보류했다. 이 시점에 old epoch 수치는 다시 보이지 않았다.
5. current 상태에서 **old 응답을 먼저 전달**하고 두 paint frame 뒤 관측해도 sidebar/머리글 수치가 나타나지 않았다.
6. fresh 응답을 전달하면 **대기3만 표시**, old 실패1 재등장 없음. 새로 받은 값과 새 epoch만 사용했다.

증거: `drawer-*`, `local-guard-*`, `local-confirmed-*`, `jobs-01-old-held-suspect.json`~`jobs-04-fresh-epoch3.json`, `jobs-fixture-change.json`, `network-drawer-jobs-start.json`, `network-jobs-release.json`. 실제 old/fresh 응답 body·시각·전달 순서를 보존했다. 종료 시 소유 DB는 프로젝트1/jobs5이며 추가3은 검수 도구가 만든 fixture다. **사용자 폼의 `/api/projects` POST는0**이었다.

source의 `[pathname,confirmed,epoch]` effect cleanup/disposed, `received.epoch===epoch` 조건, 의심 동안 fetch/poll 중지, fresh fetch를 검토했다. 감시 hook 자체에 새 타이머/poll은 없다. **기존 jobs poll 타이머는 존재**하며 확인 상태 밖에서 취소된다. 모든 비동기 경합을 증명한 것으로 확대하지 않는다.

## T220/T216 경계 회귀

같은 실제 브라우저 두 탭을 cloud origin으로 옮겨 합성 TLS PostgreSQL·실 SDK fakeAuth 환경에서 실행했다.

| 항목 | 실제 결과 |
|---|---|
| cloud 15초 guard | 변경 확정 뒤 old 보호 DOM0. 이후 원 epoch same 답에도 DOM0 유지, 수동 새로 고침 뒤 현재 계정 |
| offline390 상세→다른 탭 logout | old B 제목/정보 표시 없음, hidden+inert. 안내에 초점, hidden 링크 focus 시도/실제 Tab7회로 old 본문 접근0. online 뒤 로그인 이동 |
| session URL만 차단390 | navigator online, 확인 불가 안내·hidden+inert, 보이는 old 카드/링크0 |
| late same 경합 | B의 actual same 응답 전달 보류→A 실제 폼 로그인 신호→해제. 이전 문서 observer 기록에 **old B 이메일/보이는 본문 재등장0**, 새 document A 목록 |
| confirmed 이후 same | local/cloud 모두 재검증. 확정된 본문을 같은 문서에서 다시 보여 주지 않음 |
| 새 프로젝트 준비 화면 | 실제 Link로 `/cloud/projects/new`, 입력 폼 없음. 같은 epoch 신호→가림→same 뒤 같은 문서에서 안내·링크 복원 |
| legacy CloudPending390 | offline 신호로 “로그인 정상” 문구·내용 가림, same 뒤 같은 문서 복원, 다른 탭 B 로그인 처리 |
| 정상/partial logout | 실제 버튼, partial은 provider 500와 정확한 안내. 다른 탭도 로그인 이동. 새 API 요청 **401/no-store** |
| native history·같은 layout Link | A 상세→B 전환은 B 기준 찾을 수 없음. 실제 뒤로/앞으로에서 old A 본문 재등장 없음. 현재 B 목록 Link에 B 카드만 표시 |
| prefetch | 실제 제품 Next Link의 RSC/prefetch 요청 기록. fake popstate/focus/권한 이벤트로 대체하지 않음 |

`06`~`08`, `19`~`39` 번호 JSON, `cloud-guard-*`, `cloud-confirmed-*`, network 자료를 보존했다. mutation 기록은 관측한 렌더 변화 범위이며, 모든 미세 타이밍·브라우저 메모리 삭제 보장이 아니다. 서버 권한 우회를 고쳤다고 해석하지 않는다.

## 독립 실행·고정 근거

- 소유 root **`D:/starwork/t225-state-8ffe3c7`**, 새 archive `D:/starwork/t225-source.zip`. 물리 dependencies/PG/OpenSSL은 이전 소유 사본에서 복사했다. 설치/공유 checkout/공유 .next 사용 없음.
- 시작·종료 root와 실제 runner app 모두 **추적969개 Git blob 차이0**. 원 runner의 overlay7도 fixed 기준과 같다. 검수용 helper·synthetic runtime은 추적 제품 밖에만 있다.
- 원본 `tests/t213-cross-tab-session-http.mjs`를 수정 없이 실행: `tmp/t213-http-7a7480a3-e348-410d-9953-6980e0b193c1`, fixed8ffe3c7. 새 합성 TLS PG·실 SDK fakeAuth, production build+내장 TypeScript 검사, **14 HTTP 관측 PASS**, hold 해제/local 대조/finally 완료 exit0. PG API/admin 모두 **TLS1.3/TLS_AES_256_GCM_SHA384** 기록.
- 관련 **9 files / 427 PASS**, t220 신규/수정 시험 **18은 이 수에 포함**된다. 이 단위 시험의 마크업 동일성만으로 폼 보존을 판정하지 않았다.
- 같은 고정 원본 runner app에서 **next typegen0 → tsc --noEmit0 → eslint .0 → verify-build0**를 독립 실행했다. 공유 WIP가 섞인 작성자 lint/type 결과를 대신 가져오지 않았다. logs: `raw-checks.json`, `raw-typegen.log`, `raw-tsc.log`, `raw-lint.log`, `raw-verify-build.log`.
- `tmp/t225/analyze.mjs`: 보존 관측의 **21개 사실 assertion PASS**. 여러 실제 시나리오를 묶은 사후 검증이며 427개와 별개 제품 단위 시험 수로 합산하지 않는다.
- 전체 suite는 요청대로 반복하지 않았다. 과거 t164/T223 결과를 이번 focused 결과로 전체 PASS 처리하지 않는다.

주요 명령:

```powershell
node tmp/t225/verify-baseline.mjs
node tmp/t225/prepare-local.mjs
node tmp/t225/run-related.mjs
node tests/t213-cross-tab-session-http.mjs --bin D:/starwork/t225-state-8ffe3c7/.tools/pgsql/bin --openssl D:/starwork/t225-state-8ffe3c7/.tools/openssl/openssl.exe --hold
node tmp/t225/prepare-browser.mjs
node tmp/t225/local-server.mjs
ego-browser nodejs -e "await import('file:///D:/starwork/t225-state-8ffe3c7/tmp/t225/browser-01.mjs')"
# 같은 TaskSpace13의 browser-02…12, jobs old/fresh 사이 mutate-jobs 실행
node tmp/t225/mutate-jobs.mjs
node tmp/t225/raw-checks.mjs
node tmp/t225/analyze.mjs
node tmp/t225/verify-runtime.mjs
```

근거는 root `evidence/`의 상태별 JSON·form identity/selection/focus·shell 상태·실제 request/signal·PNG·network·관련/raw checks·source identity, 원 run의 build/http-results/tls/fake-events/run/next-stop/stop logs에 있다. 직접 열어 확인한 `local-1280-offline-suspect.png`와 `local-guard-390.png`도 보존했다. 도구는 `tmp/t225/`에 있다.

관측 도구 오류 한 건을 제품 실패와 구분했다. local guard의 자동 문서 교체 전에 passive 관측기를 새 문서에 등록하지 않아 transport가 undefined였다. shell driver가 이어 소유 local 서버를 종료해 그 뒤 same 관측은 채택하지 않았다. 같은 TaskSpace와 **이미 확정된 문서**를 보존하고 local 서버만 재시작한 뒤 관측기를 등록해 actual same 미복원과 로그아웃을 마쳤다. restart 전/후 소유 PID를 따로 보존했으며 제품 코드는 바꾸지 않았다. cloud 문서 전환 대기는 이전 helper 한계를 피하도록 현재 문서 상태를 다시 읽는 bounded observable wait를 사용했다.

## 한계·정리·반환

- **자연 JWT exp/refresh 회전, 실제 frozen/hidden 탭, BFCache persisted=true 복원, 다른 브라우저/기기, 실 Auth/managed/원 DB/배포는 미검증**. 이번 native history를 BFCache 복원 성공으로 확대하지 않는다.
- T220 작성자의 과거 원인 미확정 문서 이동은 원인을 입증하지 못했으므로 여전히 미확정이다. 이번 정상 전환 관측으로 과거 사건을 소급 정상 처리하지 않는다. 입력 보존도 계정 변경이 확정된 뒤까지 보존한다는 뜻이 아니며, 그때는 본문을 제거한다.
- 브라우저 TaskSpace13은 합성 세션 로그아웃 뒤 마지막 별도 script로 finish(keep[]) 했다. local 첫 harness/Next **59272/56268**, 재시작 **53416/62568** 모두 종료/exit0. 원 runner parent **72860**, cloud Next **28400**, local 대조 Next **16924**, PG **75376** 종료, `server stopped`/postmaster.pid 없음.
- 마지막 실제 확인 **2026-11-17 21:49:02 +09:00 (Asia/Seoul)**: 소유 **63113/52405/63112/43354/43355 listener0**, 위 PID process0·소유 root node0·PG pid file 없음. 사용자 **3013 PID51032 유지**.
- 공유 제품/공용 대장·타 WIP·실 DSN/Auth/DB·OS 시계·배포를 변경하지 않았다. 소유 사본과 증거는 보존한다. 이 고유 보고서만 선택 커밋, push 없음.

Master 반환 요지: fixed8ffe3c7에서 실제 local 폼의 두 원 재현을 1280/390에서 검사해 **동일 노드·입력·선택·초점 복구/비탈취 PASS**, sidebar/drawer/작업 수 경계와 old jobs 응답 폐기·fresh epoch 표시도 PASS입니다. cloud 세 경로·late same·confirmed same 미복원·정상/partial/legacy/새 준비/native history 회귀도 통과해 **T225 배정 범위 PASS**로 반환합니다. 원 T221 기록과 위 미검증/과거 미확정은 유지합니다.
