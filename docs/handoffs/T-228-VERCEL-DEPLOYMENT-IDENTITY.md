# T-228 운영 배포 식별·두 번째 Vercel 프로젝트 읽기 확인

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 상태: **확인 완료(읽기 전용)**
- 마지막 확인 시각: **2026-11-17T15:35:23Z (2026-11-18 00:35 +0900)**
- 방법
  - 주인님 브라우저(ego lite)에 이미 로그인된 Vercel 대시보드를 **읽기만** 했어요(새 로그인 없음).
  - 공개 주소는 로그인 없이 HTTPS로 확인했어요.
  - 설정·도메인·프로젝트·배포 변경, 재배포, 삭제, env·비밀 화면 열람은 하지 않았어요.
- 화면 사본: `tmp/t228-shots/{main,kzxq,mainDeploys,kzxqDeploys,kzxqGit,kzxqOverview}.png`

## 1. 운영 프로젝트 `dream-ai-studio`
- 배포 `3QDyZWKqj9ddY8Aw2ZXcCiyEeUEV` 상세 화면(직접 열람) 내용이에요.

| 항목 | 화면 값 |
|---|---|
| Status | **Ready**, Latest |
| Environment | **Production, Current** |
| Source | `master` **`8ffe3c7`** "P7: 세션 재확인 때 본문 상태 보존·사이드바와 작업 수 차단 (T-224)" |
| Domains | **`dream-ai-studio-orpin.vercel.app`** +1, `dream-ai-studio-git-master-yishunsta-6158.vercel.app`, `dream-ai-studio-9xhrgtrfg-yishunsta-6158.vercel.app` |
| 생성 / 빌드 시간 | yishunsta-6158, 57s |
| 요금제 표시 | Hobby |

- 배포 목록(Production 필터)
  - 8ffe3c7(T-224) Ready → **4458283(T-188) Ready**(이전 운영, 되돌리기 대상) → a278e80 → 018e983 → 9ec258e → 5b6f5fe → … → ac374c0
  - 이전 배포들이 남아 있어요.
- 화면에 "Deployment Retention is enabled"가 보여요. 오래된 배포는 정해진 기간 뒤 지워질 수 있어요.
- 운영 주소 HTTPS(로그인 없이, 같은 시각)
  - `/login` 200
  - `/`, `/cloud/projects` 307 → 로그인
  - `/api/projects`, `/api/jobs` 401
  - 외부 출처 login 403
  - 모두 no-store(T-227 결과와 같아요)

## 2. 두 번째 프로젝트 `dream-ai-studio-kzxq`
| 항목 | 화면·관측 값 |
|---|---|
| 배포 `FqNrw2VMGFLcBJzm9ETmsXwWfrmM` | **Ready, Production, Current**, Source `master` `8ffe3c7` |
| Production 주소 | `dream-ai-studio-kzxq.vercel.app` +1, `dream-ai-studio-kzxq-git-master-yishunsta-6158.vercel.app`, `dream-ai-studio-kzxq-2kmjx02u9-yishunsta-6158.vercel.app` |
| 저장소·브랜치 | Connected Git Repository **`yishunsta-byte/dream-ai-studio`**, "Connected 10h ago". master push마다 Production 배포("To update your Production Deployment, push to the master branch") |
| 배포 이력 | fde8897(T-182)부터 8ffe3c7까지 운영 프로젝트와 **같은 커밋들이 모두 Production으로 배포**됐어요 |
| 요금제 | Hobby(같은 계정) |
| 사용량(Overview 6h) | CDN Requests 9, Function Invocations 0, Error Rate 0% |
| 공개 응답(로그인 없이) | `/login`, `/`, `/cloud/projects`, `/api/projects`, `/api/jobs`, 외부 출처 login 모두 **503 no-store**. 로그인 화면 문구는 "로그인 설정이 아직 끝나지 않았어요"예요 |

