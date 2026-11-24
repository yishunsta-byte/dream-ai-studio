# T289 관리자 완성본 검수·게시·철회 큐 첫 구현

- 담당: Codex(Front) · 배정 Master `msg_173852d57289`
- 고정 코드 SHA: `a61cb26fb793d31670e1f13f55ed279f9b215766` (첫 구현 `903035b` + 단계 보정)
- 판정: 화면·판정·격리 공급자 구현과 자체 확인을 마쳤어요. `/admin` 본체 연결과 실제 서버 공급자는 아직이에요. Tester 독립 검수 전이에요.

## 한 일

새 관리자 전용 화면 모듈 `PublicationQueue`를 만들었어요. 서버 쓰기 계약은 T253 `apply_command`(prepare·complete·revoke, `expected_version`, generation, 요청 UUID 원장·지문)를 그대로 따라요.

- **목록:** 작품마다 다음을 보여 줘요.
  - 제목, 종류, 주소 이름(slug), 단계(검수 대기·게시 준비됨·게시 중·게시 중+새 세대 준비됨)
  - 대상 리비전(version), 게시 중 세대, 준비된 세대, 원본 리비전·완성 여부, 권리 증빙
- **권리 검수 확인:** 준비와 게시는 그 작품의 “권리 증빙과 표시 문구를 확인했어요” 체크 뒤에만 누를 수 있어요.
  - 결과가 나오면 체크가 풀려서, 다음 동작 때 다시 확인해야 해요.
  - 권리 미확인이나 미완성 원본이면 체크박스 대신 막힌 이유만 보여요.
- **명시적 게시·철회:**
  - 준비 버튼은 `v{version} 게시 준비`, 게시 버튼은 `세대 N 게시`처럼 대상이 이름에 들어가요. 요청에는 대상 버전과 세대가 고정돼요.
  - 철회는 `철회…` → `세대 N 철회 확정`/`취소` 두 단계예요(브라우저 확인창 없음). 준비 중인 세대가 있으면 그것부터 거둬요.
- **오류·중복·충돌:**

| 결과 | 화면 |
|---|---|
| 처리 못 함(`unavailable`: 응답 유실·일시 실패·형식 오류 결과) | 같은 요청 UUID로만 다시 시도, 다른 버튼 숨김(중복 게시 방지) |
| 충돌(`conflict`) | “그사이 다른 곳에서 바뀌었어요” 안내, 그 줄의 동작을 막고 목록 다시 불러오기 요구 |
| 원본 바뀜(`source-unavailable`) | 원본 확인 안내, 다시 불러오기 |
| 권한 없음(`denied`) | 권한 없음 안내 |
| 잘못된 요청(`invalid`) | 처리 안 함 안내, 다시 불러오기 |
| 성공이지만 요청과 맞지 않는 결과(다른 세대·뒤로 간 버전) | 반영하지 않고 다시 불러오기 요구 |

- **목록 형식 검사:** 한 줄이라도 계약에 맞지 않거나 slug가 겹치면 목록 전체를 “불러오지 못했어요”로 보여요.
- **샘플 표시:** `source="synthetic"`이면 큐 머리에 “합성 시험 데이터예요” 안내가 나오고, 줄마다 `합성` 표시가 붙어요. 운영 작품처럼 보이지 않아요.
- **닫힘:** 운영 기본 공급자 `CLOSED_PUBLICATION_PROVIDER`는 목록을 `closed`로 돌려줘요. 화면에는 “게시 서버 미연결”만 보이고 버튼·체크는 없어요. 요청은 실행하지 않아요(`unavailable`).
- **단계 보정(`a61cb26`):** 처음에는 “게시·준비 없음 + version>0”을 `철회됨`으로 표시했어요. 그런데 T290은 후보 원본·표시가 바뀌어도 version을 올린다고 해서, version만으로 철회를 추정하지 않게 바꿨어요(검수 대기). 철회 결과는 안내 문구로만 알려요. 준비된 항목에는 “권리를 다시 확인하면 세대 N을 게시할 수 있어요” 안내를 더했어요.

## 바꾼 파일 (모두 새 파일)

- `components/admin/publication-model.ts`: DTO(`PublicationItem`·`PublicationAction`·`PublicationOutcome`·`PublicationList`), 형식 검사, 단계·허용 명령·요청 만들기·결과 반영·안내 판정.
- `components/admin/publication-provider.ts`: 공급자 계약, 닫힌 운영 기본값, 격리 시험용 메모리 공급자.
  - 메모리 공급자는 게시자 허용, 소유자 범위, 요청 UUID 원장·지문, 기대 버전·세대, 원본 완결을 T253과 같은 결과 분류로 흉내 내요.
- `components/admin/publication-queue.tsx`, `publication-queue.module.css`: 클라이언트 화면. 누르는 곳은 44px 이상이에요.
- `tests/admin/publication-queue.test.ts`(19개 시험).

`/admin` 본체, T283 파일, 공개 홈, SQL, 환경, 배포는 바꾸지 않았어요. 시험으로도 `app/admin/page.tsx`·`admin-hub.tsx`에 연결이 없음을 확인해요.

## 검증 (실제 출력)

