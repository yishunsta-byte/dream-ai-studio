# T315 Next 보호 응답 재현 자료 고정

- 담당: Codex(Front) · 배정 Master `msg_b92601c6fbd1` · 기준 T314-R(`103e4af`) 재현 준비물·측정표
- 제품 기준 소스: `131fde6`. 이후 커밋은 문서·이 시험 폴더뿐이라 제품 코드는 같아요.
- 환경: Node v26.13.0, Next.js 16.4.6, 고정 `package-lock.json`, 인증 꺼짐(`.env.local` 없음, 사본에는 추적된 `.env.example`만 있음), `next start` 127.0.0.1 루프백
- 커밋 범위: `tests/reference-analysis/t315-next-response-egress/`와 이 보고서. 제품 파일·공유 `.next`·운영·배포 변경은 없어요.

## 고정 산출물

| 파일 | SHA-256(LF 기준) | 내용 |
|---|---|---|
| `fixture/lib/t315/gate.ts.fixture` | `30c21742…407ea` | 합성 허가·사건 기록(epoch ms, 요청 ID) |
| `fixture/app/api/t315-control/route.ts.fixture` | `1275bc71…e1a73` | 루프백 조작 창구(발급·철회·만료·해제·상태) |
| `fixture/app/api/t315/[kind]/route.ts.fixture` | `edf7aa8e…3bd76` | 합성 보호 응답 HTML·RSC 유사·POST JSON. 반환 전 대기 / 첫 pull 대기·소비 / 매 pull 철회 확인 |
| `fixture/app/t315/page/page.tsx.fixture` | `fa8ffaba…40437` | 실제 App Router 페이지(Suspense 없음) |
| `fixture/app/t315/suspense/page.tsx.fixture` | `fe78cd12…3eaf0` | Suspense 페이지(공개 셸 → 보호 영역) |
| `client.mjs` | `da27b04e…65a5` | 측정 클라이언트(실제 TCP, 원시 JSONL·요약) |
| `install-fixture.mjs` | `1912028c…bf69ea` (T315-F2, 이전 F1 `25e59f31…ccec4`, 최초 `75495a59…8ec4`) | 쓰기 전 전체 검사(실제 루트·링크/정션·Git 작업 트리·원본 해시·목적지 충돌) 뒤 5개 설치. 배타 생성 직후부터 추적해서, 실패하면 이 호출 변경만 정리 |
| `install-fixture.check.mjs` | `2360a7de…db36133` (T315-F2, F1 `73a393f8…48640`) | 설치기 회귀 시험 18경우(OS 임시 합성 폴더 전용) |
| `SHA256SUMS` | — | 위 8개 전체 해시 |
| `raw/run-1.jsonl` · `raw/summary-1.json` | `89cc681c…6b74` · `18d7995c…a78d` | 1회차 원시 사건(1,197줄)·요약(34경우) |
| `raw/run-2.jsonl` · `raw/summary-2.json` | `b01218e2…70f4` · `1256a018…1cac` | 2회차 |

- 시험 파일은 `.fixture` 확장자예요. 그래서 저장소의 tsc·ESLint·Next 빌드 대상이 아니고, 설치할 때 원래 이름으로 복사돼요.
- `client.mjs`·`install-fixture.mjs`는 ESLint를 통과했어요.
- 원시 기록에는 비밀값·경로·계정이 없어요. 항목은 사례·시각·티켓·요청 UUID·상태·헤더·바이트 수예요.

## 실행 절차 (Main PC에서 그대로 실행)

```powershell
# 1) 고정 소스 격리 사본 (작업 저장소 밖 임시 폴더)
git archive -o <tmp>\src.tar 131fde6 ; tar -x -f <tmp>\src.tar -C <tmp>\app
robocopy node_modules <tmp>\app\node_modules /E      # rc=1 정상, 사본에 .env.local 없음 확인
# 2) 시험 파일 5개 설치 (해시 대조)
node tests\reference-analysis\t315-next-response-egress\install-fixture.mjs <tmp>\app
# 3) production 빌드·시작 (사본 안에서)
npm run build
$env:NODE_ENV='production'; node node_modules\next\dist\bin\next start -H 127.0.0.1 -p 43315
# 4) 측정 (작업 저장소 쪽, 출력 파일은 새 이름 — 덮어쓰지 않음)
node tests\reference-analysis\t315-next-response-egress\client.mjs 43315 <out>\run.jsonl <out>\summary.json
# 5) 정리: 서버 중지 → 사본 삭제 → 포트 43315 대기 0 확인
```

