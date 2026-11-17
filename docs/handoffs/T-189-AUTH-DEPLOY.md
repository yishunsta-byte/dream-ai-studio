# T-189 검수된 인증 수정 배포 (Vercel)

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 · 날짜: 2026-11-17
- 결론: **운영 배포는 됐어요(4458283, Ready, Current).** 다만 T188 화면 변경이 독립 검수(T190) 전에 함께 들어갔어요. 인증 독립 PASS(T187)와 이번 배포는 서로 다른 것이에요.

## 경합 경위(숨기지 않음)
1. 지시 확인 시 HEAD는 `2d997e6`이었어요. 이 커밋을 `git archive`로 OS temp에 꺼내 검증했어요. build 0, verify-build 0, auth·postgres 관련 170 pass, tsc 0, eslint 0, 비밀 검사에 걸린 4줄은 시험용 가짜 DSN이었어요.
2. 검증하는 동안 공유 저장소에 `4458283 T188: 모바일 상단 제목과 상태 정보 공간 분리`가 커밋됐어요.
3. 저는 push 직전에 HEAD를 다시 확인하지 않고 `git push origin HEAD:master`를 실행했어요. 그래서 **검증하지 않은 4458283까지 원격에 올라갔어요**(내 실수).
4. 원격 SHA가 다른 것을 바로 발견하고 멈춘 뒤 Master에게 보고했어요(msg_38b4739dee00). 그 사이 Vercel 대기 배포를 취소하려고 확인 창까지 열었어요. Master가 A안(4458283 유지)을 고른 것을 받고 **취소하지 않고 닫았어요.**
5. 강제 push, 되돌리기, 기록 재설정은 하지 않았어요.

- 재발 방지: push 직전에 `git rev-parse HEAD`, 검증 SHA, 원격 SHA가 같은지 확인해요. 다르면 멈춰요. push도 `HEAD`가 아니라 **검증한 SHA를 직접 지정**해요(`git push origin <검증SHA>:master`).

## 4458283 재검증(격리 사본, 커밋 내용만)
| 확인 | 결과 |
|---|---|
| 2d997e6→4458283 차이 | studio-shell.tsx/.module.css, t188 시험, T188 보고서 4파일. package/lock 변화 없음 |
| 비밀 검사(값 출력 없음) | 차이분 0건 |
| `next build` + `verify-build` | exit 0. 로컬 데이터·비밀·렌더 도구 추적 없음, 화면 파일에 서비스 키 없음 |
| auth(t182·api-auth·t183)+postgres+t188 | **173 pass / 13 skip**(postgres 실DB 시험은 opt-in이라 skip) |
| `tsc`, `eslint .` | exit 0 |
| 새 pg 코드 | 앱·라우트·proxy 어디서도 import하지 않아요. 운영 Postgres 연결 없음 |

## Vercel 실제 확인(읽기)
- 배포 `E5kSuVaEr6Jkw9rLwoopFVA9aHh5`, 소스 `4458283`(master), 상태 **Ready**, **Current**, Production
- 주소: `https://dream-ai-studio-orpin.vercel.app`(외 git-master·배포별 주소)

## 운영 주소 HTTPS 읽기 전용 확인(계정·메일·비밀번호·DB 변경 없음)
| 요청 | 결과 |
|---|---|
| `GET /login` | 200, 로그인/회원가입 폼 |
| `GET /`, `GET /account/password` | 307 → `/login?next=…` |
| `GET /api/jobs`·`/api/projects`·`/api/backups` | 401 AUTH_REQUIRED, `Cache-Control: no-store` |
| 외부 출처 text/plain `POST /api/auth/login` | **403 AUTH_ORIGIN_REJECTED**, set-cookie 0, no-store |
| 출처 없는 JSON | 403 |
| 같은 출처 text/plain | 415 UNSUPPORTED_MEDIA_TYPE |
| 같은 출처 JSON(허용 밖 가짜 주소) | 400 INVALID_CREDENTIALS(출처 검사 통과, Supabase 호출 없음) |
| 외부 출처 signup·reset | 403·403 |
| 로그인 없이 logout | 401 |

- 운영 출처 일치는 `DREAM_SITE_URL=https://dream-ai-studio-orpin.vercel.app`과 Vercel 자동 주소로 맞춰져 있어요.

## 확인하지 못한 것(정직)
- 로그인한 세션이 필요한 확인(정상 로그인→로그아웃, 비밀번호 변경)은 허가된 시험 계정이 없어서 운영에서는 하지 않았어요. T186 가짜 인증 브라우저 확인과 T187 독립 재검수가 근거예요.
- T188 화면은 T190 독립 검수 전이에요. 전체 수용은 그 결과 뒤예요.
- 클라우드 작업실은 여전히 **"준비 중" 화면**이에요. 데이터·파일은 아직 Supabase에 연결되지 않았어요.
- 3013 운영본과 공유 `.next`는 다시 빌드하거나 재시작하지 않았어요.
