# T264 승인된 보호 스테이징 후보 식별

2026-11-18 KST · Codex(Front)(term_a0a6f98c) · 배정 `msg_e3992c4f0f82` · 수락 `msg_67276b4ecb82`
기준 `cbf9b3c`, [T261 체크리스트](T261-MANAGED-PG17-STAGING-CHECKLIST.md) 1·6단계, [T262 설계](T262-PREVIEW-RUNTIME-TLS-PREFLIGHT.md)·[T262-R](T262-R-PREVIEW-RUNTIME-TLS-PREFLIGHT-REVIEW.md), MASTER_DEVELOPMENT_PLAN 개발 착수 순서 1단계.

**판정: 미확인. 승인된 별도 Supabase 스테이징도, 그 대상만 바라보는 보호 Vercel Preview도 기록에 없어요.**
저장소 기록과 로컬 메타데이터에서 식별되는 대상은 모두 **운영(Production)**이에요. 그래서 스테이징 후보로 쓸 수 없어요. 아래에 실제로 확인된 식별자, 확인되지 않은 항목, 각 항목에 필요한 정보와 담당을 정리했어요.

## 조사 범위와 방법
- 읽은 것
  - 추적 문서: `docs/handoffs`의 배포·환경 기록, `docs/TEAM.md`, `docs/MASTER_DEVELOPMENT_PLAN.md`, `docs/QUESTIONS.md`
  - 로컬 git 메타데이터: `git remote`, 마지막 fetch의 `origin/master`
  - 작업 폴더의 도구·설정 파일 존재 여부
- 하지 않은 것
  - 외부 계정·대시보드·API 조회. Vercel·Supabase·GitHub를 열지 않았고 `gh`도 쓰지 않았어요.
  - 프로덕션 조회. 이전에 거절된 Vercel env 값 읽기와 Supabase 사용자 상태 조회도 재시도하거나 우회하지 않았어요.
  - `.env.local` 등 비밀 파일 열람. 존재만 확인했어요.
  - 외부 쓰기·배포·자원 생성
- 이 보고서에는 비밀 값, 환경 값 원문, Supabase 프로젝트 ref 원문을 적지 않았어요. 배포 ID와 공개 운영 주소는 기존 추적 문서에 이미 있는 값이에요.

## 1. 승인 근거
| 항목 | 기록 | 판단 |
|---|---|---|
| 별도 스테이징 생성·지정 승인 | 없음. [T261](T261-MANAGED-PG17-STAGING-CHECKLIST.md) §사용자 결정: "기존 승인 시험 대상이 없을 때만 사용자가 환경 선택을 결정"(비용·자원 생성 범위 포함). TEAM.md B7 배정: "기존 Auth ref를 staging으로 재분류하지 않음". | **승인 근거 없음.** 기존 운영 대상을 스테이징으로 재분류하는 것도 금지돼 있어요. |
| 보호 Preview 사용 계획 | [T-179](T-179-VERCEL-SUPABASE-PLAN.md) V1: 로그인 단계까지 "보호 켠 미리보기만"(계획). MASTER 계획 C9 "보호 preview와 정식 주소". | 계획만 있어요. 실제 보호 Preview를 만들거나 승인한 기록은 없어요. |
| 운영 SSL | `DEC-SSL-01` 미결 유지(T256, T261, MASTER 계획) | 스테이징 식별과 별개예요. 재요청하지 않았어요. |

## 2. Supabase 프로젝트·환경 식별
| 항목 | 기록상 값 | 근거 | 판단 |
|---|---|---|---|
| 프로젝트 | `dream-ai-studio` 1개(공개 ref는 TEAM.md·B5·B6·B10·B11에 기록) | [B7](B7-MANAGED-ENVIRONMENT-CHECK.md) §Supabase, [B10](B10-MANAGED-SSL-ENVIRONMENT.md) | 기존 실운영 Auth 대상이에요. |
| 환경 표시 | 대시보드 헤더 **main / PRODUCTION**, STAGING 배지 없음 | B10 §Environment/branch | **운영.** 스테이징 아님 |
| 다른 프로젝트·브랜치 | 기록 없음. B7: "That history does not establish a separate staging database." | B7 §19행 | **미확인** |
| 조직 권한(Owner/Admin) | 라벨 확인 안 됨 | B10 §Platform account role | 미확인 |

## 3. Vercel 프로젝트·환경·배포 식별
| 항목 | 기록상 값 | 근거 | 판단 |
|---|---|---|---|
| 프로젝트 | `dream-ai-studio`(Hobby), GitHub `master` 연결, **master push마다 Production 배포** | [T-183](T-183-VERCEL-FIRST-DEPLOY.md), [T-228](T-228-VERCEL-DEPLOYMENT-IDENTITY.md) | 운영 프로젝트 |
| 두 번째 프로젝트 | `dream-ai-studio-kzxq` → 사용자 직접 승인으로 **삭제**(Master 404 확인) | T-228 §추가, [T-238](T-238-EXACT-SHA-DEPLOY-PREP.md) | 후보 없음 |
| Production 배포 이력 | `E5kSuVaEr6Jkw9rLwoopFVA9aHh5`(소스 4458283, T-189) → `3QDyZWKqj9ddY8Aw2ZXcCiyEeUEV`(소스 8ffe3c7, T-227/T-228) → 이후 운영 Current 소스 `5148ebb8a5492ead4037afda76692212a1ed4c2d`(T248의 ls-remote 기록) | T-189, T-227, T-228, T248 | 모두 **Production**. 5148ebb의 배포 ID는 추적 문서에 없어요. |
| 운영 주소 | `https://dream-ai-studio-orpin.vercel.app` | T-183, T-228 | 운영 |
| 환경변수 적용 범위 | 인증 env 4종을 **Production·Preview 둘 다**에 같은 값으로 넣음 | T-183 9행 | 이 설정 그대로면 Preview가 생겨도 **운영 Supabase**를 바라봐요. 그래서 별도 매핑이 아니에요. Preview 전용으로 값을 덮어쓴 기록은 없어요. |
| **Preview 배포 ID·SHA** | **기록 없음** | 전체 handoffs 검색: Preview 배포 ID 0건 | **미확인** |
| Node 런타임·리전·정확한 HTTPS origin(Preview) | 기록 없음 | — | 미확인 |

