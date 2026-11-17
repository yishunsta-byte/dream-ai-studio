# T209 브라우저 세션·화면 전환 독립 검수

- 판정: **FAIL — F209-1(P2), 탭 간 로그아웃·계정 변경 뒤 이전 계정 표시가 남는다.** 새 요청의 인증 차단과 legacy 저장소 차단은 통과했다. 사용자 데이터 접근 우회로 판정하지 않는다.
- 기준: `1c36974b48e11aaa525c3ba82f43d8b2f1a02f03`, T200 포함. T207 이후 cloud UI/Backend B5 변경은 대상 밖이다.
- Master의 T209 배정에 따라 실제 ego-browser와 합성 A/B 계정만 사용했다. 제품 수정 없이 이 보고서만 공유 저장소에 추가한다. push/배포하지 않는다.
- Master가 허용한 root의 정적 `docs/spec/menus.json` 읽기는 별도로 집계한다. T202의 원래 FAIL 기록을 소급 변경하지 않는다.

## F209-1: 현재 세션과 화면의 계정 표시 불일치

### 기준 제품 그대로 재현

1. 같은 브라우저의 두 탭에서 합성 A(`owner@example.com`)로 준비 화면을 연다.
2. 두 번째 탭의 실제 로그아웃 버튼을 누른다. 첫 번째 탭은 여전히 A 이메일과 **“로그인은 정상적으로 됐어요”**를 표시한다. 첫 탭에서 실제 `/api/jobs`를 요청하면 **401**이다.
3. 두 번째 탭의 실제 로그인 폼으로 합성 B(`second@example.com`)에 로그인한다.
4. 첫 번째 탭은 계속 A를 표시한다. 같은 탭의 API 요청은 B를 실제 SDK getUser로 검증한 뒤 **503 LEGACY_DATA_UNAVAILABLE**로 차단된다. 첫 탭의 화면과 현재 공유 쿠키 계정이 다르다.
5. 첫 번째 탭을 새로고침하면 B로 바뀐다.

이 재현은 시험 링크를 제거하고 원래 root layout을 복구한 뒤 운영 빌드를 다시 만든 상태다. 최종 Git blob 비교도 추적 파일 **830/830 동일**이다. `35-restored-product-A.json`부터 `39-restored-product-reload-B.json`이 증거다. `37`→`38` 사이 추가 getUser 두 건은 모두 B를 반환했으며, `38`의 실제 DOM은 A다. 계정 이메일은 이미 그 탭에 렌더링된 정보이며, B의 데이터가 A에게 반환된 것으로 해석하지 않는다.

### 실제 Next 링크·레이아웃 재사용에서 확대 재현

기준 CloudPending에는 업무 링크가 없다. 따라서 이 부분은 **격리 사본에만 추가한 명시적 `T209 TEST ONLY` Next `<Link>` 도구**로 실행했다. root에 nav를 덧붙였고, 기존 legacy 페이지·StudioLayout·CloudPending·인증 코드는 수정하지 않았다. 제품에 원래 있는 메뉴로 재현했다고 주장하지 않는다.

- 첫 탭 A의 root 문서/레이아웃을 유지한다. 다른 탭에서 A 로그아웃→B 로그인 후, 첫 탭에서 `prefetch={false}`인 `/jobs` 링크를 실제 클릭한다.
- 새 RSC 요청은 200이고 proxy+page getUser **2건 모두 B**다. 이어 API 확인 2건도 B다. 하지만 화면의 AccountMenu는 여전히 **A**다.
- document marker와 root component mount marker는 전후 동일하다. `/workspaces/test`로 다른 route group에 이동하면 B, 새로고침해도 B다. 기존 `(studio)` 레이아웃의 표시 재사용과 일치하는 관측이며, 프로세스 전역 auth 캐시 누출을 입증한 것은 아니다.
- 증거: `29-cross-A-prefetch.json`~`34-cross-reload-B.json`, `07-cross-account-network.json`, 직접 열어 확인한 `cross-account-jobs.png`.

권장 후속 범위는 계정 전환·로그아웃을 다른 탭에 전달하고, 해당 탭의 계정 표시와 router cache를 다시 검증하는 것이다. focus 복귀·새 요청 401 때 표시를 정리하는 것도 검토할 수 있다. 클라우드 업무 데이터 화면이 열리기 전에 같은 시나리오를 재검수해야 한다. 이번에는 구현하지 않았다.

## 실제 브라우저에서 확인한 경계