같은 서버에 두 번 실행해도 돼요. 허가 ID가 늘어나서(`p1`→`p53`) 정상 본문 길이가 1바이트 차이 나는 것만 달라요.

## 기록 방식 (검수 요청 반영)

- **시각:** 서버·클라이언트 모두 `performance.timeOrigin + performance.now()`(시스템 시계 epoch ms, 0.01ms)로 남겨서 하나의 시간 축에 합쳤어요.
  - 같은 PC의 두 프로세스 기준이에요.
  - 순서가 중요한 판정은 "클라이언트가 멈춘 동안 읽은 서버 상태"(`client:paused-snapshot` 등)로도 따로 남겼어요.
- **사건:**
  - 클라이언트: `request:send`, `response:headers`(상태·최종 헤더), `response:firstByte`, `response:data`(누적), `client:pause/resume/destroy`, `response:close`(종료 원인), `request:error`, 제어 확정(`control:*:confirmed`, 서버 확정 시각 포함)
  - 서버: `control:*`, `handler:*`, `stream:firstPull/hold/released/consumed/enqueue(누적)/close/stop/cancel`, `request:abort`, `after:run`, `render:*`
- **대기 구간과 최종 응답을 따로 둬요:** `waiting`(대기 중 상태·헤더 도착 여부·바이트)과 `final`(최종 상태·헤더·바이트·SHA-256·종료 원인·보호 표식 수)이에요.
- **버퍼 위치는 단정하지 않아요.** 서버 enqueue 누적량과 클라이언트 data 콜백 누적량만 비교해요.

## 측정 결과 (두 실행 모두 같음, 34경우)

| 경우 | 대기 구간 | 최종 | 허가 |
|---|---|---|---|
| A 정상 ×3(HTML·RSC·POST) | — | 200, 정확한 형식, `private, no-store`, 보호 표식 1. 재사용 409·0B | 소비 1 |
| B 반환 전 대기 · 철회 ×3 | 상태 없음·헤더 없음·0B | 403, 0B, 정상 종료 | 미소비 |
| B 반환 전 대기 · 만료 ×3 | 같음 | 410, 0B, 정상 종료 | 미소비 |
| C 첫 pull 대기 · 철회 ×3 | 상태 없음·헤더 없음·0B (서버는 이미 `handler:return`) | **상태·헤더 없이 `ECONNRESET`**, 0B, 표식 0 | 미소비 |
| C 첫 pull 대기 · 만료 ×3 | 같음 | 같음 | 미소비 |
| D 512KB 느린 수신 · 철회 | 정지 때 클라이언트 65,529B, 서버 enqueue 524,288B, `stream:close`·`after:run` **이미 발생** | 철회는 close 뒤라 막을 대상이 없어요. 재개 뒤 458,759B 더 관측, 200 정상 종료, 표식 8 | 소비 |
| D 512KB 느린 수신 · 철회 없음 | 같음 | 같음(대조군) | 소비 |
| D 4MB 느린 수신 · 철회 | 정지 때 65,529B / enqueue 655,360B, close·after 없음 | 재개 뒤 589,831B 더 관측, 그다음 서버 `stream:stop:revoked`(enqueue 655,360 그대로) → `aborted`. 최종 655,360B, 표식 10 | 소비 |
| D 4MB 느린 수신 · 철회 없음 | 같음 | 4,194,304B 정상 종료, 표식 64. close·after는 다 읽은 뒤 | 소비 |
| E 취소(RSC·POST, 4MB) | 정지 때 65,529B / enqueue 655,360B | 파괴 뒤 서버 `request:abort`·`after:run`·`stream:cancel`, 추가 enqueue 0 | 소비 |
| F 페이지 렌더 대기 · 철회/만료 | 상태 없음·헤더 없음·0B | 404(공용 안내 6,109B), 보호 표식 0 | 미소비 |
| F 페이지 정상 | — | 200, 표식 2(HTML 본문 + 인라인 RSC 데이터), 재사용 404 | 소비 1 |
| F RSC(`RSC: 1`) | — | 첫 응답 307 → `?…&_rsc`, 따라가면 200 `text/x-component`, 표식 1 | 소비 1 |
| F 기본 프리페치(`RSC: 1`+`Next-Router-Prefetch: 1`) | — | 307 → `_rsc=<해시>`, 따라가면 200, 277B 라우트 트리, 표식 0 | 미소비, 렌더 0 |
| F 렌더 확인 뒤 철회(3MB 블록) | 철회 때 65,016B | 200 정상 종료, 6,006,691B. 3MB 블록 2회(HTML + RSC 데이터), 표식 2 | 소비 |
| G Suspense · 철회/만료 | **200, 헤더 도착**, 6,780B(공개 셸 2·로딩 2·보호 표식 0) | 200, 보호 표식 0, `T315-WITHHELD` 2 | 미소비 |
| G Suspense · 정상(대조) | — | 200, 보호 표식 2 | 소비 |

