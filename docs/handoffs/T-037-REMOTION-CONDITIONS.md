# T-037 · Remotion 사용 조건 조사 (공식 문서 원문 기준)

> **법률 판단이 아니다.** 공식 페이지에 적힌 문장을 옮기고 요약했을 뿐이다. 구매·설치·계정 연결은 하지 않았다. 은영님께 질문을 보내지 않았고, 필요한 사실은 6장에 모아 Master에게 넘긴다.

| 항목 | 내용 |
|---|---|
| 담당 / 지시 | Claude design (CC-DESIGN-01) / Master `msg_3f0545fe3bb3` |
| 확인일 | 2026-11-16 (페이지 읽기 + npm 공개 정보 조회) |
| 바꾼 파일 | 이 파일 하나 |
| 관련 | PLAN 2.3 "협업 인원 P7: 4명 이상이면 Remotion 유료", T-033 U-6, PLAN 18장 P2-2 |

## 1. 읽은 출처

| # | URL | 결과 | 날짜 표시 |
|---|---|---|---|
| S1 | https://github.com/remotion-dev/remotion/blob/main/LICENSE.md | 읽음 | 날짜 없음, "Copyright © 2026 Remotion". 머리에 "In Remotion 5.0, the license will slightly change." |
| S2 | https://www.remotion.dev/license | 읽음 | 날짜 없음 |
| S3 | https://www.remotion.dev/docs/license/pricing | 읽음 | 날짜 없음, 버전 표시 없음 |
| S4 | https://www.remotion.dev/docs/license/faq | 읽음 | 날짜 없음, 버전 표시 없음 |
| S5 | https://www.remotion.dev/docs/terms (v5.0 약관) | 앞 약 40,000자/54,000자만 원문 확인 | "Remotion 5.0 출시 때부터 5.0 이후 버전에 적용" |
| S6 | https://www.remotion.dev/docs/terms-4-0 (v4.0 약관) | 전체 읽음 | "Latest update: November 23, 2023", "Remotion 4.0에 적용, 5.0 출시 때 교체" |
| S7 | https://github.com/remotion-dev/remotion/pull/3750 | 설명만 읽음(Draft, 미병합) | 새 LICENSE는 "Remotion 5.0과 함께, 5.0 이상 사용자에게 적용" |
| S8 | https://www.remotion.dev/docs/player | 읽음 | 라이선스 언급 없음 |
| S9 | npm `remotion` | 최신 **4.0.543**(2026-11-11 갱신), `license: SEE LICENSE IN LICENSE.md`. `@remotion/player`도 같은 표시 | — |
| — | https://www.remotion.pro/license | 다른 주소(대시보드)로 넘어가 읽지 않음 | — |

## 2. 지금 적용되는 것 (버전 기준)

- 최신 공개 버전이 **4.0.543**이라 **5.0은 아직 나오지 않았다**(S9). 5.0 약관(S5)·새 LICENSE(S7)는 스스로 "5.0부터 적용"이라고 적고 있다.
- 4.x에 적용되는 글은 **S1 LICENSE.md**(S6 4.0 약관이 "소프트웨어는 LICENSE.md 조건을 따르고 그 조건이 우선"이라고 가리킴). S6 자체에는 무료 기준·가격·Player 규정이 **없다**.
- S3·S4의 가격 체계(아래 4장)는 **어느 버전에 적용되는지 페이지에 적혀 있지 않다.** 4.x 사용자에게 지금 그대로 적용된다고 단정하지 않는다.
- 패키지별(Player·Renderer 따로) 라이선스는 없다. `remotion`, `@remotion/player` 모두 같은 LICENSE.md를 가리킨다(S9). 오픈소스가 아니라 "source-available"(S4 FAQ).

## 3. 무료로 쓸 수 있는 경우 (S1 원문)

S1 "Free License" 대상:
- "an individual" (개인)
- "a for-profit organization with up to 3 employees" (직원 3명 이하 영리 조직)
- "a non-profit or not-for-profit organization" (비영리 조직)
- "evaluating whether Remotion is a good fit, and are not yet using it in a commercial way" (평가 중, 아직 상업 사용 전)

보충(S4 FAQ·S5 — 4.x에 적용되는지는 2장 단서와 같음):
- 개인은 "whether for personal or commercial use" — 개인의 상업적 사용도 무료 대상이라고 적음.
- "If you are eligible, you don't need to buy a license - even if you set up an automation, launch a SaaS, or are using it commercially."
- 인원 세는 법(S5, 5.0): 사용 여부와 관계없이 **조직 전체 인원**, 같은 일을 함께 하는 계약직·시간제도 포함. 결과 MP4만 받는 고객은 제외. S1(4.x)은 "employees"라고만 적어 계약직 포함 여부가 다를 수 있다(S7의 5.0 변경점 첫 줄이 "Contractors also count towards team size").
- 비영리라도 정부기관·**교육기관**·영리 자회사 등은 서면 허락이 필요하다고 적음(S4).
- 금지(S1): Remotion 코드를 고쳐 자기 파생물로 팔거나 재허락하는 것. 사용자가 자기 Remotion 코드를 올려 렌더하게 하는 렌더 서비스 운영 금지(S5).

