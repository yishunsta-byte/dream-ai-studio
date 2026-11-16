# T-037 · Remotion 사용 조건 조사 (공식 문서·배포본 원문 기준)

> **법률 판단이 아니다.** 공식 페이지와 공식 배포본에 적힌 문장을 옮기고 요약했을 뿐이다. 구매·설치(프로젝트 의존성 추가)·계정 연결·제품 변경은 하지 않았다. 은영님 개인/조직 여부는 Master가 이미 한 번 질문했으므로 이 문서에서 다시 묻지 않는다.

| 항목 | 내용 |
|---|---|
| 담당 / 지시 | Claude design (CC-DESIGN-01) / Master `msg_3f0545fe3bb3`, 보완 `msg_3d1cbaca5abc` |
| 확인일 | 2026-11-16 |
| 바꾼 파일 | 이 파일 하나 |
| 관련 | PLAN 2.3 "협업 인원 P7: 4명 이상이면 Remotion 유료", T-033 U-6, PLAN 18장 P2-2·P2-4 |

## 1. 읽은 출처

| # | 출처 | 확인 범위 | 날짜 표시 |
|---|---|---|---|
| **S0** | **npm 공식 배포본 4.0.543** — `remotion`, `@remotion/player`, `@remotion/renderer` 각 tarball 안 `package/LICENSE.md` | 세 파일 모두 2,849바이트, SHA-256 앞 16자리 `53e92b6560f26f9d` **동일**. 전문 읽음 | 날짜 없음, "Copyright © 2026 Remotion" |
| **S0-t** | GitHub 태그 `v4.0.543`의 `LICENSE.md` (raw.githubusercontent.com/remotion-dev/remotion/v4.0.543/LICENSE.md) | S0과 바이트·해시 동일 | — |
| S1 | GitHub `main`의 `LICENSE.md` | S0과 바이트·해시 동일(확인일 기준) | 머리에 "In Remotion 5.0, the license will slightly change." |
| S0-c | 4.0.543 배포본 코드 문구: `@remotion/renderer` `dist/options/license-key.js`, `@remotion/player` `dist/cjs/use-remotion-license-acknowledge.js` | 해당 파일 앞부분만 읽음 | 옵션 `addedIn: '4.0.409'` |
| S2 | https://www.remotion.dev/license | 읽음 | 날짜 없음 |
| S3 | https://www.remotion.dev/docs/license/pricing | 읽음 | 날짜·적용 버전 없음 |
| S4 | https://www.remotion.dev/docs/license/faq | 읽음 | 날짜·적용 버전 없음 |
| S5 | https://www.remotion.dev/docs/terms (v5.0 약관) | 앞 약 40,000자/54,000자만 원문 확인 | "5.0 출시 때부터 5.0 이후 버전에 적용" |
| S6 | https://www.remotion.dev/docs/terms-4-0 (v4.0 약관) | 전체 읽음 | "Latest update: November 23, 2023", "Remotion 4.0에 적용, 5.0 출시 때 교체" |
| S7 | https://github.com/remotion-dev/remotion/pull/3750 | 설명만(Draft, 미병합) | 새 LICENSE는 "5.0과 함께, 5.0 이상에 적용" |
| S8 | https://www.remotion.dev/docs/player | 읽음 | 라이선스 언급 없음 |
| S9 | npm 공개 정보 | `remotion` 최신 **4.0.543**(2026-11-11 갱신), `license: SEE LICENSE IN LICENSE.md` | — |

받은 tarball은 저장소 밖 임시 폴더에서 압축만 풀어 글자를 읽었다(실행·설치 안 함).

## 2. 어느 글이 어느 버전에 적용되나

- 최신 공개 버전이 4.0.543이므로 **5.0은 아직 나오지 않았다**(S9). S5·S7은 스스로 "5.0부터"라고 적는다.
- **4.0.543**: 배포본 세 패키지의 LICENSE.md(S0)와 태그(S0-t)가 같고, 확인일의 main(S1)과도 같다. 즉 아래 3장 문장은 **4.0.543 배포본에 실제로 들어 있는 조건**이다.
- **다른 4.x 버전과 나머지 `@remotion/*` 패키지는 대조하지 않았다.** "모든 4.x가 같은 조건"이라고 단정하지 않는다. 버전을 바꾸면 그 배포본 LICENSE를 다시 대조한다.
- S6(4.0 약관)에는 무료 기준·가격·Player 규정이 없고, 소프트웨어 조건은 LICENSE가 우선한다고만 적는다.
- S3·S4의 가격·분류 체계와 S5의 정의는 **적용 버전이 페이지에 없거나(S3·S4) 5.0용(S5)**이다. 4.0.543에 그대로 적용된다고 결론 내리지 않는다. S5의 읽지 못한 뒷부분은 근거로 쓰지 않는다.

