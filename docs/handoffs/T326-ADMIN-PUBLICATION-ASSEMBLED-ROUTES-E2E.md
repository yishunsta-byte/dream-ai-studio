# T326 관리자·공개 라우트의 공통 게시 조립 종단 검증

2026-11-19 · Codex(Front)
- 배정: Master `msg_618e8f6a372a`, 추가 범위 승인 `msg_f9785cc3305c`
- 기준: `80aaa34`(T325) 위 HEAD `5980904`

## 범위와 파일

| 파일 | 구분 | 내용 |
|---|---|---|
| `tests/admin/t326-publication-assembled-inject.ts` | 신규 | T325 `assemblePublicationProviders()`를 프로세스 안에서 **한 번** 호출해요(globalThis 공유). 그 결과를 관리자 저장소·공개 목록·표지에 나눠 줘요. 관리자 공급원은 T306 저장소(계정별 PG 로그인)이고, 대상 ID는 실제 연결의 `host(inet_server_addr()):inet_server_port()/current_database()`예요. 공개 공급원은 T298 격리 리더예요. 역할·DB·호스트·포트·버전을 실제 연결로 증명한 값을 대상 ID로 써요. 열기·닫기는 기록 파일(`T326_EVENTS`)에 남겨요. |
| `tests/admin/t326-publication-assembled-e2e.mjs` | 신규 | 진행기예요. 모드마다 격리 Next 운영 서버를 새로 띄워요(서버 한 번 = 조립 한 번). 관리자 GET·POST, 홈, 표지 GET·HEAD를 HTTP로 실행하고, T306 제어 창구로 DB 상태를 확인해요. 끝나면 프로세스 트리를 종료하고 포트 대기 0을 확인해요. |
| `tests/admin/t306-publication-e2e-native.ts` | 수정(Master 승인 범위) | 서버 모드 제어 창구에 `POST /cover?slug=&generation=`만 추가했어요. 자세한 내용은 아래에 있어요. 기존 경로·고정 SQL 해시·`--scenarios`는 바꾸지 않았어요. |
| 이 문서 | 신규 | |

바꾸지 않은 것:
- 제품 파일, 공용 SQL, 공유 `.next`
- 운영 DB·Storage, 권한, 배포
- 제품 기본 연결: `productionPublicationStore()`는 `null`, `publicationShowcaseConnection`은 닫힘 그대로예요

### T306 실행기 `/cover` (재게시용 세대별 합성 표지)

- 시드 slug 4개(`neon-alley`·`timed-coast`·`drift-dune`·`b-harbor`)만 받아요. 모르는 slug나 형식 오류는 400이에요.
- **안전한 다음 세대만 받아요.** 준비 중이면 그 준비 세대, 아니면 리비전+1이고, 2 이상이어야 해요. 그 밖은 409이고 허용 세대를 알려 줘요.
- 객체 키는 `slug/세대/<실행기 합성 표지 sha>.webp`, 바이트는 실행기가 만든 같은 합성 webp예요. 요청에서 키나 바이트를 받지 않아요.
- 한 트랜잭션 안에서 처리해요.
  - 작품 행을 `FOR UPDATE`로 잡아요.
  - 표지 행이 없으면 넣고, 같은 바이트가 이미 있으면 재사용해요(`reused: true`).
  - **다른 바이트가 이미 있으면 보존하고 409로 롤백해요.**
  - 그다음 `t293.evidence`의 `cover.objectKey`를 갱신해요.
- '다른 바이트 보존' 분기는 HTTP로 다른 바이트를 넣을 길이 없어서 실측하지 못했어요. 코드 경로로만 확인했어요.

## 격리 실행 절차 (커밋하지 않는 부분)

1. 사본을 만들어요.
   - `git archive HEAD`를 임시 폴더에 풀어요.
   - 신규 inject를 복사해요.
   - `node_modules`와 `.tools/t253-postgres-17.12`는 robocopy로 복사해요(정션 없음).
2. 사본 전용 패치 4곳을 적용해요.
   - `lib/auth/resolve.ts` `resolveServerAuth` → T306 `t306Auth`(쿠키 `t306-actor`=A·B·X)
   - `admin-publication-http` `productionPublicationStore()` → `t326AdminStore()`
   - `publication-showcase-connection` `publicationShowcaseConnection` → `t326PublicReaders()`를 기다리는 thenable. 조립 모듈이 이 모듈을 import하는 순환 때문에 즉시 호출하면 TDZ 오류가 나요.
   - `instrumentation.ts` `register()` → `await t326Ready()`. 서버가 요청을 받기 전에 조립을 끝내요.
3. `npm run build`(운영 빌드)를 실행해요. 빌드 중에는 `T306_CONFIG`가 없어서 조립 옵션 없이 닫힌 상태가 되고, 오류는 0이에요.
4. 사본에서 `node --conditions=react-server --import tsx tests/admin/t306-publication-e2e-native.ts`를 실행해요. 소유 루프백 PG17 임시 클러스터와 제어 창구가 떠요.
5. `node tests/admin/t326-publication-assembled-e2e.mjs <사본> <실행기 출력> <기록 폴더>`를 실행해요.
6. 제어 `POST /done`을 보내요. 실행기가 연결 종료 → 클러스터 정지 → 리스너 없음 확인 → 임시 폴더 삭제를 해요.