**명령 결과**
- 집중: `tests/admin/publication-queue.test.ts` `Tests 19 passed (19)`. T283·T243과 함께 돌렸을 때(`903035b` 시점) 39 passed.
- 전체 vitest(`903035b`): `Test Files 127 passed | 16 skipped (143)`, `Tests 2562 passed | 384 skipped (2946)`. `a61cb26`은 이 세 파일만 바꿔서 집중 시험으로 다시 확인했어요.
- tsc 오류 0줄, 변경 파일 eslint exit 0, `git diff --cached --check` 통과. 격리 사본 `npm run build` 성공(두 번 모두).
- 격리 공급자 시험:
  - 정상 흐름: 준비 → 게시 → 새 세대 준비 → 새 세대 게시 → 철회. 화면 반영이 매번 공급자 목록과 같아요.
  - 같은 UUID 재전송은 당시 결과를 돌려주고 상태를 한 번만 바꿔요. 같은 UUID에 다른 내용은 `invalid`예요.
  - 늦은 요청, 다시 준비, 지난 세대 게시·철회는 `conflict`예요.
  - 준비 뒤 원본이 바뀌면 `source-unavailable`이에요.
  - 다른 계정 행은 목록에서 빠지고, 직접 요청해도 `denied`예요. 게시자 허용 밖이면 자기 행도 `denied`예요.
  - 권리 확인 없는 준비, 준비 없는 게시, 범위 밖 철회는 상태를 바꾸지 않아요.
  - 닫힌 공급자는 `closed`·`unavailable`만 돌려줘요.

**브라우저 확인** (ego 공간 91·92, 격리 서버 127.0.0.1:43289). 사본에만 둔 확인 화면(커밋하지 않음)에서 실제 `PublicationQueue`에 메모리 공급자를 넣었어요. 1280과 390에서 같은 결과가 나왔어요.
- 처음 화면: 다른 계정 작품은 안 보이고, 합성 안내가 보여요. 권리 미확인 작품은 막힌 이유만 있고 버튼은 0개예요.
- 권리 체크 전에는 버튼이 없어요. 체크하면 `v0 게시 준비`가 나오고, 누르면 `게시 준비 요청 중`(눌리지 않음)이 됐다가 `게시 준비됨 v1 · 준비 세대 1`이 돼요.
- 응답 유실을 흉내 냈어요. `세대 1 게시` 응답이 사라지면 `같은 게시 요청 다시 시도`만 남아요. 다시 시도하면 `게시 중 v2`가 돼요.
  - 두 요청의 UUID 끝자리가 같았고(`complete:0c89` ×2), 서버 version은 2라서 두 번 게시되지 않았어요.
- 다른 곳에서 바뀐 뒤 준비를 누르면 충돌 안내와 `목록 다시 불러오기`만 보여요. 다시 불러오면 새 version(v1)으로 돌아와요.
- 철회: `철회…` → `세대 1 철회 확정`/`취소` → 철회 안내가 나오고, 단계는 검수 대기(v3)로 돌아가요.
- 버튼 높이는 모두 44px, 가로 넘침은 0이에요(1280: 1265 = 스크롤바를 뺀 너비, 390: 390).

정리: 격리 사본·서버·ego 공간을 닫았고, 원본 `node_modules`는 283개 그대로예요. 실제 DB·Storage·외부 요청·배포는 없었어요.

## Backend(T290)에 넘기는 계약

DTO를 그대로 채택한다는 회신을 받았어요(`msg_aed99262b62f`).

- **목록:** `PublicationList` = `closed | failed | ok{items}`.
  - 줄마다 `slug, title, kind, version, pendingGeneration, activeGeneration, approvedMs, source{revision, finished}, rights`가 들어가요. 숫자는 모두 10진 문자열이에요.
  - 원본 경로, owner, 이메일, object key, 서명 URL은 넣지 않아요.
  - 후보 원본이나 표시가 바뀌면 version을 올려서 지난 목록으로 만든 준비가 conflict가 되게 해요(T290 회신 내용).
- **요청:** `PublicationAction{requestId(uuid), command, slug, expectedVersion, generation, rightsConfirmed}`.
  - actor는 서버가 인증으로 정해요.
  - complete는 `expectedVersion = generation = pendingGeneration`이에요.
  - prepare·complete에서 `rightsConfirmed=false`면 `invalid`예요.
- **결과:** `prepared|published|revoked{version, generation}`, 또는 `conflict`, `source-unavailable`, `denied`(42501, 다른 소유자 포함), `invalid`(22023·지문 불일치), `unavailable`. 다른 키는 넣지 않아요.
- **권한:** 서버가 관리자 인증과 허용 이메일을 다시 판정해요. 게시자 허용과 소유자 범위를 확인하고, 같은 요청 UUID에는 원장 결과를 다시 돌려줘요.
- **완료 조건:** 실제 공급자를 서버 전용으로 만들고, `/admin`에서 인증 판정 뒤에만 목록을 읽고 요청을 받아요. 이 두 가지를 갖추고 Tester 검수를 통과하면, Master와 조정해서 `/admin`에 큐를 붙여요. 그 전까지 운영 화면은 닫힌 공급자로 둬요.

## 한계

- DOM 클릭 시험 도구(jsdom 등)가 저장소에 없어요. 그래서 화면 동작은 정적 렌더 시험과 ego 브라우저로만 확인했어요.
- 표지·공개 상세·재생은 이번 범위가 아니에요.