| 시나리오 | 이번 관측 |
|---|---|
| 정상 로그인 A/B | 각 전체 문서 이동 뒤 해당 계정만 표시 |
| 정상 같은 탭 로그아웃 | 로그인 화면으로 전체 이동, 새 API 401 |
| 로그아웃 뒤 실제 뒤로 이동 | 이전 보호 URL에 새 요청 후 로그인으로 이동, A 표시 없음, API 401 |
| 네트워크를 실제 offline으로 둔 로그아웃 | “인터넷 연결을 확인하지 못해…”와 재시도 표시, 이동 없음. online 복귀 뒤 세션 유지(API 503 legacy gate) |
| provider global/local logout 모두 500 | SDK local 정리 뒤 `/login?notice=logout-partial`, 다른 기기 상태는 확인 못했다는 안내, 새 API 401 |
| 같은 탭 B 로그인 뒤 실제 뒤로/앞으로 | A 표시 없음. 과거 A의 settings history entry를 직접 선택해도 B 표시 |
| 실제 Next prefetch | `/settings?_rsc=…`, `rsc:1`, `next-router-prefetch:1`, segment tree 요청 200와 후속 RSC 200 관측. 링크 클릭 전에 완료 |
| prefetched settings 실제 클릭 | 같은 document/root marker 유지, 추가 auth 0. HTTP 응답을 새로 받았다고 주장하지 않음 |
| prefetch 없는 jobs 실제 클릭 | 같은 document/root marker 유지, 새 RSC와 proxy+page auth 2회 |
| client 뒤로/앞으로 | CDP의 실제 history entry 이동. 원래 브라우저가 발생시킨 popstate 1→2건과 같은 document/root 유지, 추가 auth 없음 |
| provider에서 A 세션을 거절한 뒤 cached settings 이동 | 이전 A/로그인 정상 문구가 남음. API는 401. F209-1과 같은 표시 갱신 한계 |
| 같은 상태에서 새 history 경로 이동 | 실제 요청 후 `/login?next=%2Fhistory`, 계정 표시 없음, API 401 |
| provider에서 B 세션을 거절한 정지 화면 | 기존 B 표시가 남으나 새 API 401. 새로고침하면 로그인 |
| 다른 탭 로그아웃 뒤 cached 이동 | 기존 B 표시가 남고 API 401. 새로고침하면 로그인. F209-1 범위 |
| root 정적 메뉴 읽기 | 전체 세 runtime process에서 **6건** 허용·기록 |
| private runtime fs / SQLite constructor | **0건**. 감시기 자체 대조에서는 각각 1건씩 기록 후 throw |

prefetch/click/history는 실제 브라우저 입력과 Next 링크로 실행했다. `dispatchEvent`, 가짜 popstate, 임의 RSC 문자열을 만들어 navigation 증거로 쓰지 않았다. 관측용 코드는 실제 fetch를 그대로 위임하면서 URL/header/status만 기록하고, native pageshow/popstate를 수동 발생시키지 않고 기록했다. 독립 CDP Network 기록도 보존했다.

Chrome 156의 native 뒤로/앞으로는 실행했지만 **BFCache 복원 성공은 관측하지 못했다**. `Page.backForwardCacheNotUsed` 4건에 `MainResourceHasCacheControlNoStore`, `CacheControlNoStoreCookieModified`, `BrowsingInstanceNotSwapped` 등의 이유가 기록됐다. 이것과 Next의 같은 문서 router cache 재사용을 구분한다. BFCache 복원까지 PASS라고 하지 않는다.

“세션 만료”는 provider가 기존 합성 토큰에 401을 반환하도록 만든 **서버 측 세션 무효화**다. 자연 JWT exp 도달·refresh token 회전·실 Supabase 세션 만료는 미검증이다. OS 시계를 바꾸지 않았다.

## 실행·증거·한계

소유 사본: `D:/starwork/t209-browser-1c36974`, source ZIP: `D:/starwork/t209-browser-source.zip`. Git archive를 LF 그대로 추출하고 node_modules는 이전 소유 사본에서 물리 복사했다. 새 패키지는 설치하지 않았다.

