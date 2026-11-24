# T306-F1 관리자와 공개 권리 증빙 동일성 보완

- 담당: Codex(Front) · 배정 Master `msg_0d97f5855239` · 기준 고정 `aa45183`, T306-R F306-1
- 바꾼 파일(모두 시험 fixture):
  - `tests/admin/t306-publication-e2e-store.ts` — 대조 추가
  - `tests/admin/t306-publication-e2e-native.ts` — fixture 읽기 함수, `--scenarios` 모드
  - `tests/admin/t306-publication-e2e-scenarios.ts` — 신규
- 그대로인 것: 제품 파일·공유 SQL 파일(T253·T293·T295 고정 해시 그대로)·운영·배포·새 창/worktree.

## 지적 내용 (F306-1)

T306 저장소는 서비스 결과와 `t295.apply` 결과의 형태(DTO)만 비교했어요. 그래서 둘 다 `prepared`나 `published`면 커밋됐어요. 예를 들어 앱 증빙이 "60초 뒤 만료"라도 SQL 권리 증명이 "60.001초 뒤 만료"면 앱 화면과 공개 리더의 기간이 서로 다른 채 남았어요.

이전 저장소로 새 시나리오를 돌렸을 때 첫 불일치 경우(서로 다른 두 시한)가 `prepared`로 커밋되는 것을 확인했어요(아래 ③ 첫 줄).

## 고친 방식

같은 트랜잭션에서 `t295.apply` 바로 뒤에, SQL이 실제로 고정·활성화한 행을 읽어 서비스가 저장하려는 상태와 대조해요. 하나라도 다르면 `T306RightsMismatch`를 던져요. 그러면 앱 상태·manifest·원장·감사·T295/T253 기록이 **모두 롤백**되고 서비스는 `unavailable`을 돌려줘요.

| 명령 | 대조 항목 |
|---|---|
| 준비 | 고정 manifest가 있고 활성은 아직 없음 · `rights_ref` = 서비스 권리 참조 · 고정 manifest 전체(원본 id·리비전·sha, 권리 참조, 표시 정보, 표지 sha·크기) = 앱 manifest · 무기한/시한부와 종료 시각 = 앱 증빙 `expiresAtMs` |
| 게시 | 같은 세대의 고정 manifest = 앱 `t293.manifests` · 고정·활성 두 행 모두 `rights_ref`와 기간이 앱 `active.rightsReference`·`rightsUntilMs`와 같음 · 활성 `approved_ms` = SQL 승인 시각 = 앱 `approvedMs` · 승인 시각 < 종료 시각 |
| 철회 | 그 세대가 더 이상 활성 아님(`t293.approved_ms` null) |

**시간 정밀도 (명시):**
- SQL 종료 시각(`timestamptz`, µs 단위)을 DB 안에서 `extract(epoch …) * 1000`으로 바꿔요. PG17에서 이 값은 `numeric`(정확한 10진)이라 부동소수 변환이 없어요.
  - 정수 ms일 때만 `bigint` 문자열로 돌려줘요. µs 자투리가 있으면 `frac:` 값으로 돌려줘서 항상 불일치가 돼요.
- 앱 쪽은 정수 ms(`Number.isSafeInteger`)를 문자열로 바꿔 문자열끼리 비교해요.
- 시나리오의 권리 증명 시각은 ISO 문자열(`…097Z`, `…097500Z`)로 넣어 µs까지 그대로 파싱되게 했어요.

**읽기 경로 (fixture 전용, 공유 SQL 파일 변경 아님):**
- 계정 로그인(`t293_app`)은 T295 표에 직접 읽기 권한이 없어요. 같은 트랜잭션에서 읽으려고 실행기가 DB를 만들 때 `t306.rights_state(slug, generation)`를 추가해요.
  - 소유자는 기존 `t295_writer`이고, 기존 정책 `writer_scope`(owner_id = `t293.actor()`)로 본인 행만 읽어요.
  - 읽기 전용이고, EXECUTE는 `t293_app`에만 줬어요.
- 확인 결과:
  - B 로그인으로 A 작품을 조회하면 `{frozen:null, activation:null}`이에요.
  - 목록·표지 전용 로그인은 호출 자체가 `42501`로 막혀요.
  - 쓰기 권한이나 공개 함수 권한은 늘지 않았어요.

## 시나리오 결과 (`--scenarios`, 실제 서비스 + T306 저장소 + 고정 SQL, 본인 소유 루프백 PG17)