- 해석(관측 범위)
  - kzxq는 같은 저장소에 **중복 연결된 두 번째 Vercel 프로젝트**예요.
  - 로그인 설정 env가 없어서 앱이 **닫힌 상태(fail closed)**로 동작해요. 공개 주소는 열려 있지만 보호 화면·API에 들어갈 수 없어요.
- 만든 사람·이유(용도)는 화면에서 알 수 없어요. 처음 연결이 T-182 무렵(약 10시간 전)이라, 첫 Vercel 연결 때 중복으로 만들어졌을 가능성이 있어요. 다만 **확인되지 않았어요.**
- env 화면은 열지 않았어요. 어떤 env가 있는지는 확인하지 않았어요(503 문구로 로그인 설정이 없다는 것만 관측했어요).

## 3. 실제 위험(관측 기반)
- **P2 중복 운영 표면**: master push마다 두 번째 공개 주소에도 운영 빌드가 올라가요.
  - 지금은 로그인 설정이 없어 503으로 닫혀 있어요.
  - 누군가 kzxq에 env를 일부만 넣으면, 검수하지 않은 두 번째 운영 주소가 열릴 수 있어요. 출처 검사도 그 주소 기준으로 바뀌어요.
  - 빌드 시간·사용량도 두 배로 들어요.
- **P3 계정 보안**: Vercel 화면에 "Enable 2FA" 권고가 떠 있어요(2단계 인증 미설정 표시).
- **P3 배포 보존 기간**: 되돌리기 대상(4458283 배포)이 보존 기간 뒤 지워질 수 있어요.

## 4. 후속 추천(사용자 결정 필요, 제가 실행하지 않음)
1. kzxq를 쓰지 않는다면 주인님이 Vercel에서 **Git 연결 해제 또는 프로젝트 삭제**를 결정해요. 쓴다면 용도와 담당을 정하고, env·도메인을 운영과 같은 검수 절차로 관리해요.
2. Vercel 계정에 2단계 인증을 켜요.
3. 되돌리기 기준 배포의 보존 기간을 확인해요.

## 미검증
- 실제 계정 로그인 뒤 운영 화면(사용자 실계정 조작 없음)
- kzxq의 env 목록, Deployment Protection 설정, 만든 이유
- 운영 프로젝트 "+1" 숨은 도메인의 정확한 이름(화면 펼치기를 누르지 않음)

## 보호
- 새 Codex 창·별도 점검 agent 없음. 3013, 공유 .next, Backend WIP 미접촉. 비밀값 조회 없음.

## 추가: kzxq 프로젝트 삭제(사용자 직접 승인, 2026-11-17T16:0xZ)
- 주인님이 이 대화에서 "너가 하면 되잖아 승인할께"라고 직접 승인했어요. Master 배정(T-228은 읽기 전용) 밖의 **사용자 결정**이에요.
- 실행
  - Vercel `dream-ai-studio-kzxq` → Settings → General → Delete Project.
  - 확인 창 문구를 먼저 읽었어요: "This will permanently delete the project and related resources like Deployments, Domains and Environment Variables… To confirm, type “dream-ai-studio-kzxq” / “delete my project”".
  - 경로가 `/dream-ai-studio-kzxq/settings`이고 확인 창 대상이 kzxq인지 코드로 검사한 뒤에만 입력·삭제했어요.
  - 화면: `tmp/t228-shots/kzxq-delete-dialog.png`, `kzxq-after-delete.png`
- 결과(2026-11-17T16:02:31Z)
  - `https://dream-ai-studio-kzxq.vercel.app` `/login`·`/`·`/api/projects` → **404 DEPLOYMENT_NOT_FOUND**
  - 프로젝트 목록에 kzxq가 없고, `dream-ai-studio`(orpin, 8ffe3c7)만 남았어요.
  - 운영 `dream-ai-studio-orpin.vercel.app`: `/login` 200, `/` 307 → 로그인, `/api/projects` 401. **변화 없음**이에요.
- 운영 프로젝트·GitHub 저장소·env·도메인(운영)은 건드리지 않았어요. 삭제는 되돌릴 수 없어요.