## 3. 4.0.543 LICENSE.md 원문 요점 (S0)

- 머리말: "Individuals and small companies are allowed to use Remotion to create videos for free (even commercial), while a company license is required for for-profit organizations of a certain size."
- **Free License — Eligibility:** "an individual" / "a for-profit organization with up to 3 employees" / "a non-profit or not-for-profit organization" / "evaluating whether Remotion is a good fit, and are not yet using it in a commercial way"
- **Allowed:** 무료 대상자는 "to use the software non-commercially or commercially for the purpose of creating videos and images"
- **Disallowed:** "It is not allowed to copy or modify Remotion code for the purpose of selling, renting, licensing, relicensing, or sublicensing your own derivate of Remotion."
- **Company License:** "You are required to obtain a Company License to use Remotion if you are not within the group of entities eligible for a Free License." 가격은 S3로 안내.
- LICENSE.md에는 인원 세는 법(계약직 포함 여부), Player·렌더 구분, 로컬·서버 구분, 가격 숫자가 **없다**.

## 4. 4.0.543 배포본 코드에 있는 안내 문구 (S0-c, 사실만)

- `@remotion/renderer` `licenseKey` 옵션(4.0.409부터) 설명: "For **server-side rendering**, including `renderMedia()` and `renderStill()`, and CLI renders, pass your private license key starting with `rm_sec_`." 무료 대상이면 "`"free-license"`"를 넘기라고 적음. 즉 **Remotion은 `renderMedia()`·CLI 렌더를 "server-side rendering"이라 부른다** — 실행 장소가 내 PC인지 클라우드인지와는 별개 개념이다.
- `@remotion/player`: `acknowledgeRemotionLicense` 속성을 넘기지 않으면 콘솔 경고 "Note: Some companies are required to obtain a license to use Remotion. See: https://remotion.dev/license".

## 5. 웹 문서의 회사 라이선스·5.0 관련 내용 (S3·S4·S5 — 적용 버전 불명 또는 5.0, 참고만)

- Creators "$25 per month per seat", Automators "$0.01 per render", 1000번 단위, 월 최소 $100, Enterprise 월 $500부터(S3·S4).
- Player 표시는 렌더가 아니며 무료 대상은 렌더 구매 없이 Player 삽입 가능, 회사 라이선스의 Player 웹 삽입은 automation(S4·S5).
- 인원은 조직 전체·계약직 포함(S5, 5.0). S7의 5.0 변경 첫 줄도 "Contractors also count towards team size".
- 교육기관·정부기관 등은 비영리여도 서면 허락 필요(S4).
- "purely local setting, without using server rendering" 문장(S5)은 **5.0 약관의 회사 라이선스 사용자 조항**이다. 우리 렌더가 여기에 해당한다고 판단하지 않는다(4장대로 `renderMedia()`는 Remotion 표현상 server-side rendering).

## 6. 우리 앱에 대입 (사실 정리, 결론 아님)

| 우리 계획 | 관련 사실 |
|---|---|
| P2-2 편집 화면 미리보기 = `@remotion/player`, 127.0.0.1 앱 안 | 4.0.543 LICENSE는 Player를 따로 구분하지 않음(S0 동일 파일). 회사 대상 경고 문구가 코드에 있음(4장) |
| P2-4 MP4 만들기 = 이 PC의 Node 서버(Next.js)에서 렌더러 실행 | **실행 장소는 이 PC(클라우드 아님)지만, Remotion 표현으로는 server-side rendering**(4장). 무료 대상이면 렌더 옵션에 `"free-license"`를 넘기는 방식이 배포본에 안내됨. 회사 라이선스 대상이면 키·사용 기록 전송이 관련됨(S0-c, S5) |
| 사용자 = 은영님, 자기 콘텐츠(상업 가능) | 4.0.543 LICENSE상 "an individual"은 상업 사용 포함 무료 대상. **어느 주체(개인/조직)로 쓰는지에 따라 달라짐** — Master 질문의 답으로 정함 |
| P7 협업 | 영리 조직 4명 이상이면 회사 라이선스 — PLAN 2.3 기존 메모와 같은 방향 |
| 남에게 렌더 서비스 제공 | 계획 없음. 파생물 판매 금지(S0), 5.0의 렌더 서비스 금지(S5) |