`{"scenarios":"passed"}` 두 번 통과했고, 실행마다 클러스터·임시 폴더 정리까지 확인했어요.

**① 정합 · 시한부 (같은 ms):**
- 준비 v1 → 게시 v2 → 철회 v3. 단계마다 같은 UUID로 다시 보내도 같은 결과예요.
- 활성 `timed`, 종료 ms가 앱 `rightsUntilMs`와 정확히 같아요(`1795037507169`). 앱 `approvedMs`도 활성 `approved_ms`와 같아요.
- 게시 중에는 공개 목록·표지에 있고, 철회 뒤에는 둘 다 없어요.
- 원장: 앱·감사·T295·T253 각 3, manifest 1.

**② 정합 · 무기한:** 준비 → 게시, 활성 `perpetual`/null, 공개 목록에 보여요.

**③ 불일치 (모두 만료 전, 준비 단계):** 아래 경우 모두 결과가 `unavailable`이에요.
- 같은 UUID로 다시 보내도 `unavailable`이에요.
- 리비전 0, 앱 원장·감사·manifest·T295 요청·T253 요청·고정 manifest·활성 모두 0이고, 공개 목록에도 없어요.

| 경우 | 앱 증빙 | SQL 권리 증명 |
|---|---|---|
| 서로 다른 두 시한 | T | T + 1ms (이전 저장소는 여기서 `prepared` 커밋) |
| ms 아래 자투리 | T | T + 500µs |
| 무기한 → 시한부 | 무기한 | T |
| 시한부 → 무기한 | T | 무기한 |
| 최초 manifest 표시 불일치 | 원래 제목 | 다른 제목 |
| 최초 manifest 원본 불일치 | 원본 sha a… | 원본 sha b… |

**④ 준비 뒤 권리 증명만 변경 (둘 다 만료 전):**
- 게시 시 SQL은 `source-unavailable`, 서비스는 `published`라 판정이 달라 롤백돼요.
- 준비 상태 그대로예요(리비전 1, 각 원장 1, 활성 0).
- 권리 증명을 되돌리면 같은 UUID로 정상 게시돼요(앞 시도가 아무것도 남기지 않았기 때문).

**⑤ 만료 경계 (4초 시한):**
- 시한 안에 게시한 작품은 공개 목록·표지에 있다가, 만료 5ms 뒤에는 둘 다 빠져요.
- 준비만 한 작품은 만료 뒤 게시가 서비스에서 `source-unavailable`로 정리돼요.
  - 같은 UUID 재전송도 같은 결과예요.
  - 앱 원장 2(준비+실패)·감사 1, SQL 쪽 추가 기록과 활성은 0이에요.

## 서버 모드 영향

- 격리 Next용 서버 모드도 같은 저장소를 써요.
- T306 화면 시험의 "권리 불일치 사구"(증빙 무기한·증명 시한부)는 이제 만료 뒤 게시 단계까지 가지 않아요. **준비 단계에서 바로 롤백**돼요.
- 그 밖의 정합 흐름(T306 ①②와 시한부 일치)은 대조를 통과하는 경우라 결과가 같아요.
- 이번에는 화면을 다시 돌리지 않았어요. 대신 같은 서비스·저장소를 직접 호출한 시나리오로 확인했어요.

## 검증

- `npx tsc --noEmit -p .` 오류 0 · `npx eslint tests/admin/t306-*.ts` 통과.
- `node --conditions=react-server --import tsx tests/admin/t306-publication-e2e-native.ts --scenarios`
  - 새 저장소: 통과 2회.
  - 이전 저장소(`aa45183`): ③ 첫 경우에서 `prepared`로 실패해 지적 내용을 재현했어요. 비교 뒤 새 저장소로 되돌렸어요.
- 운영 어댑터는 계속 미연결이에요(`productionPublicationStore()` null).

## 남은 점

- 운영용 어댑터를 만들 때도 같은 대조(정확한 ms, manifest 전체, 고정·활성 두 행)를 같은 트랜잭션 안에서 해야 해요.
- 그러려면 계정 역할에 본인 행 읽기 경로가 필요해요. 이번 fixture 함수처럼 공유 SQL에 정식으로 넣을지는 Backend·Master 판단이 필요해요.
- 불일치가 났을 때 화면 문구는 "같은 요청으로 다시 시도"예요. 증빙이나 권리 증명을 고치기 전에는 계속 실패하므로, 별도 안내가 필요해요(T306 남은 위험 2와 같음).
