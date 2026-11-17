# T-227 정확한 SHA Vercel 배포

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01(T-225 PASS 뒤 실행 지시) · 상태: **배포 완료·운영 읽기 확인 PASS**
- 배포 소스: **`8ffe3c75b5eaa908ee000f574cf688dd65125378`** (이전 운영 `44582839c1339b5a39620b0d0249681cde372450`)
- 마지막 확인 시각: **2026-11-17T15:32:56Z (2026-11-18 00:32 +0900)**

## 경위
1. 사전 확인을 했어요. 후보 commit 존재, `origin/master`=4458283(운영과 같음), fast-forward 가능, 내 staged 0 모두 통과했어요.
2. 제 세션의 `git push origin 8ffe3c75…:refs/heads/master`는 Claude Code 자동 권한 판정("Destructive or Unwanted Actions")에 **실행 전 거절**됐어요.
   - 거절 직후 원격은 4458283 그대로였어요. 재시도·우회·권한 설정 수정은 하지 않았어요(커밋 `04d3247` 기록).
3. **주인님이 직접** 터미널 `!`로 같은 정확한 SHA를 push했어요. 출력은 `4458283..8ffe3c7  8ffe3c75… -> master`였어요(fast-forward, force 아님).

## 원격·Vercel 확인(읽기)
| 확인 | 결과 |
|---|---|
| `git ls-remote origin refs/heads/master` | `8ffe3c75b5eaa908ee000f574cf688dd65125378` |
| GitHub commit status (8ffe3c7) | 종합 **success** |
| `Vercel – dream-ai-studio` | success "Deployment has completed", 배포 `3QDyZWKqj9ddY8Aw2ZXcCiyEeUEV`, 완료 2026-11-17T15:31:25Z |
| `Vercel – dream-ai-studio-kzxq`(같은 저장소에 연결된 두 번째 Vercel 프로젝트) | success, 배포 `FqNrw2VMGFLcBJzm9ETmsXwWfrmM`, 완료 15:32:23Z |
| 운영 주소가 새 빌드를 내보내는지 | `/login`이 불러오는 파일 `_next/static/immutable/chunks/2uojgh0jq62-_.js`에 새 세션 신호 이름 `dream-auth-session`이 있어요. 이 코드(`lib/auth/session-sync.ts`)는 이전 운영 4458283에 **없었어요**. 따라서 운영 주소는 8ffe3c7 빌드를 내보내고 있어요 |
| 이전 운영 배포 `E5kSuVaEr6Jkw9rLwoopFVA9aHh5` | 지우거나 바꾸지 않았어요(되돌리기 대상으로 남아 있어요) |

- Vercel 대시보드의 "Current" 표시는 직접 열어 보지 않았어요(CLI 없음, 대시보드 미열람). 운영 주소가 새 빌드를 내보내는 것으로 대신 확인했어요.
- 두 번째 프로젝트(`dream-ai-studio-kzxq`)도 같은 push로 배포됐어요. 그 주소와 용도는 확인하지 않았어요. Master 확인이 필요해요.

## 운영 주소 HTTPS 읽기 확인(`https://dream-ai-studio-orpin.vercel.app`, 로그인 없이)
| 요청 | 결과 |
|---|---|
| `GET /login` | **200**, `private, no-cache, no-store` |
| `GET /`, `/cloud/projects`, `/cloud/projects/new`, `/cloud/projects/{uuid}`, `/account/password`, `/jobs` | 모두 **307** → `/login?next=<원래 경로>`, `no-store` |
| `GET /api/projects`, `/api/projects/{uuid}`, `/api/jobs`, `/api/backups` | 모두 **401** "로그인이 필요해요", `no-store` |
| 같은 출처 `POST /api/auth/session`(새 API) | **401**, `no-store` |
| 외부 출처 text/plain `POST /api/auth/login` | **403**, `no-store`, set-cookie 0 |
| 로그인 없이 `POST /api/auth/logout` | **401**, `no-store` |

- critical 인증 공개·거절이 그대로라서 되돌리기를 하지 않았어요.

## 예상 운영 동작(로그인 후, 실제 계정으로는 확인 안 함)
- 기존 작업실 주소는 클라우드 **"준비 중"(CloudPending)** 화면이에요.
- `/cloud/projects`·상세는 읽기 backend가 꺼져 있어서 **"지금은 불러올 수 없어요"** 안내예요. DB에 연결하지 않아요.
- `/cloud/projects/new`는 **준비 안내만** 보여요(폼·쓰기 없음).
- 다른 탭 계정 변경 때 계정 표시·본문·사이드바를 가리고 다시 확인해요(T-213/T-220/T-224, T-225 PASS).
- 디자인(T-208 3안)은 적용하지 않았어요.

## 미검증 범위
- 실제 계정 로그인 뒤 화면(허가된 시험 계정 없음)
- Vercel 대시보드 Current 표시 직접 열람
- 두 번째 Vercel 프로젝트 `dream-ai-studio-kzxq`의 주소와 동작

## 보호
- 실제 계정·비밀번호·메일·DB·env·SSL·Storage·create opt-in 변경 없음, 비밀값 조회 없음
- 공유 .next, 3013, Backend B16 문서 WIP 미접촉