## 결과 (3번째 실행, 새 클러스터, 전부 assert 통과·종료 코드 0)

### 1. 닫힘 모드 (모드마다 새 서버)

| 모드 | 조립 기록 | 관리자 GET | 관리자 POST(준비) | 홈 | 표지 GET/HEAD | DB 원장 |
|---|---|---|---|---|---|---|
| `missing` 구성 없음 | 시작 → inactive. 열기 없음 | 200 `closed` | 503 `PUBLICATION_UNLINKED` | 200 예시 | 404/404 `no-store` | 변화 0 |
| `admin-mismatch` 승인 대상이 다른 DB | admin-open(실제 대상) → `admin-close pools=0,0` → inactive. 공개 열기 안 함 | 200 `closed` | 503 | 200 예시 | 404/404 | 변화 0 |
| `cover-mismatch` 표지 대상만 다름(합성) | admin-open → public-open → `admin-close pools=0,0` → `public-close` → inactive | 200 `closed` | 503 | 200 예시 | 404/404 | 변화 0 |

- 세 모드 모두 관리자·홈·표지가 **함께** 닫혔어요. 열린 핸들은 모두 닫혔다고 기록됐어요(풀 연결 0).
- 서버 종료 뒤 포트 대기는 0이에요.

### 2. 정상 모드 (조립 한 인스턴스: 시작 기록 4줄, 종료 시에도 4줄로 재조립 없음)

**준비:**
- 홈에 작품이 없었어요.
- `neon-alley` 준비 결과는 `prepared` v1이에요. 준비 뒤에도 홈 미노출, 표지 404/404예요.

**같은 요청 동시 5회 완료:**
- 5개 모두 `200 published`예요.
- 그 requestId의 원장 1건, 감사 1건, T295 요청 1건이에요.
- 전체 집계는 앱·감사·T295·T253이 각각 1 → 2로 늘어서 **한 번만 처리**됐어요.

**홈·표지:**
- 홈은 200이고 작품이 보여요. `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`예요.
- 표지 세대 1은 GET 200 `image/webp` `no-store`, sha `c7382c242fe7`이에요. HEAD는 200이고 본문 0B예요.
- 없는 세대 2는 404/404예요.

**서로 다른 requestId 동시 철회 4회:**
- `revoked` 1회, `conflict` 3회예요.
- 철회 뒤 홈 미노출, 표지 1은 404/404예요.

**재게시:**
- 준비 결과 `prepared` v4 세대 4예요.
- 실행기 `/cover`:
  - 세대 5 요청은 409(허용 4)예요.
  - 모르는 slug는 400이에요.
  - 세대 4는 생성(`reused:false`)되고, 반복하면 재사용(`reused:true`)돼요.
- 완료 결과는 `published` v5 세대 4예요. 슬롯 `neon-alley` 활성은 4예요.
- **과거 세대 1 표지는 GET/HEAD 404/404**이고, 새 세대 4는 200/200(같은 합성 sha)이에요. 홈에 작품이 보이고, 홈 HTML에 세대 1 표지 주소가 없어요.
- 과거 세대 1로 다시 철회를 시도하면 `conflict`예요.

**만료:**
- 실행기 `/expire`로 `timed-coast` 권리를 12초로 두고 준비 `prepared`, 완료 `published`를 했어요.
- 만료 전: 홈 노출, 표지 200/200이에요.
- 만료 후: 홈 미노출, 표지 404/404예요.
- 만료 뒤 같은 세대 완료를 재전송하면 `conflict`이고, 표지는 계속 404예요.

### 3. 회귀

- `node --conditions=react-server --import tsx tests/admin/t306-publication-e2e-native.ts --scenarios`:
  - `scenarios: passed`예요.
  - 내용: 기한 일치, 불일치 6종 롤백, 읽기 경계 42501/42501, 만료 경계예요.
  - 실행기가 클러스터·리스너·임시 폴더를 정리했어요.
- `npx vitest run tests/admin tests/public-showcase`: 파일 16 통과, 시험 212 통과.
- `tsc` 오류 0. ESLint는 T326 두 파일과 T306 실행기 모두 통과했어요.

## 정리 근거

- 실행기 4회(조사 1, 실패 확인 1, 최종 1, 시나리오 1) 모두 출력 마지막 줄이 `Owned PG17 listener and temporary cluster removed`이고, 임시 `dream-t306-*` 폴더는 0개예요.
- 진행기는 모드마다 Next 프로세스 트리를 종료한 뒤 그 포트의 대기 0을 확인했어요.
- 격리 사본은 재분석 지점을 먼저 지우고 폴더째 삭제했어요(없음 확인). 저장소 `node_modules` 항목 283개는 그대로예요.
- 남은 리스너는 주인님 미리보기 127.0.0.1:50963 하나이고, 건드리지 않았어요.