### 합친 시간 축 예 (1회차, 사례 시작 기준 ms, s=서버 c=클라이언트)

```
D-slow-html-512KB-revoke
  2.2 s stream:consumed   2.4 c headers 200 / firstByte / pause   3.1 s stream:close(enq 524288)   3.1 s after:run
  717.0 s control:revoke  1035.5 c resume   1036.2 c close end=end   (data 콜백 마지막 1036.2)
D-slow-html-4MB-revoke
  3.4 c pause   743.5 s control:revoke   1049.9 c resume   1050.2 s stream:stop:revoked(enq 655360)
  1051.0 s request:abort / after:run   1051.5 c close end=aborted
C-first-pull-post-expire
  3.7 s handler:return / stream:firstPull / stream:hold   329.9 c waiting: 상태 없음
  331.7 s control:expire   333.7 s stream:stop:expired   333.8 c request:error(ECONNRESET)   334.4 s request:abort
```

## T314 보고 문구 보완 (검수 지적 반영)

1. **"헤더 0"은 대기 구간 한정이에요.** B·C·F 대기 중에는 상태·헤더가 없었어요.
   - B·F는 최종에 403/410/404 헤더가 있어요. C는 최종에도 상태·헤더 없이 연결이 끊겨요.
   - 이번에는 C의 만료도 측정했어요(철회와 같음).
   - 호스트가 헤더를 먼저 확정하는 경우는 여전히 미관측이에요.
2. **"약 0.6MB"는 이 실험의 관측량이에요.** 서버 enqueue 누적과 클라이언트 콜백 누적의 차이일 뿐이에요.
   - 그 바이트가 서버·커널·수신 측 중 어디 있었는지, 철회 뒤에 네트워크를 지났는지는 이 기록으로 가를 수 없어요.
3. **512KB 종료 비교:**
   - 철회 유무와 관계없이 `stream:close`·`after:run`이 클라이언트 65,529B 시점에 이미 일어났고, 재개 뒤 나머지가 정상 종료로 왔어요.
   - 4MB는 다 읽은 뒤에야 close가 왔어요.
   - 따라서 앱 신호는 클라이언트 수신 완료의 증명이 아니에요.
4. **T314의 "6,006,726B":** 원시 본문 기준으로 3MB 블록이 **HTML과 인라인 RSC 데이터에 두 번** 실려 있어요(이번 6,006,691B, 차이는 허가 ID·요청별 값 길이).
5. **페이지 판정:** 상태 코드·공개 셸과 보호 본문을 따로 판정했어요.
   - Suspense: 대기 중 200·셸이 이미 전송됐고, 보호 표식은 0이에요.
   - RSC: 실제 307 → `_rsc` 경로를 따랐어요.
   - 기본 프리페치: 렌더·소비 0이에요.

## T315-F1 설치기 경계 보완 (T315-R F315-1)

배정은 Master `msg_d5d86a167246`이에요. 바꾼 파일은 `install-fixture.mjs`(수정), `install-fixture.check.mjs`(신규), `SHA256SUMS`(설치기 해시 갱신·회귀 파일 추가), 그리고 이 문서예요.

**지적 내용 (F315-1):**
- 대상 `app`이 다른 폴더로 가는 정션이면 설치가 성공해서 루트 밖에 파일이 생겼어요.
- 마지막 목적지만 이미 있으면 앞의 4개를 쓴 뒤에야 실패했어요.

