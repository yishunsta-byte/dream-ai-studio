# T297-F1 관리자 게시 API — 출처 일치와 초과 본문 보완

- 담당: Codex(Front) · 배정 Master `msg_529410f193a7`
- 기준: `1801d83`, [T297-R 검수](T297-R-ADMIN-PUBLICATION-HTTP-INTEGRATION-REVIEW.md) F297-1·F297-2
- 고정 코드 SHA: `b5a7bf1ba524313c10b882a7e0382cc391bff41b`
- 판정: 보완과 자체 확인을 마쳤어요. 재검수 전이에요. 실제 Next에서 끝나지 않은 본문의 처리는 아래 "남은 관찰"을 봐 주세요.

## 고친 내용 (`lib/public-showcase/admin-publication-http.ts`만)

**F297-1 · 현재 요청 출처와 정확히 일치**
- 공용 `rejectCrossSite`(등록 출처 목록 전체 허용) 대신 이 경계 전용 `rejectForeignWrite`를 써요.
- `currentRequestOrigin(request, env)`가 지금 요청의 실제 출처를 정해요.
  - `Host` 머리글과 host가 같은 등록 사이트 주소(`DREAM_SITE_URL`, Vercel 주소)를 찾고, scheme은 그 등록값에서 가져와요.
  - 같은 host로 scheme만 다른 등록값이 둘 이상이면 판정하지 않고 거절해요.
  - 등록값이 없으면 이 PC 실행(Vercel 아님)에서만 루프백 `http://<host>`를 써요.
  - `x-forwarded-host`·`x-forwarded-proto` 같은 전달 머리글은 보지 않아요.
- `Origin`이 이 현재 출처와 문자 그대로 같아야 해요. 별도로 등록된 다른 사이트 주소도 403 `AUTH_ORIGIN_REJECTED`예요.
  - Fetch Metadata가 있으면 `same-origin`이어야 하고, 형식은 `application/json`만 받아요(415).
- 순서는 그대로예요: 인증 1회(401/403/503) → 출처·형식(머리글만) → 저장소 연결 → 본문. 모든 응답은 `no-store`예요.

**F297-2 · 초과 본문 413을 정리 대기와 분리**
- 1024바이트를 넘으면 `reader.cancel()`은 시작만 하고 기다리지 않아요. 실패도 삼켜요.
- 그 즉시 `too-large`를 돌려줘 413을 응답해요. 정리가 느리거나, 끝나지 않거나, 실패해도 응답이 묶이지 않아요.

## 시험 (`tests/admin/publication-http.test.ts`에 12개 추가, 47개)

- **출처**
  - `a`·`b` 두 출처가 등록돼 있고 host가 `a`일 때 Origin이 `b`면 403이에요. 본문(`bodyUsed`)·저장소 0, Fetch Metadata 없음 상태예요.
  - host와 같은 등록 출처면 통과해요(a, b 각각).
  - 전달 머리글로 host·scheme을 바꿀 수 없어요.
  - 등록 안 된 host, Host 없음, 같은 host의 scheme 이중 등록은 거절해요.
  - 루프백은 같은 host·포트, Vercel이 아닐 때만 받아요.
  - Fetch Metadata가 `same-site`면 거절, `text/plain`이면 415예요.
  - 출처가 틀려도 인증이 먼저라 로그인 없음은 401이에요.
- **초과 본문**: 끝을 알리지 않은 미완료 스트림에 1200바이트를 줬어요. 아래 세 경우 모두 150ms 안에 413이 왔고, 취소는 1회 호출됐고, 저장소는 0회였어요.
  - 취소가 끝나지 않음
  - 취소가 실패함
  - 취소가 2초 걸림
  - 끝없이 이어지는 스트림도 같은 결과예요. 정확히 1024바이트는 정상 처리돼요.
- **이전 코드(`1801d83` 경계)와 비교:** 같은 시험이 6건 실패해요(출처 3건, 취소 대기 3건). 새 코드는 47/47 통과해요.

## 검증 (실제 출력)

**명령 결과**
- 관리자·공용 인증·T198·T200·참고 분석(T296) 회귀: `Test Files 27 passed | 5 skipped (32)`, `Tests 622 passed | 62 skipped (684)`
- 전체 vitest(`b5a7bf1`): `Test Files 139 passed | 16 skipped (155)`, `Tests 2726 passed | 385 skipped (3111)`
- 전체 tsc 오류 0줄, 변경 파일 eslint exit 0, `git diff --cached --check` 통과. 격리 사본 `npm run build` 성공.

**격리 Next 실제 HTTP**
- 서버: 127.0.0.1:43298, `DREAM_SITE_URL=http://127.0.0.1:43298,http://localhost:43298` 두 출처 등록.
- 사본 전용 조작(커밋 안 함): 합성 인증 쿠키, 합성 저장소, 저장소 열기 횟수 계측.
- 요청은 Fetch Metadata 없는 일반 Node HTTP 클라이언트로 보냈어요.

| 요청 | 결과 |
|---|---|
| host 127.0.0.1 · Origin localhost(다른 등록 출처) · 깨진 JSON | 403 `AUTH_ORIGIN_REJECTED`, `no-store` (이전: 400) |
| 같은 조건 · 정상 준비 요청 | 403 |
| 같은 조건 + `x-forwarded-host: localhost:43298` | 403 |
| 위 세 요청 뒤 | 저장소 열기 0회, 트랜잭션 0회, 작품 v0 그대로 |
| host 127.0.0.1 · Origin 127.0.0.1 · 준비 요청 | 200 `prepared` v1 |
| host localhost · Origin localhost · 깨진 JSON | 400 (출처 통과 뒤 본문 판정) |
| 로그인 없음 / 허용 안 된 계정 | 401 / 403 `AUTH_FORBIDDEN` (`no-store`) |
| 2000바이트 본문(길이 선언 또는 chunked, 전송 완료) | 413 `PAYLOAD_TOO_LARGE`, 5~78ms, 트랜잭션 0회 |

정리: 격리 사본·서버를 정리했고, 원본 `node_modules`는 283개 그대로예요. 화면 변경이 없어 ego는 쓰지 않았어요. 실제 DB·외부 요청·배포는 없었어요.

## 남은 관찰 (범위 밖, Master 판단 필요)

chunked로 2000바이트 또는 70000바이트를 보내고 본문을 끝내지 않은 요청은 3~5초 동안 응답이 없었어요. 사본 라우트에 진입·반환 시각 기록을 넣고 다시 쟀어요.

- 끝나지 않은 요청에서는 라우트 핸들러 진입이 0회였어요. 본문을 끝낸 요청은 진입 뒤 2ms 만에 413을 반환했어요.
- 사본 전용 조작 라우트(`/api/t297-hooks`)도 같은 상태로 응답이 없었어요.

즉 라우트 앞 단계에서 Next 서버 또는 모든 경로에 걸리는 `proxy`(matcher가 `/api`를 포함)가 요청 본문을 끝까지 받은 뒤에 라우트를 부르는 것으로 보여요. 이 경계 코드로는 닿을 수 없는 지점이에요. 공용 proxy·런타임 변경은 이번 범위에서 금지라 고치지 않았어요. 필요하면 플랫폼 본문 상한이나 proxy 본문 처리를 별도 작업으로 보는 것을 제안드려요.
