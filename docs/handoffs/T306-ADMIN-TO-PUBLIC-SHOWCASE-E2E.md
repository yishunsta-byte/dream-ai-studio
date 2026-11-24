# T306 관리자 게시 → 공개 홈 → 철회 종단 검증

- 담당: Codex(Front) · 배정 Master `msg_b09a2e9b230b` · 진행 기준 확인 `msg_16ffd8ca6c22`
- 대상 SHA: `ca8fc72` (Next.js 16.4.6, Node v26.13.0) · 기준 T297-F1-R·T304-R 통과
- 범위: 신규 시험 fixture 3개(`tests/admin/t306-publication-e2e-*.ts`)와 이 보고서만 커밋해요.
- 지키지 않은 것 없음: 제품 파일·공유 SQL 변경, 운영·스테이징 요청, 배포, 새 창·worktree 모두 없었어요.

## 확인한 차이 (먼저 보고, Master 승인)

- 검토된 T293 앱 어댑터(`tests/public-showcase/t293-admin-publication-adapter.ts`)는 `t293.apply_t253`를 직접 불러요.
  - 그래서 `t295.activation`이 남지 않아요. T298 공개 리더(`t295.list_approved`·`t295.find_cover`)에는 게시가 안 보여요.
  - 또 기한 있는 권리는 증빙 단계에서 null로 막혀요.
- `t295.apply`를 쓰는 앱 수준 저장소는 아직 없어요. **실제 운영 어댑터는 이번에도 연결하지 않았어요**(`productionPublicationStore()`는 그대로 null).

## 만든 시험 fixture

| 파일 | 역할 |
|---|---|
| `t306-publication-e2e-store.ts` | T293 어댑터와 같은 한 트랜잭션 구조(게시자 확인 → 작품 `FOR UPDATE` → 요청 UUID advisory lock·원장 → 증빙·표지 → 저장 → 감사). SQL 쓰기만 검토된 `t295.apply`에 맡겨요. 서비스 판정과 SQL 결과가 다르면 예외로 **전부 롤백**해요(서비스는 unavailable). |
| `t306-publication-e2e-inject.ts` | 격리 사본 주입용. 합성 계정 쿠키(`t306-actor`=A/B/X), 계정별 PG 로그인 풀(`t293_actor_a/b`), T298 리더를 같은 DB의 T295 목록·표지 전용 로그인으로 열기. |
| `t306-publication-e2e-native.ts` | 본인 소유 루프백 PG17 임시 클러스터 실행기. 서명 확인된 EnterpriseDB 17.12 바이너리, 고정 해시 SQL 3개(T253 `7b9a252e…`, T293 `4c855c28…`, T295 `9577cb43…`)를 원문 그대로 적용해요. 합성 작품 4개·권리 증명·원본·8×6 webp 표지를 넣어요. 루프백 조작 창구(상태 조회, 권리 만료 설정, 게시자 해제·복구)를 열고, 끝나면 연결 종료 → 클러스터 정지 → 리스너 없음 확인 → 임시 폴더를 지워요. |

격리 사본에서만 세 자리를 주입 모듈로 바꿨어요(커밋 안 함):
- `resolveServerAuth`
- `productionPublicationStore`
- `publicationShowcaseConnection = createPublicationShowcaseConnection(t306OpenReaders)`

이후 `next build` → `next start`(127.0.0.1)로 띄우고, ego에서 1280·390으로 실제 화면을 조작했어요.

## 결과 ① 게시 → 공개 → 철회 (1280, 작품 `neon-alley`, 영구 권리)

| 단계 | 화면·응답 | DB |
|---|---|---|
| 처음 | 홈에 작품 없음(예시만) | 원장·감사 0 |
| 권리 확인 체크 → 게시 준비 | v1, "게시 준비를 마쳤어요(세대 1)" · 홈 없음 · 표지 GET/HEAD 404 | 활성 권리 없음 |
| 체크 → 세대 1 게시 | v2, "공개 목록에 게시했어요(세대 1)" | 활성 권리 1개(perpetual), 같은 커밋 |
| 공개 홈 | 작품 보임 · `private, no-cache, no-store, max-age=0, must-revalidate` | |
| 표지 `/media/public/neon-alley/1/cover.webp` | GET 200 `image/webp` `no-store` 60바이트, sha 앞자리 `c7382c242fe7`(넣은 이미지와 같음) · HEAD 200 본문 0 | |
| 표지 `?v=1` 붙임, 세대 2 | GET/HEAD 404 | |
| 같은 게시 요청 본문 재전송 | 200 같은 결과(`published`, v2, 세대 1) | 원장·감사·T295·T253 수 그대로 |
| 철회… → 취소 | 확인 버튼 사라짐, 전송 0건 | |
| 철회… → 세대 1 철회 확정 | v3, "세대 1을 철회했어요…" | 원장 3·감사 3 |
| 브라우저 뒤로(홈) | 홈에 작품 없음 | |
| 새 홈 · 과거 표지 주소 | 작품 없음 · GET/HEAD 404 | |