## 7. 사용자 정보

> **답변 (T-040):** 은영님 직접 답변 2026-11-16 "개인 활동이야" — 이 앱으로 만드는 영상은 **은영님 개인 활동**(Claude design 대화창, Master 전달 `msg_cb1b66262ac0`). 아래 1번의 답이며, 2번(조직 인원·성격)은 해당 없음. 4.0.543 LICENSE의 "an individual" 무료 대상 원문에 해당한다고 기록한다(법률 판단 아님). 이에 따라 P2-2 배정 때: 같은 버전 정확 고정, 그때 추가되는 모든 Remotion 패키지 LICENSE 대조, Player `acknowledgeRemotionLicense`·렌더 `licenseKey: "free-license"`를 개인 사용 근거로 허용하는 방향. 버전 변경·조직 전환·P7 협업 전에는 다시 확인. **지금 설치·렌더·구매는 하지 않는다.**

질문했던 항목 (기록):

1. 이 앱으로 만드는 영상이 은영님 **개인** 활동인지, 회사·학교 등 **조직** 업무인지.
2. 조직이면 전체 인원(계약직 포함 여부 포함)과 영리/비영리/교육기관 여부.
3. P7 전에 다른 사람이 이 앱을 쓸 계획.

## 8. 추천 (Master 판단용)

1. **P2-1(타임라인 저장)은 Remotion과 무관** — 이 확인과 별개로 진행 가능.
2. 설치할 때 **4.0.543 정확한 버전 고정**(`^` 없이, `remotion`·`@remotion/player`·`@remotion/renderer` 등 모두 같은 버전). 버전을 바꿀 때마다 그 배포본 LICENSE.md 해시를 이 문서 S0과 대조, 5.0으로 올리기 전에는 S5·S7 다시 확인.
3. 개인 무료 대상으로 확정되면: ~~렌더 옵션 `licenseKey: "free-license"`~~ → **렌더 옵션 `licenseKey: null`(넘기지 않음)** (2026-11-16 T-106 갱신, Master T-101 회수 결정: 4.0.543 배포 코드에서 `"free-license"`도 성공한 렌더마다 `https://www.remotion.pro/api/track/register-usage-point`로 사용 기록을 보내고 `null`이면 보내지 않음을 확인. 근거·문서와의 차이는 `docs/handoffs/T-106-RENDER-DECISIONS.md` 2장. 4.x 동안 서버 렌더 사용 기록은 무료 대상에게 "voluntary"(공식 문서). 5.0으로 올리기 전 2번대로 다시 확인), Player `acknowledgeRemotionLicense`는 그 확인 뒤에만 넣는다(확인 전에 경고를 끄지 않음). 키 입력 화면은 만들지 않는다.
4. 조직 4명 이상 영리·교육기관 등이면: (가) Remotion 측 조건 확인 후 유료 여부 결정(은영님), 또는 (나) Remotion 없이 미리보기(브라우저 캔버스)·MP4(ffmpeg 직접 합성) 대안 — T-033 설계 이름(PlayerPanel 등) 영향은 Master 범위 판단.

## 9. 한계

- 법률 판단 아님. 4.0.543 외 4.x 버전, 나머지 `@remotion/*` 패키지 LICENSE는 대조하지 않음.
- S3·S4의 적용 버전 미표시, S5 뒷부분 약 14,000자 미확인 — 이 부분으로 현재 버전 결론을 내지 않음.
- 배포본 코드는 라이선스 관련 두 파일 앞부분만 읽음. remotion.pro/license는 다른 주소로 넘어가 읽지 못함.
- npm·GitHub 조회는 공개 정보만(계정·키 사용 없음).
