# T-183 Vercel 첫 배포와 클라우드 준비 화면

- 담당: Codex(Front)(터미널 term_a0a6f98c) · 지휘: 주인님 직접("내가 지휘할테니까 링크 띄워줘", "진행해")
- 상태: 자체 검수(독립 검수 아님)

## 배포 상태
- Vercel 프로젝트 `dream-ai-studio`(Hobby)가 GitHub `master`와 연결돼 **올릴 때마다 운영 배포**돼요. 운영 주소 `https://dream-ai-studio-orpin.vercel.app`.
- 기록상 ac374c0(T-181)부터 배포가 있었어요. **그 시점 코드에는 로그인이 없었어요.** 6ccb130(T-182)부터 Vercel에서는 항상 로그인 모드라, 설정 전에는 모든 화면·API가 503으로 막혔어요(직접 확인).
- 환경변수(Production·Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DREAM_ALLOWED_EMAILS`, `DREAM_SITE_URL`. 값은 이 PC `.env.local`에서 브라우저로 붙여 넣었고 화면·로그에 출력하지 않았어요. **서비스 키는 넣지 않았어요**(앱이 아직 안 씀).
- Supabase: Site URL을 Vercel 주소로, Redirect URL에 `https://dream-ai-studio-orpin.vercel.app/auth/callback**` 추가(시험용 127.0.0.1:43182 유지).
- 다시 배포 뒤: `/login` 200, `/`·`/settings` → 307 `/login?next=…`, `/api/jobs` 401.

## 발견한 문제와 수정
- Vercel은 서버에 파일을 저장할 수 없어서 **루트 레이아웃의 저장 폴더 점검이 실패**하고, 로그인 화면 대신 "시작 점검" 실패 화면이 나왔어요.
- 수정
  - `app/layout.tsx`: 저장 폴더 점검을 뺐어요(메뉴 설정 점검은 그대로).
  - `components/studio-layout.tsx`: 작업실 화면에서 점검해요. 이 PC에서는 지금처럼 시작 점검 화면, **Vercel에서는 "클라우드 작업실을 준비하고 있어요"** 안내와 계정·로그아웃.
  - `components/auth/cloud-pending.tsx`(새), `login.module.css`
- `/tmp` 같은 임시 폴더로 저장을 우회하지 않았어요. 저장한 내용이 예고 없이 사라지면 "실패를 완료로 표시 금지" 규칙에 어긋나서예요.

## 확인
| 확인 | 결과 |
|---|---|
| `t183-cloud-pending` | 4/4 통과(루트에 점검 없음, PC 실패=시작 점검·작업 화면 안 열림, Vercel=준비 중+계정·로그아웃, 로그인 정보 없음=안내만) |
| 전체 시험 | 754 통과·23 skip |
| `tsc`, `eslint`(바꾼 파일) | exit 0 |
| 운영 빌드 | Vercel 배포 빌드로 확인(아래 회신에 결과 기록). 이 PC의 안전 사본 빌드는 이번에 하지 않았어요 |

## 남은 것
- Vercel에서 실제 작업은 데이터·파일 이전(V2·V3, 백엔드) 뒤에 열려요.
- API별 2차 로그인 확인(백엔드), 메일 문구 한글화, 실제 메일 수신 확인(주인님).
- 3013(이 PC 운영본)은 이 변경을 다시 빌드하기 전까지 예전 코드 그대로예요.