- 요청 하나마다 앱 원장 1·감사 1·T295 요청 1·T253 요청 1이었어요(준비·게시·철회 각각 `a1 q1`).
- 1280에서 가로 넘침 없음(1265/1265), "목록 다시 불러오기" 높이 44px이에요.

## 결과 ② 계정 분리·권한

- **B 화면:** 자기 작품(`B의 항구`)만 보여요.
- **B가 A 작품 철회 요청:** 200 `denied`, 원장 추가 없음.
- **B 게시자 해제:** B 목록이 닫힘(미연결, 체크 0개). 쓰기 요청은 `denied`예요. 복구도 확인했어요.
- **기존 역할 우회 없음** (실제 로그인으로 확인, 모두 권한 오류 `42501`):
  - 목록 로그인은 `t295.apply`, `t295.find_cover`, 옛 `t253_showcase.list_approved` 불가
  - 표지 로그인은 `t295.list_approved` 불가
  - 계정 로그인은 `t295.list_approved`, `t295.activation` 직접 쓰기, 남의 작품 준비 불가
  - B 로그인으로 보이는 작품은 `b-harbor`뿐

## 결과 ③ 저장된 권리 만료 일치·불일치 (390)

- **일치 (`timed-coast`):** 권리 증명과 앱 증빙 모두 40초 뒤 만료로 두었어요.
  - 준비 → 게시 성공. 활성 권리는 `timed`이고, 만료 시각이 앱 상태의 `rightsUntilMs`와 같아요.
  - 공개 홈 노출, 표지 200.
  - 만료 뒤에는 새 홈에서 빠지고 표지 GET/HEAD 404예요(앱 쓰기 없이 공개 리더가 판정).
- **불일치 (`drift-dune`):** 권리 증명은 12초 뒤 만료, 앱 증빙은 영구로 어긋나게 두었어요.
  - 준비는 성공했어요. 만료 뒤 게시를 누르면 서비스는 게시로 판정하지만 `t295.apply`는 거절해요.
  - 저장소가 둘의 차이를 잡아 전부 **롤백**했어요.
  - 화면: v1 그대로, "게시 요청을 처리하지 못했어요. 같은 요청으로 다시 시도할 수 있어요."
  - 같은 요청 UUID로 다시 시도해도 같은 결과예요. 전송 2건 모두 같은 UUID였어요.
  - 이 작품의 게시 원장·감사·T295 요청·활성 권리는 0이고, 홈에도 없어요.
- 390에서 가로 넘침 없음(390/390), 44px 유지예요.

## T303 고정 SHA 별도 확인 (`66d1870` → `ca8fc72`, 커밋 4개)

- **바뀌지 않음:**
  - `proxy.ts`, `next.config.ts`
  - 두 POST 라우트 파일(`app/api/admin/publications/route.ts`, `app/api/studio/reference-analysis/route.ts`)
  - `lib/public-showcase/admin-publication-http.ts`
- **바뀜:** `lib/reference-analysis/studio-analysis-http.ts`·`studio-analysis-connection.ts`(T305)
  - 순서는 그대로예요: 인증 → 출처 → 본문 읽기(초과 413) → 선택 검사.
  - 그 뒤에 새 `analyzeRegisteredSource` 분기가 생겼어요.
  - 기본 연결은 여전히 미연결이라 503 `analysis_unavailable`이에요.
- **판단:** T303의 수신 단계 관측은 이 SHA에도 그대로 적용돼요.
  - 관측 내용: Next가 proxy 앞에서 본문 끝까지 대기, 미완료 본문은 라우트 진입 0, Node 408.
  - 새 분석 분기가 실제로 연결된 뒤의 동작은 T303에서 측정하지 않았어요.

## 남은 위험·운영 전 필요

1. 운영용 관리자 게시 저장소가 없어요. 이번 fixture처럼 `t295.apply`에 위임하고 증빙 만료를 권리 증명과 맞추는 어댑터가 따로 검토돼야 해요.
2. 불일치 경우 화면 문구는 "다시 시도"지만, 같은 요청을 다시 보내도 계속 실패해요. 운영에서는 증빙 갱신 경로나 별도 안내가 필요해요(이번 범위 밖).
3. 공개 홈·표지는 T298 루프백 시험 프로필로만 연결했어요. 실제 비공개 표지 저장소 읽기는 합성 바이트예요.

## 검증·정리

- `npx tsc --noEmit -p .` 오류 0 · `npx eslint tests/admin/t306-*.ts` 통과 · 격리 사본 `npm run build` 통과.
- 격리 서버(43306)·조작 창구를 멈췄어요. PG17 클러스터는 "Owned PG17 listener and temporary cluster removed"까지 확인했고 임시 폴더도 지웠어요.
- 격리 사본을 지웠고 원본 `node_modules`는 283개 그대로예요. ego 작업 공간은 keep 없이 닫았고, Tester에게 시작·끝을 알렸어요.
