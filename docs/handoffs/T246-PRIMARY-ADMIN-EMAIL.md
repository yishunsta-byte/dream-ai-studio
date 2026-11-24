# T246 대표 관리자 이메일 설정 확인

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_3c2e9b651561`
- 상태: **일부 완료 · 운영 값 확인은 권한 거절로 멈춤**
- 대표 메일은 사용자가 직접 정한 주소예요. 이 문서에는 `y***@gmail.com`으로만 적어요. 저장소가 공개라서 커밋 비밀 검사가 그 주소를 막기 때문이에요.

## 1. 코드
- 허용 판정은 그대로예요: 서버 `getUser`로 확인한 이메일이 `DREAM_ALLOWED_EMAILS`(쉼표 구분, 대소문자 무시)에 있어야 해요(`lib/auth/config.ts`).
- 주소를 코드에 박아 두는 기본값이나 우회는 만들지 않았어요. **코드 수정 없음.**

## 2. 이 PC `.env.local`
- `DREAM_ALLOWED_EMAILS` 키 1개, 항목 1개이고 그 항목이 대표 메일과 같아요. **이미 설정돼 있어서 바꾸지 않았어요.**
- 값 원문은 출력하지 않고, 포함 여부와 항목 수만 셌어요(근거: 로컬 파일을 직접 셈). 반영 상태는 이 PC 개발 실행에만 해당하고 운영과는 따로예요.

## 3. Vercel 정식 프로젝트(orpin) Production
- ego에서 설정 화면을 열어 **키 이름만** 확인했어요. `DREAM_ALLOWED_EMAILS`·`NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`DREAM_SITE_URL`이 있어요.
- 값 안에 대표 메일이 들어 있는지 보려고 했어요. 대시보드 API로 값을 열어 항목 수와 포함 여부만 세는 방식이었는데, **도구 권한 확인에서 거절됐어요.** 우회하지 않았어요.
  - 거절 주체: Claude Code 자동 승인 검토기예요. Vercel 서비스의 401/403이 아니에요.
  - 거절된 동작: Bash로 실행한 `ego-browser nodejs` 스크립트(`/api/v10/projects/.../env` 목록과 `/api/v1/.../env/<id>` 단건 열기)
  - 사유: `[Unauthorized Access]`
  - 시각: 2026-11-18 16:2x(KST)
  - 스크립트가 실행되지 않아서 요청 ID는 없어요.
- 그전 단계(설정 화면을 열고 키 이름만 읽기)는 정상 실행됐어요.
- 그래서 운영 값의 포함 여부는 **미확인**이고, 바꾸지도 않았어요. 재배포도 하지 않았어요.
- 작업 공간(66)을 닫았고 남긴 탭은 없어요. Ego54·Ego55는 쓰지 않았어요.

## 4. 남은 일(사용자 또는 Master)
1. Vercel → dream-ai-studio → Settings → Environment Variables에서 `DREAM_ALLOWED_EMAILS`(Production)를 확인해요.
2. 대표 메일이 없으면 기존 주소를 지우지 말고 쉼표로 덧붙여요.
3. 값을 바꿨다면 지금 운영 배포(`5148ebb`)를 Redeploy 해야 반영돼요. 같은 소스로 다시 빌드해요.
4. 이미 있다면 재배포는 필요 없어요.

## 5. 확인하지 못한 것
- 운영 값 포함 여부, 실제 로그인.
