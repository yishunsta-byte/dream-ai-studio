# T-120 렌더 backend 필수 수정 4건 (F116-1~4) — CC-DATA-01 반환

- 담당: CC-DATA-01 · 지시: Master msg_4cd3f435315d · 근거: `docs/handoffs/T-116-RENDER-BACKEND-INDEPENDENT.md` (FAIL, 필수 수정 4건)
- 기준 커밋: 3893e32(T-114) · 3580883(T-117) 위. T-119 작업(화면)은 이 커밋에 넣지 않았어요(별도 커밋 예정).
- 범위: `render/*`, `lib/render/*`, `lib/jobs/render.ts`, 관련 시험, 이 보고서. DB·API 계약·migrations·packages·spec·자산은 바꾸지 않았어요.
- 상태: 자체 검수 완료(독립 검수 아님). 독립 재검수를 요청해요.

## 1. 바꾼 내용

### F116-1 번들 캐시를 이름·marker로 믿던 문제
- 캐시는 **worker 메모리에 있는 닫힌 파일 목록**(경로·크기·sha256 전부, 키 = composition source sha + Remotion 4.0.543)으로만 믿어요. 캐시 폴더 안의 어떤 파일(index.html, render-source.json)도 신뢰 근거가 아니에요.
- hit: 캐시 파일을 **시도 폴더로 해시하며 복사**하고, 목록과 하나라도 다르면(내용 변조·추가·누락·링크) 반쯤 복사한 것을 지우고 시도 폴더에 새로 빌드해요. 렌더는 항상 시도 폴더 사본을 서빙해요(복사 뒤 캐시를 바꿔도 영향 없음).
- 새 빌드는 고유 이름 새 폴더(`<sha>_<버전>_<랜덤>`)에 저장하고, 같은 키의 이전 폴더·예전 이름 방식 폴더(`<sha>`)는 정리해요. 새 worker는 메모리 기록이 없으니 처음 한 번은 반드시 새로 빌드해요.
- 파일: `render/bundle-cache.ts`(새), `render/child.ts`, `lib/render/run.ts`

### F116-2 해시 확인 뒤 바뀔 수 있는 원본 경로를 서빙하던 문제
- prepare에서 media·font를 **시도 폴더 `inputs/`로 해시하며 복사**(쓰는 바이트 자체를 해시)하고, 고정 입력의 sha256·크기와 다르면 `RENDER_INPUT_CHANGED`로 멈춰요. 사본은 읽기 전용으로 둬요.
- 파일 서버는 **시작할 때 연 파일 핸들만** 읽어요(경로를 다시 열지 않음). 원본 교체·삭제, 이름 바꿔 덮기는 렌더에 닿지 않아요.
- 게시 직전에 사본을 다시 해시해요(`verifyStaged`). 다르면 게시하지 않아요.
- 원본 파일과 기존 성공 파일은 건드리지 않아요. 디스크 여유 계산에 사본 크기를 더했어요.
- 파일: `lib/jobs/render.ts`(recheckInput 재작성, verifyStaged), `lib/render/file-server.ts`

### F116-3 link 오류를 모두 재시도 STORAGE_FAILED로 바꾸던 문제
- 공통 분류 `storageFailure(errno)`(`lib/render/errors.ts`): ENOSPC·EDQUOT → `DISK_FULL` 종결 / EBUSY·EAGAIN·EMFILE·ENFILE → `STORAGE_FAILED` 재시도(시도 한도 안) / 그 밖(EACCES·EPERM·ENOENT·EINVAL·EROFS·EXDEV 등) → `STORAGE_FAILED` 영구.
- worker의 모든 쓰기(작업 폴더 만들기, 입력 복사, 게시 link, 그 밖 예외)와 렌더 자식의 분류(`classify`)가 같은 규칙을 써요.
- 원래 errno는 `RenderFailure.errno`로 보존하고 활동 기록 `render.io_error`(renderId·jobId·code·errno·retryable, 경로 없음)에 남겨요. API·DB 스키마는 그대로예요.

### F116-4 Node 연결 검사 우회와 바깥 URL
- `render/guard.ts`(새, import 부작용 없음): connect 오버로드를 정규화해요 — `(options)`, `(port, host)`, `(path)`, 그리고 `net.connect()`가 넘기는 배열형 `[options, cb]`. host가 없으면 Node 기본값인 localhost로 보고 같은 검사를 해요(무조건 허용 안 함). 이름으로 연결하면 DNS 결과가 loopback이 아닐 때 소켓을 끊어요. 경로형은 로컬 pipe/socket만 허용해요.
- props의 모든 영상·글꼴 주소가 **이 시도 파일 서버의 정확한 origin + 64자리 token + `/m|f/번호`** 인지 렌더 자식이 번들·브라우저 전에 확인해요. 다른 origin·token, 쿼리(리다이렉트 꼴 포함), 바깥 주소는 시작 전에 `RENDER_FAILED`(RENDER_NETWORK_REFUSED)로 멈춰요. 그래서 바깥 URL이 브라우저나 네이티브 compositor(OffthreadVideo)까지 가지 않아요. 파일 서버는 리다이렉트를 하지 않아요.
- 자식 핸들러는 worker가 붙인 표시(`DREAM_RENDER_CHILD=1`)와 IPC가 있을 때만 켜져요(시험에서 import해도 net을 바꾸지 않음).
- 한계(주장하지 않는 것): Node 검사는 **프로세스 안 검사이고 OS 방화벽이 아니에요.** 브라우저는 기존 Chrome 플래그(이름 해석·프록시)로, 네이티브 compositor는 "주소를 owned 파일 서버로만 준다"로 막아요.