## T326-F1 동시 표지 준비 트랜잭션 보완 (T326-R F326-1)

- 배정: Master `msg_5260276b157a`
- 바꾼 파일: `tests/admin/t306-publication-e2e-native.ts`, `tests/admin/t326-publication-assembled-e2e.mjs`, 이 문서

**지적:** `/cover`가 공유 `admin` 연결에 `BEGIN`·행 잠금·쓰기를 걸었어요. 그래서 동시 요청의 문장이 한 세션 트랜잭션에 섞였어요. Tester가 12건 병렬을 보냈을 때 모두 500이었어요(중복 키 1건, 나머지는 중단된 트랜잭션).

**고친 점:**
- 표지 준비를 `prepareCover()` 함수로 분리했어요. **요청마다 전용 연결 하나**에서 한 트랜잭션으로 처리해요.
  - 작품 행 `FOR UPDATE`
  - `INSERT … ON CONFLICT (owner_id, object_key) DO NOTHING`
  - 저장된 바이트 비교: 같으면 재사용, 다르면 보존하고 409 롤백
  - 증빙 `cover.objectKey` 갱신 → `COMMIT`
- 연결은 성공·실패와 상관없이 `finally`에서 닫아요.
- 공유 `admin` 연결을 쓰는 나머지 제어 경로(`/state`·`/expire`·`/publisher`·`/done`)는 한 번에 하나씩만 실행해요.
- 허용 규칙은 그대로예요: 시드 slug만, 안전한 다음 세대만, 합성 키·바이트만.
- 실행기에 `--cover-check` 모드를 추가했어요. 소유 루프백 클러스터의 합성 데이터만 쓰고, `/cover`와 같은 함수를 검사해요.

**검증 (소유 루프백 수정본):**

`node --conditions=react-server --import tsx tests/admin/t306-publication-e2e-native.ts --cover-check`: 2회 모두 `coverCheck: passed`.

| 검사 | 결과 |
|---|---|
| 같은 세대·같은 바이트 12건 병렬 | 12건 모두 200, 생성 1·재사용 11, 표지 행 1개(합성 바이트와 같음), 증빙 키 갱신 |
| 미리 넣은 다른 합성 바이트(`#8c2a4f` webp)가 있는 키에 6건 병렬 | 6건 모두 409 `preserved`, 저장 바이트 그대로, 증빙 키는 세대 1 그대로 |
| 오류 뒤 정상 | 위험 세대 409, 모르는 slug 400 직후 섞인 6건 병렬. drift-dune 4건은 생성 1·재사용 3, neon-alley는 재사용, timed-coast는 409. 공유 연결 `SELECT 1` 정상 |
| 전용 연결 정리 | 남은 백엔드 0 |

**T326 진행기:** 재게시 단계의 `/cover`를 HTTP 12건 병렬로 바꿨어요. 결과는 모두 200, 생성 1·재사용 11이었어요. 그 앞의 위험 세대 409·모르는 slug 400 뒤에도 `/state` 조회는 정상이었어요.

**새 격리 사본(HEAD `d6211cd` + 수정본) 운영 빌드 전체 재실행:** 종료 코드 0.
- 닫힘 3모드: 모두 503·closed·표지 404/404, 원장 변화 0.
- 같은 requestId 완료 5건: `published` 동일, 원장·감사·T295 각 1건.
- 철회 경합: revoked 1·conflict 3.
- 재게시: 세대 4 `published`, 과거 세대 1 표지 404/404, 새 세대 200/200, 홈에 옛 링크 없음.
- 만료: 전 200/200 → 후 404/404, 재전송 `conflict`.
- 조립 기록: 시작·끝 모두 4줄(재조립 없음).
- 모드별 리스너: 0.

**회귀:**
- `--scenarios` 통과.
- `npx vitest run tests/admin tests/public-showcase`: 파일 16·시험 212 통과.
- `tsc` 오류 0, 바꾼 두 파일 ESLint 통과.

**정리:**
- 실행기 4회(서버 1, `--scenarios` 1, `--cover-check` 2) 모두 클러스터·리스너·임시 폴더를 제거했어요. `dream-t306-*` 0개예요.
- 격리 사본은 삭제했어요. `node_modules`는 283개 그대로예요.
- 남은 리스너는 사용자 미리보기 50963뿐이에요.

## 참고

- 첫 두 실행은 진행기 판정을 바로잡는 과정이었어요. 서비스는 HTTP 200 본문의 `status`로 `conflict`를 알려 줘서, 상태 코드만 세던 판정을 고쳤어요. 두 번째 실행은 위 fixture 한계(표지가 세대 1만 있음) 때문에 멈췄어요. 둘 다 DB를 새 클러스터로 다시 만들어 최종 실행했어요.
- 대상 ID는 서버 주소·포트·DB 이름을 합친 값이에요. 같은 이름의 다른 클러스터는 포트로 구분돼요. 운영용 신뢰 초기화 함수의 TLS·클러스터 식별 검증은 범위 밖이에요(T325 다음 조건).