**바뀐 동작 (쓰기 전에 전부 검사, 하나라도 걸리면 아무것도 안 써요):**
1. 루트는 존재하는 일반 디렉터리여야 해요. 루트 자체가 링크·정션이면 거절하고, 이후 판정은 실제 경로(`realpath`) 기준이에요.
2. 실제 루트와 **모든 상위 폴더**에 `.git`(폴더 또는 worktree 형식 파일)이 있으면 거절해요.
3. `package.json`은 일반 파일, `app`은 일반 디렉터리여야 해요. 링크·정션이면 거절해요.
4. 원본 5개는 일반 파일이어야 하고, `SHA256SUMS` 해시와 같아야 해요.
5. 루트부터 각 목적지까지 이미 있는 중간 폴더는 일반 디렉터리여야 하고, 실제 경로도 그 위치와 같아야 해요. 목적지 자체는 어떤 형태(파일·폴더·링크·끊어진 정션)로도 있으면 안 돼요. **5개를 모두 검사한 뒤에만** 써요.
6. 폴더는 하나씩 만들면서 기록하고, 파일은 `wx`로 써요. 쓴 뒤 실제 경로·해시를 다시 확인해요. 도중에 실패하면 이 호출이 만든 파일(해시가 같을 때만)과 폴더(비어 있을 때만)만 역순으로 지워요.
7. 종료 코드는 거절 2, 그 밖의 실패 1이에요. 메시지에는 루트 기준 상대 경로만 넣어요(절대 경로 없음).
8. 회귀 시험용 실패 주입: `T315_INSTALL_FAIL_AFTER=<n>`.

**회귀 시험** (`node tests/reference-analysis/t315-next-response-egress/install-fixture.check.mjs`):
- OS 임시 폴더 아래 새 합성 폴더에서만 돌고, 끝나면 지운 뒤 없어졌는지 확인해요.
- 설치기를 별도 Node 프로세스로 실행해요. 거절 경우마다 실행 전후 합성 폴더 전체 목록(경로·형식·내용 해시)이 같은지 비교해요.

| 경우 | 결과 |
|---|---|
| 정상 격리 사본 | 0, 5개 설치, 해시 일치, 링크 없음 |
| 같은 사본 재설치 | 2 `already exists: lib/t315/gate.ts`, 변화 없음 |
| `app`이 정션 | 2 `app must be a regular directory`, 변화 없음, 바깥 폴더 비어 있음 |
| 중간 폴더 `app/t315`가 정션 | 2 `link or junction in destination path`, 변화 없음, 바깥 폴더 비어 있음 |
| 루트 자체가 정션 | 2 `root is a symbolic link or junction`, 변화 없음 |
| 루트에 `.git` 폴더 / `.git` 파일 / 상위 폴더에 `.git` | 2 `git working tree detected …`, 변화 없음 |
| 마지막 목적지만 있음 | 2 `already exists: app/t315/suspense/page.tsx`, 변화 없음(앞 4개·새 폴더 없음, 기존 파일 그대로) |
| 목적지가 끊어진 정션 | 2 `already exists`, 변화 없음 |
| 중간 경로가 파일 | 2 `not a directory in destination path: lib`, 변화 없음 |
| 원본 하나 변조(합성 폴더에 복사한 설치기·원본) | 2 `hash mismatch: app/t315/page/page.tsx`, 변화 없음 |
| Next 앱 아님 / 없는 루트 | 2, 변화 없음 |
| 2개 쓴 뒤 실패 주입 | 1 `rolled back this call's changes`, 변화 없음(기존 `app/keep/own.txt` 보존) |

**확인 결과:**
- 15/15 통과(두 번 실행), ESLint 통과.
- 같은 회귀 시험을 이전 설치기(`766b3ef`)로 돌리면 `app-is-junction: should fail`에서 실패해요. 지적이 재현된 뒤 새 설치기로 되돌렸어요.
- **정상 격리 사본 실제 설치:**
  - `git archive 131fde6`을 임시 폴더에 풀어 설치하면 0이고, 5개 해시가 위 표와 같아요.
  - 같은 사본에 다시 설치하면 2(충돌)예요.
  - 작업 저장소 루트를 지정하면 2 `git working tree detected at root`이고, 저장소에 새 파일은 없어요.
  - 이후 임시 사본은 지웠어요.
