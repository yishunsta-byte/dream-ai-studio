# 클라우드 로그아웃 클릭 재현

MASTER 배정 `msg_eca4432f0ff8` · Next.js 16.4.6 · Chromium · 시험용 인증 및 격리 루프백 환경

**이전 클릭 무응답을 IPv6 루프백의 custom Next 개발 서버에서 재현했다.** 같은 개발 커밋의 IPv4와 기존 프로덕션 빌드의 IPv4·IPv6에서는 실제 클릭, 로그아웃 POST, 브라우저 쿠키 삭제와 로그인 복귀가 모두 통과했다.

| 고정 기준 및 실행 | JS 응답 및 버튼 연결 | 실제 클릭·POST·복귀 |
| --- | --- | --- |
| `a48bb4014cb95592f36e40b6adffeca9ed8d2f68` · IPv4 custom Next dev webpack · `/cloud/reference-analysis` | JS 응답 8건 200. 클릭 전 React 처리기 확인, 세션 확인 GET 200. | 신뢰된 클릭 1회, POST 200 한 건, 쿠키 삭제, `/login` 복귀. 분석 주소를 다시 열자 `next`가 지정된 로그인으로 이동. |
| 같은 `a48bb40` · IPv6 `[::1]` custom Next dev webpack · 같은 화면 | JS 응답 6건 200. 클릭 전 React 처리기와 세션 확인 GET이 관측되지 않음. | 신뢰된 클릭 1회, 로그아웃 POST 0건, 분석 화면에 남음. |
| `e4fa3783b4b7efcf1e1b4f80e52c2ee5515d7080` · IPv4 기존 production · `/cloud/projects` | JS 응답 14건 200. 처리기 확인, 세션 확인 GET 200. | 신뢰된 클릭, POST 200 한 건, 쿠키 삭제와 로그인 복귀. 내 프로젝트 주소 재진입 시 로그인으로 이동. |
| 같은 `e4fa378` · IPv6 `[::1]` 기존 production · 같은 화면 | JS 응답 14건 200. 처리기 확인, 세션 확인 GET 200. | 신뢰된 클릭, POST 200 한 건, 쿠키 삭제와 로그인 복귀. 내 프로젝트 주소 재진입 시 로그인으로 이동. |

JS 응답은 앱 서버에서 수집했고 성공 행의 응답 수에는 전환 과정에서 읽은 파일이 포함된다. 정상 POST마다 합성 인증 서버의 로그아웃도 한 번 호출됐다. 실패 환경의 콘솔과 오류 이벤트에는 새 오류가 기록되지 않았다. IPv4 개발에서 Fast Refresh 전체 새로고침 경고를 한 번 관측했다. 실패 환경에서 확인한 직접 원인은 클릭 전에 버튼의 React 처리기가 연결되지 않았다는 점이다. 해당 개발 환경에서 연결이 지연·누락된 내부 이유는 확인되지 않았다.

관련 인증·세션 Vitest 2개 파일 210건을 통과했다. 사용한 기존 프로덕션 산출물의 BUILD_ID는 `gGldrvBXf0nqE6rDGJfDR`이다. 재현 스크립트, 실행 조건과 JSON은 로컬 `D:/starwork/cloud-logout-review-a48bb40-0f39e2b1`에 보관했다. 제품과 운영 환경에는 변경이 없었다.

## 고정 최소 배포 후보 독립 실측

**통과.** MASTER 배정 `msg_f2f202a398d2`, 후보 tree `1341083f72b571b54c3d4ccd5c032d6b1c544878`, 메인 PC BUILD_ID `6ySrF3m613BG2kQI4gSfV`. 운영 기준 `e4fa3783` 대비 제품 10개와 시험 3개를 확인했다. 원본·실행 사본의 추적 파일 1,241개를 후보 tree에 대조했고, 줄바꿈을 정규화한 lockfile Git blob `b5255703dd7543245082ddd3f18862cddac381db`는 기준과 일치했다. 서버·정적·빌드 식별 파일 1,150개가 원본과 실행 사본에서 같았고, 검사 전후 지문은 `404538c9a4969b440ba1c9fc796dbbb503081b8ab7b41a05f7992e5cb413db0c`였다.