## 2. 검증 (모두 가상 데이터·OS 임시 폴더)

| 항목 | 결과 |
|---|---|
| vitest 전체 | 551 통과 + 13 skip (48 파일) |
| 새 시험 `tests/p2-4-render-t120.test.ts` | 11 통과 — 캐시 hit·변조(chunk·중첩 chunk·page)·추가·marker·누락 거부, 디스크 폴더 불신, 파일 서버 같은 크기 교체·rename 덮기·삭제 후에도 원래 바이트, 저장 오류 분류, connect 오버로드, loopback 판정, props 주소 검사, **별도 프로세스에서 이 PC 자기 non-loopback 서버로** 7가지 연결 방식(net.connect 2형, createConnection, Socket#connect, 호스트명 조회, http.get, fetch) 모두 거부·loopback 허용·서버 요청 0 |
| 새 시험 `tests/p2-4-render-t120-jobs.test.ts` | 7 통과 — s5 사본 worker 경로: 렌더 중 저장 파일 같은 크기 교체·삭제 → 고정 바이트로 성공 게시, 시도 사본 변조 → 게시 전 `RENDER_INPUT_CHANGED`, 복사 전 교체 → 시작 안 함. link fault injection: ENOSPC→DISK_FULL 종결, EACCES·ENOENT→STORAGE_FAILED 종결, EBUSY→재시도 대기, errno 기록, 게시 파일 없음, 작업 폴더 잔류 0 |
| 실제 렌더 e2e `DREAM_RENDER_E2E=1` | 9 통과(3비율 성공·취소·자식 crash 재시도·늦은 취소·정리 등, 413초) |
| 실제 렌더 증거 `tmp/t120-evidence/real-render.ts` → `real-render.json` | build→hit→chunk에 빨간 스타일 주입→`changed: bundle.js` 거부·재빌드, page 변조→`changed: index.html`, 파일 누락·marker 심기→`file set differs`, 새 worker+예전 이름 폴더(빨간 변조)→사용 안 하고 정리. **7회 모두 화소 [50,82,119](장면색), 빨강 0회**, 확인 통과, 잔류 프로세스 0, 캐시 폴더 1개 유지. non-loopback clip·font·파일서버 base·리다이렉트 꼴 주소 → 2초 안에 거부, 파일 서버 요청 0, **자기 PC LAN 서버 요청 0** |
| 격리 회귀 `tmp/t120-evidence/containment.ts` | 10 시나리오(정상·취소·compose 시작 취소·강제 종료·브라우저 kill·자식 kill·선택 실패·부모 사망·실행 파일 없음·실행 불가) 모두 잔류 프로세스 0, OS TEMP 새 항목 0 |
| 네트워크 기록 회귀 `tmp/t120-evidence/attempt.ts --netlog` | 9:16·16:9·1:1 모두 확인 통과, 바깥 URL·TCP·UDP 송신 0 (T-114와 같이 UDP 경로 조회 1건, 보낸 바이트 0) |
| lint · tsc | 통과 |
| 운영 빌드(복사본) | 통과, nft 37개에서 렌더 도구·로컬 데이터 추적 0 |

외부 공개 endpoint는 쓰지 않았고, 실제 사용자 data/storage/DB는 열지 않았어요.

## 3. 남은 것 · 참고
- F113-1 정리 PASS는 이어받되, 바뀐 자식 시작 값으로 격리 10 시나리오를 다시 돌려 확인했어요.
- 번들 캐시 오래된 키(다른 source sha) 정리 정책은 아직 없어요(같은 키만 정리). 필요하면 별도 과제로 해요.
- 처음 렌더는 worker마다 한 번 새로 빌드해요(약 7초 추가). 이후 hit은 해시 복사만 해요.
- T-119(화면)는 이 커밋 뒤 별도 커밋으로 반환해요.

## 4. 신뢰 경계 (T-124 회수 뒤 추가)
- T-124 독립 재검수: 원래 F116-1~4 재현은 PASS. 추가 지적 F124-1/2(같은 Windows 사용자가 시도 작업 폴더를 일부러 chmod 뒤 바꾸거나, 실행 직전에 시도 bundle을 바꾸는 경우)는 **막지 않아요.**
- 이 수정의 전제: 개인 PC 로컬 사용. 앱 소스·도구·worker가 가진 시도 폴더에 **같은 권한의 악의적 writer가 없다**는 것. 그 사용자 권한으로 쓰는 변조는 방어 범위 밖이에요.
- Node 연결 검사는 프로세스 안 검사이고 OS sandbox·방화벽이 아니에요.
- 공유·원격 운영이나 여러 사용자의 코드 실행 전에는 별도 보안 설계(ACL·sandbox)가 필요해요. 이번 범위에서는 만들지 않았어요.