- 시험 파일 5개·`client.mjs`·원시 기록은 바뀌지 않았어요. 해시는 그대로예요.

## T315-F2 쓰기 오류 정리 보완 (T315-F1-R F315-F1-R1)

배정은 Master `msg_717af4661624`이에요. 바꾼 파일은 `install-fixture.mjs`, `install-fixture.check.mjs`, `SHA256SUMS`, 그리고 이 문서예요.

**지적 내용:** `writeFileSync(wx)`가 성공한 뒤에야 정리 목록에 넣었어요. 그래서 파일은 생겼는데 데이터 쓰기에서 실패하면(예: 저장 공간 부족) 부분 파일이 남을 수 있었어요. 특히 기존 폴더 아래 목적지라면 폴더 삭제 실패로도 드러나지 않았어요.

**바뀐 동작:**
- 목적지를 `openSync(path, "wx")`로 배타 생성해요. **생성 직후, 데이터를 쓰기 전에** `fstat`(bigint)의 `dev·ino`와 함께 이 호출의 파일로 추적해요.
- 데이터는 `writeSync` 반복으로 다 쓴 뒤 닫고, 실제 경로·해시를 다시 확인해요.
- 실패하면 역순으로 정리해요.
  - 열린 핸들을 닫아요.
  - 같은 경로가 아직 **같은 파일**(일반 파일, `dev·ino` 일치)이면 내용이 부분적이어도 지워요.
  - 없으면 넘어가요.
  - 다른 파일로 바뀌었으면 보존하고 `(replaced, preserved)`로 보고해요.
  - 새로 만든 폴더는 비어 있을 때만 지워요.
- **원래 오류 객체·메시지를 그대로** 던지고 정리 결과만 뒤에 붙여요(종료 코드: 거절 2, 그 밖 1).
- F1의 정션·전체 사전 검사·사후 검증은 그대로예요.
- 시험용 주입을 추가했어요: `T315_INSTALL_FAIL_DURING_WRITE=<n>`(n번째 파일을 배타 생성하고 절반만 쓴 뒤 실패), `T315_INSTALL_REPLACE_BEFORE_ROLLBACK=1`(실패 직전 그 경로를 다른 파일로 교체).

**회귀 추가 (18경우, 2회 모두 통과, OS 임시 합성 폴더만 사용):**

| 경우 | 결과 |
|---|---|
| 기존 폴더 `app/api/t315/[kind]` 아래 세 번째 파일을 쓰는 중 실패(기존 `own.txt` 있음) | 1, 메시지 `injected write failure (T315_INSTALL_FAIL_DURING_WRITE) (rolled back this call's changes)`, 합성 트리 전체가 전과 같음(부분 파일 없음, `own.txt` 보존, 앞서 만든 파일·폴더 정리) |
| 첫 파일 쓰는 중 실패(새 폴더 안) | 1, 같은 원래 오류, 트리가 전과 같음 |
| 실패 직전 그 경로가 다른 파일로 바뀜 | 1, `rollback left: app/api/t315/[kind]/route.ts (replaced, preserved)`. 트리에서 사라진 항목 0, 추가된 항목은 그 외부 파일 1개뿐이고 나머지는 정리됨 |

- F1의 15경우도 모두 그대로 통과했어요. ESLint도 통과예요.
- 정상 격리 사본(`git archive 131fde6`) 실제 설치는 0이고 5개 해시가 일치해요. 작업 저장소 지정은 2이고 저장소 변화는 없어요. 사본은 지웠어요.
- 이전 설치기(F1)에는 쓰기 중 실패 주입 지점이 없어서, 같은 회귀로 결함을 재현하는 대조는 할 수 없어요. 지적은 코드 경로로 확인한 사항이에요.

## 범위 밖 (후속)

- 전체 프리페치(`prefetch={true}`), 브라우저 라우터 캐시·bfcache(HTTP 시험 뒤 별도 브라우저 시험)
- 실제 호스트·프록시의 사전 버퍼링, 헤더 선확정, 취소 전달, 패킷·전송 큐 관측
- 제품 분석 라우트(`Response.json` DTO)에 이 방식을 적용하는 일

## 정리

- 서버(43315)를 멈췄고 포트 대기 0이에요.
- 격리 사본을 지웠고 원본 `node_modules`는 283개 그대로예요.
- ego는 쓰지 않았어요.