별도 복사본에서 기존 빌드를 `dev: false`로 실행하고 외부 루프백 합성 Auth만 연결했다. Chromium 390×844와 1440×900에서 제품 로그인 폼에 합성 계정을 입력하고 `/cloud/reference-analysis`로 들어갔다. 두 폭에서 메뉴 2개와 콘텐츠 분석 현재 위치, 미연결 안내, 비활성 분석 실행, 가로 넘침 0px을 확인했다.

| 조작 | 390px와 1440px 실측 |
| --- | --- |
| 정상 로그아웃 | 실제 버튼 클릭 1회에 앱 POST 200 한 건과 합성 인증 서버 전역 로그아웃 204 한 건. 앱 응답의 쿠키 삭제 뒤 `/login`으로 이동. |
| 부분 로그아웃 | 실제 버튼 클릭 1회에 앱 POST 502 한 건. 합성 인증 서버의 전역·로컬 요청은 각각 503. 앱은 브라우저 쿠키를 삭제하고 `/login?notice=logout-partial`에서 다른 기기 로그아웃 미확인을 안내. |
| 보호 화면 재접근 | 두 로그아웃 경로 모두 브라우저가 쿠키 없이 분석 주소를 다시 요청했다. HTTP 307로 `/login?next=%2Fcloud%2Freference-analysis`에 이동했다. |

브라우저 4회 검수의 종료 코드는 0이었다. 원본 후보, 제품 코드, 운영 계정과 데이터는 수정하지 않았다. `D:/starwork/rea-final-logout-review-d2ee5c2c`에 `identity.json`, `logout-evidence.json`, 재현 스크립트를 보관했다.

## 고정 후보의 인증 거절 및 RSC 비노출

**통과.** MASTER 배정 `msg_d9303f62ec28`. 로컬 후보 커밋 `38c133674460e418369edd42a032effd4a1ee29d`가 같은 tree `1341083f72b571b54c3d4ccd5c032d6b1c544878`를 가리키고 부모가 `e4fa3783`임을 확인했다. 위와 같은 BUILD_ID `6ySrF3m613BG2kQI4gSfV`의 실행 사본과 외부 합성 Auth를 사용했다.

`/cloud/reference-analysis?from=denial-review`를 HTML 직접 요청, 초기 RSC, 라우터 프리페치, 세그먼트 프리페치, 브라우저 프리페치 형태로 호출했다. 아래 네 상태 모두 요청 다섯 건이 각각 `307`, `Cache-Control: no-store`였다.

| 상태 | 합성 인증 응답 | 리다이렉트 |
| --- | --- | --- |
| 비로그인 | Auth 요청 0건 | `/login`의 `next`에 보호 경로와 쿼리 유지 |
| 비허용 계정 | 사용자 확인 200, 제품 허용 목록에서 차단 | `/login?error=forbidden` |
| 무효 세션 | 사용자 확인 401 | `/login`의 `next`에 보호 경로와 쿼리 유지 |
| 만료 세션 | 갱신 요청 400, 갱신 거절 | `/login`의 `next`에 보호 경로와 쿼리 유지 |

HTTP 20건의 본문 또는 리다이렉트 주소에서 보호 화면 문구, 합성 계정 이메일·ID, 자료 표식이 검출된 건수는 0이었다. 허용 계정 대조 요청에서는 실제 보호 화면 문구와 해당 합성 이메일이 200 HTML에 나타났다. 390×844px 브라우저에서도 네 상태 모두 지정된 로그인에 도착했고 클라우드 메뉴, 계정·자료 표식, 가로 넘침은 0이었다. 비허용 계정에서는 ‘이 계정은 사용할 수 없어요’ 안내를 확인했다.

브라우저·HTTP 시험 종료 코드 0. 로컬 `D:/starwork/rea-final-logout-review-d2ee5c2c`에 `verify-denial.mjs`, `denial-evidence.json`, `rejected-390.png`를 보관했다. 시험 범위는 보호 셸과 합성 Auth이며 운영 계정·등록 자료 공급원은 사용하지 않았다.