## 4. 유료(Company License)가 필요한 경우와 비용 (S3·S4·S5)

- "Required if you do not qualify for the Free License." — 위 3장에 해당하지 않을 때(영리 조직 4명 이상 등).
- **Remotion for Creators:** "$25 per month per seat" — 영상을 직접 만드는 사람 1명당. AI 에이전트는 자리 불필요.
- **Remotion for Automators:** "$0.01 per render", 1000번 단위($10), **월 최소 $100**. 성공한 렌더(영상·소리·GIF·정지 화면) 수로 셈. Studio·Player 미리보기는 렌더로 세지 않음. 클라우드 비용은 별도.
- 두 가지를 함께 사면 합산 월 최소 $100. Enterprise는 월 $500부터.
- 회사 라이선스 사용자의 Player 웹 삽입은 "automation"으로 분류(Automators 대상). 무료 대상자는 "may embed the Remotion Player without purchasing Renders."
- S5: "The deployment of Remotion Software in a purely local setting, without using server rendering, does not require the purchase of Renders." (회사 라이선스 사용자 기준 문장)
- Automators는 라이선스 키 사용 기록 전송(telemetry) 필요, 브라우저 렌더는 기본으로 켜져 끌 수 없다고 적음(S4·S5).

## 5. 우리 앱에 대입 (사실 정리, 결론 아님)

| 우리 사용 방식 | 페이지 문장과의 관계 |
|---|---|
| P2-2 편집 화면 미리보기 = `@remotion/player`, 이 PC 안(127.0.0.1)에서만 | Player 표시는 렌더가 아님(S4). 무료 대상이면 렌더 구매 없이 삽입 가능(S4) |
| P2-4 MP4 만들기 = 이 PC에서 렌더(서버·클라우드 없음) | 무료 대상이면 자동화도 렌더 구매 없음(S4). 회사 라이선스면 "purely local" 문장(S5)이 있으나 5.0 약관 |
| 사용자 = 은영님 한 사람, 자기 콘텐츠(상업 가능) | 개인은 상업 사용 포함 무료 대상(S1·S4) — **단, 은영님이 어떤 조직을 대신해 만드는지에 따라 달라짐(6장)** |
| P7 협업(여럿이 사용) | 영리 조직 4명 이상이면 유료 — PLAN 2.3 기존 메모와 같은 방향 |
| 렌더 기능을 남에게 서비스로 제공 | 하지 않음(금지 조항 해당 소지) — 계획에도 없음 |

## 6. 확인 못 한 사용자 정보 (Master 취합 → 필요할 때만 은영님께)

1. 이 앱으로 만드는 영상이 **은영님 개인** 활동인지, **회사·학교 등 조직**의 업무인지.
2. 조직 업무라면 그 조직의 **전체 인원**(계약직 포함)이 3명 이하인지, 영리/비영리/교육기관인지.
3. P7 이전에 다른 사람이 이 앱으로 영상을 만들 계획이 있는지.

1번이 "개인"이면 3장 기준상 무료 대상으로 보인다. 2번에서 4명 이상 영리 조직이거나 교육기관이면 페이지 기준으로 유료 또는 서면 허락 문의 대상이 될 수 있다 — 이 판단은 은영님(필요하면 Remotion 측 확인)이 한다.

## 7. 추천 (Master 판단용)

1. **P2-1(타임라인 저장)은 Remotion과 무관** — 조건 확인과 상관없이 진행 가능.
2. P2-2 착수 전에 6장 1번만 은영님께 확인(한 줄 질문). "개인"이면 그대로 진행.
3. 설치할 때 **4.x 정확한 버전 고정**(예: 4.0.543, `^` 없이). 5.0 올리기 전 S5·S7 다시 확인(계약직 인원 포함·약관 구속 등 변경 예고).
4. 조직 업무이고 4명 이상이면: (가) Remotion 측 조건 확인 후 유료 결정, 또는 (나) Remotion 없이 미리보기(브라우저 캔버스)·MP4(ffmpeg 직접 합성)로 가는 대안 — 이 경우 T-033 설계(Player 이름 등)를 바꿔야 하므로 Master가 범위 판단.
5. 텔레메트리·라이선스 키는 회사 라이선스(Automators)에만 해당. 무료 대상이면 키 입력 화면을 만들지 않는다.

## 8. 한계

- 법률 판단 아님. 4.x와 가격 페이지(S3·S4)의 적용 관계가 페이지에 명시되지 않음.
- S5 뒷부분 약 14,000자는 원문 확인 못 함. S1을 4.x 릴리스 태그와 대조하지 않음.
- remotion.pro/license 읽지 못함. npm 조회는 공개 정보만(계정·키 사용 없음).
