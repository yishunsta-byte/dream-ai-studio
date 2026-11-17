# T-177 공용 Button: 막힌 이유를 버튼 설명으로 연결 (T176 A안)

- 담당: CC-DATA-01
- 지시: CX-MASTER-01 msg_58c531daa51c "A안 구현"
- 기준: HEAD `b15f039`
- 상태: 자체 검수
- 바꾼 파일
  - `components/ui/primitives.tsx`(Button만)
  - 새 `tests/t177-button-reason.test.ts`
  - 이 보고서
- 바꾸지 않은 것
  - 사용처 14곳의 코드
  - 클릭·Tab·disabled 동작
  - 스타일, 서버, DB
  - 다른 공용 컴포넌트

## 수정
- `disabledReason`이 있으면 이유 `span`에 `useId()` 기반 id(`…-reason`)를 줘요.
- 버튼에는 `aria-describedby`로 그 id를 연결해요.
- 호출한 쪽이 이미 `aria-describedby`를 줬다면 지우지 않아요. 그 뒤에 이유를 덧붙여요.
- 이유가 없으면(보통, `loading`만, `disabled`만) 설명 속성을 만들지 않아요.
- 버튼은 여전히 native `disabled`예요. **Tab으로 막힌 버튼에 갈 수 없는 점은 그대로예요**(T176 B안 범위).
- 서버 컴포넌트에서도 쓰는 파일이에요. 설치된 React 19.3.1과 Next 내장 React의 react-server 빌드 모두 `useId`를 내보내는 것을 확인했어요. 실제 운영 빌드와 서버 렌더도 아래처럼 통과했어요.

## 확인

| 확인 | 결과 |
|---|---|
| 새 시험 `t177-button-reason` | 5/5 통과. 이유가 보이는 글을 가리킴 / 이유 없으면 속성 없음 / 호출 쪽 설명 보존 / 여러 버튼이 서로 다른 이유 / T123 C1 지점(편집 머리 dirty "영상 만들기", 영상 만들기 화면의 막힌 버튼) |
| 수정 전 코드로 대조 | 새 시험 4개 실패, 1개 통과("이유 없으면 속성 없음"). 새 함수가 없어서가 아니라 **설명 연결이 없어서** 실패한 행동 대조예요 |
| 컴포넌트 렌더 시험 7파일 | 40 통과 |
| 전체 시험(공용 컴포넌트라 실행) | 68파일 통과·3 skip, 717 통과·23 skip, exit 0 |
| `eslint components/ui tests/t177-button-reason.test.ts --max-warnings 0` | exit 0 |
| `tsc --noEmit --incremental false` | exit 0 |
| 운영 빌드(Turbopack) + `verify-build` | 둘 다 exit 0. OS 임시 안전 사본에서 빌드했어요(git archive + 이 변경, node_modules robocopy /XJ) |
| 서버 렌더 | 사본에 가짜 데이터 폴더를 두고 migrate·seed한 뒤, 자기 포트 43177에서 `next start`. `/`, `/settings`, `/jobs`, `/library`, `/history` 모두 200. 서버 HTML의 막힌 버튼 `aria-describedby`가 같은 문서의 이유 `span` id와 같아요 |
| 실제 브라우저 접근성 트리 | ego-browser, CDP `Accessibility.getFullAXTree`, 1280과 390 각각. `/settings`에서 "제공사 연결" 설명 = "실제 AI 연결은 P3부터 제공해요.", "검사하기" 설명 = "백업과 새 빈 폴더를 골라 주세요." |
| 가로 넘침 | 1280: -15, 390: 0 |

- "검사하기"의 이유는 hydration 뒤에 "검사 정보를 불러오는 중이에요."에서 바뀌었어요. 설명도 새 문장을 따라갔어요. 서버와 브라우저의 id가 어긋나 연결이 끊기는 일은 없었어요.
- 영상 만들기 화면은 seed 프로젝트가 아직 기획 단계라 막힌 버튼이 나오지 않았어요. 그래서 그 지점은 정적 렌더 시험으로만 확인했어요.

## 남은 것
- 실제 화면 읽기 프로그램(NVDA 등)으로 듣는 확인은 하지 않았어요.
- 막힌 버튼이 Tab 순서에서 빠지는 문제는 B안의 일이에요. 디자인·Master 결정이 필요해요.
- `disabledReason` 없이 `disabled`만 쓰는 버튼(예: 처리 중 잠금)은 이번 범위가 아니에요.

## 정리
- 사본과 가짜 데이터 폴더는 지웠어요. 사본 안 `.next/node_modules`의 링크 2개(사본 내부를 가리킴)를 먼저 끊고 지웠어요.
- 43177 서버는 이 작업이 띄운 것만 멈췄어요. 사용자 3013 서버는 건드리지 않았고 계속 떠 있어요.
- 원본 node_modules 266개는 그대로예요.
- 남긴 것(커밋 안 함): 로그와 확인 스크립트(`tmp/t176/`)