## 4. 같은 배포의 접근 보호·해제
| 항목 | 기록 | 판단 |
|---|---|---|
| Deployment Protection 설정(Preview) | 운영 프로젝트의 Deployment Protection 값을 열람·기록한 문서 없음. T-228은 kzxq의 보호 설정을 "미확인"으로 남겼어요. | **미확인** |
| 특정 배포에만 시험자 접근을 허용하고 회수하는 수단 | 기록 없음. 예: 보호 우회 토큰, 공유 링크, 계정 초대. 이 수단은 플랜에 따라 지원 범위가 달라요. Hobby에서 가능한 범위는 확인하지 않았어요. | **미확인** |
| 앱 내부 보호 | `/admin`·보호 API의 서버 인증, 허용 목록, origin 검사는 코드로 확인돼요(T-189, T-245-R, T262). | 앱 경계는 있어요. 다만 이것은 **배포 접근 보호**와 다른 층이에요. |

## 5. 비공개 1회 TLS 점검 수단
| 항목 | 기록 | 판단 |
|---|---|---|
| 같은 Preview Node 런타임의 승인된 비공개 서버 호출 수단 | T262: "현재 기록에는 그런 실행 수단…이 확인되지 않았다". T262-R도 같은 결론이에요. | **미확인** |
| 배포 전체가 공유하는 일회성 승인 저장소(run ID 원자 소비) | 같음 | **미확인**(없음) |
| 런타임에서 배포 ID·SHA·리전을 신뢰 가능하게 얻는 경로 | T262-R: 배포 담당이 원장과 런타임 서버 측 값을 대조해야 함. 실측 기록 없음 | 미확인 |

## 6. 로컬 메타데이터
- `.vercel/` 없음. Supabase CLI 설정(`supabase/config.toml`) 없음. Vercel·Supabase CLI 미설치. GitHub CLI만 있어요(이번에 사용하지 않음).
- `.env.local`은 있지만 비밀 파일이라 열지 않았어요. T-183 기준으로 이 파일 값은 운영 env의 출처예요.
- git `origin`은 GitHub 저장소 1개예요. 마지막 fetch 기준 `origin/master` = `5148ebb`예요.
- 결론적으로 로컬에는 스테이징·Preview 대상을 가리키는 메타데이터가 없어요.

## 필요한 식별 정보와 담당(미확인 항목)
| # | 필요한 것 | 담당 |
|---|---|---|
| 1 | 별도 스테이징을 쓸지, 새로 만들지(비용·자원 범위 포함) 결정. 기존 승인 대상이 없다는 위 판정의 수용 | **Master 판정 → 사용자 결정**(T261 규칙) |
| 2 | 스테이징 Supabase의 조직·프로젝트 이름·공개 ref·리전·PG major·Connect 접속 프로필(Direct/Session), 운영과 다른 대상이라는 대시보드 표시 | 플랫폼 담당(대시보드 접근 권한을 가진 사용자 계정 또는 지정 담당). 비밀 값은 지정 비밀 담당만 |
| 3 | Vercel 쪽 구조 결정: 같은 프로젝트의 Preview 범위에 스테이징 값만 덮어쓸지(Production 값과 분리), 별도 프로젝트를 둘지. Preview를 만드는 브랜치나 방식 | Master + Front/배포 담당. 설정 변경과 push는 사용자 승인 경로 |
| 4 | 시험 Preview의 **배포 ID·정확한 소스 SHA·Ready·Node 런타임·리전·정확한 HTTPS origin**, Preview 범위 env가 스테이징을 가리키는지(값 원문 없이 대상 일치 여부만) | Front/배포 담당. 대시보드 메타데이터 읽기는 T-228과 같은 방식이고, env 값 읽기는 이전 거절 범위라 하지 않아요 |
| 5 | 그 배포의 Deployment Protection 방식, 시험 담당에게만 접근을 열고 회수하는 방법(플랜 지원 범위 포함) | Front/플랫폼 확인 → 사용자(설정 권한) |
| 6 | 비공개 1회 TLS 점검 실행 수단과 원자적 일회성 승인 저장소 | Backend(T262 설계), Master 판정 |

## 범위
이 문서 하나만 추가했어요. 제품 코드·설정, 공유 문서, 다른 보고서는 바꾸지 않았어요. 외부 조회·쓰기·배포·자원 생성·새 창/에이전트/worktree는 없어요.

Master 전달문 — T264 확인 완료. 기록과 로컬 메타데이터에서 확인되는 Supabase(`dream-ai-studio`, main/PRODUCTION)와 Vercel(`dream-ai-studio`, master→Production, 배포 E5k…/3QDy…, 현재 소스 5148ebb)은 모두 운영이에요. Preview 배포 ID·SHA, 스테이징 매핑, Deployment Protection, 비공개 1회 TLS 수단의 기록은 0건이에요. 인증 env가 Production·Preview에 같은 값으로 들어가 있어 Preview도 운영 Auth를 바라봐요. 필요한 식별 정보 6항목과 담당을 정리했어요.