- `tmp/t209/verify-baseline.mjs`: 시작·원본 복구·종료 시 기준 추적 파일 **830개, 차이 0**. 추가 관측 파일은 별도다.
- 기준 `next build` + `scripts/verify-build.mjs` 통과. nav 추가 build와 nav 제거 후 복구 build도 통과. build 내부 TypeScript 검사 통과. 독립 eslint/별도 tsc/full suite를 이번에 추가 실행한 것으로 주장하지 않는다.
- `t200-legacy-page-gate`, `t183-cloud-pending`, `t198-legacy-gate`: **3 files / 194 PASS**.
- `tmp/t209/analyze.mjs`: 보존된 관측 JSON의 **22개 사실 검증 assertion 통과**. 위 실패 현상이 실제 기록됐는지도 검사하므로, 이를 “기능 22개 전부 PASS”로 해석하지 않는다.
- `tmp/t209/harness.mjs`: 실제 Supabase SSR SDK → loopback fakeAuth → 실제 `next start`. 모드는 `DREAM_PROJECT_READ_BACKEND=postgres`, 실제 DSN 없음. 프로젝트 DB GET/DB 연결은 호출하지 않았다. 요청은 준비 화면과 auth/legacy API 경계까지만 실행했다.
- `tmp/t209/negative-preload.cjs`, `negative-control.mjs`: 소유 DREAM_DATA_ROOT의 fs 호출과 SQLite constructor를 기록 후 throw. static menu는 따로 허용했다. `io-negative-control.jsonl`과 `negative-control.log`에서 두 trap이 실제 발동했고 runtime `io-events.jsonl`에는 static menu 6건만 있다. 모든 가능한 IO syscall을 추적한 운영 감사라고 확대하지 않는다.
- 실제 브라우저 TaskSpace **39** 하나, p1/p2 두 합성 탭. 최종 `40-final-clean-session.json`에서 정상 계정 요청 503 `LEGACY_DATA_UNAVAILABLE`/`no-store`, 최종 로그아웃 뒤 401 `AUTH_REQUIRED`/`no-store` 확인.
- 주요 파일: `evidence/baseline-integrity.json`, `build-baseline.log`, `verify-build-baseline.log`, `build-probe.log`, `build-restored.log`, `related.log`, `analysis.json`, 번호별 상태 JSON, `*-network.json`, `fake-events.jsonl`, `io-events.jsonl`, `next-*.log`. 재현 스크립트는 `tmp/t209/browser-*.mjs`에 보존했다.

초기 관측 도구의 오류는 제품 실패로 세지 않았다. source archive 명령의 첫 cwd 오류는 올바른 repo에서 다시 실행하고 830개 hash를 확인했다. 최초 로그아웃 클릭은 hydration 전이라 provider 호출이 없었고, 빈 live region을 기다린 결과를 실패 검증으로 채택하지 않았다. 이후 실제 React handler 준비와 재시도 문구를 기다려 offline/partial/정상 경로를 다시 실행했다. 서버 재시작 직후 1회 connection refused는 준비 확인 뒤 같은 TaskSpace에서 복구했다. 최초 fetch 관측기는 URL object의 `.url`을 잘못 읽어 대기 오류가 났고, URL/Request를 구분하는 관측기로 수정한 `29` 이후 실제 URL·prefetch 완료를 확인했다. 이 오류 로그·초기 스크립트도 보존한다.

실 Supabase·managed DB·사용자 DB·메일·TLS·배포·다른 브라우저는 미검증이다. Vercel/unknown backend HTTP 전체 matrix는 T202의 이전 결과이며 이번에는 postgres 경계만 실행했다. T205의 전체 1177 PASS·53 skip은 작성자 결과이고 이번에 재실행하지 않았다. 기존 ZIP 과거 실패 unknown을 닫지 않는다. 현재 T207 새 cloud 화면의 캐시 정책을 이번 결과로 판정하지 않는다.

## 정리

- 브라우저 합성 세션 로그아웃 후 TaskSpace 39를 `finish({keep:[]})`로 닫았다.
- 소유 harness PID **76276**, Next PID **14524 → 28808 → 77460**을 순서대로 종료했다. `/stop`으로 앞 두 프로세스를 종료한 뒤 빌드했고 `/shutdown`으로 최종 child와 fakeAuth를 닫았다.
- 43314/43315 listener 없음, 소유 사본 경로를 명령줄에 가진 node process 없음 확인. 사용자 **3013 PID 51032 유지**.
- 공유 제품 파일·공유 `.next`·T207/Backend WIP·사용자 저장소·OS 시계·환경/배포 설정은 변경하지 않았다. 소유 사본/증거는 보존한다.

Master에는 F209-1의 제품 원본 두 탭 재현과 시험 도구를 통한 새 RSC/레이아웃 재사용 재현을 구분해 반환한다. 인증/legacy 차단 PASS와 표시 잔류 FAIL을 함께 유지하며 전체 수용 PASS를 요청하지 않는다.
