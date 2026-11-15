# 진행 기록

구현 담당이 마일스톤마다 아래 형식으로 추가한다.

```
## P?-? · 제목 (날짜)
- 바꾼 파일:
- 실행 방법:
- 실제 검증 결과: (build / lint / typecheck / test 출력 요약, 완료 기준별 확인 방법과 결과)
- 남은 문제:
```

---

## P0-2 · 프로젝트 기본 설정 (2026-11-15)

- 기준: PLAN v2.2, CLAUDE.md, REVIEW R-000 확인. 이번 작업은 P0-2만 진행했다. PLAN·메뉴·디자인·검수 문서는 수정하지 않았다.
- 바꾼 파일: package.json/package-lock.json, .npmrc, .gitignore, .env.example, tsconfig.json, next-env.d.ts, next.config.ts, eslint.config.mjs, vitest.config.ts, app/layout.tsx, app/(studio)/page.tsx, lib/config/app.ts, scripts/pending.mjs, tests/bootstrap.test.ts, README.md. PLAN 4장 폴더는 .gitkeep으로 준비했다.
- 실행 방법: `npm.cmd ci` → `npm.cmd run dev` → http://127.0.0.1:3000. 운영 검수는 `npm.cmd run build` → `npm.cmd run start`. PowerShell의 npm.ps1 실행 정책 차단은 npm.cmd로 우회하며 시스템 정책은 변경하지 않았다.
- 의존성: Next 16.4.6 / React·React DOM 19.3.1 / TS 6.0.3 / ESLint 10.15.0 / Vitest 5.1.0. 직접 의존성 정확 버전 및 lockfile 고정. Next·Vitest 공식 설치 문서와 npm engines/peerDependencies 확인. TS는 typescript-eslint의 지원 범위(<6.1)에 맞춰 6.0.3 사용. Node 지원 범위는 ESLint·Vitest 공통 지원 범위로 명시했다.
- 린트 구성 결정: eslint-config-next의 React/import/a11y 플러그인은 ESLint 10을 peer 범위에 포함하지 않았다. 지원 종료 경고가 있는 ESLint 9를 고정하지 않고, ESLint 10 + @eslint/js + typescript-eslint + 공식 @next/eslint-plugin-next + react-hooks 규칙을 직접 구성했다. 최종 `npm ls --depth=0` 오류 0. JSX 접근성 규칙 확대는 디자인 부품 단계에서 검토한다.
- 실제 검증 결과:
  - `npm.cmd run build`: 종료 0, 정적 `/`와 not-found 빌드 성공.
  - `npm.cmd run lint`: 종료 0, 경고/오류 0.
  - `npm.cmd run typecheck`: 종료 0, Next 라우트 타입 생성 + strict tsc 성공.
  - `npm.cmd test`: 종료 0, 1파일·3테스트 통과. worker/db:migrate/db:seed가 미구현을 명시하고 종료 1을 반환하는지 실제 자식 프로세스로 확인.
  - `npm.cmd run start`: 실행 성공. Get-NetTCPConnection으로 127.0.0.1:3000 리스닝 확인.
  - `npm.cmd run dev`: 실행 성공. 운영 검증 서버가 3000을 사용 중이어서 자동 선택된 127.0.0.1:3001에서 HTTP 200 확인. 검증 후 두 서버 종료. Next가 생성한 AGENTS.md도 확인했으며 후속 코딩 시 로컬 Next 문서 참조 지침을 따른다.
  - ego-browser로 임시 첫 화면 제목·한국어 문구·lang=ko 확인. 1280px과 390px 각각 scrollWidth=innerWidth 확인 및 스크린샷 육안 확인. 스크린샷: tmp/p0-browser-20261115/1280.png, 390.png (git 제외). 제품 시안 검수는 후속 단계.
  - `npm.cmd audit --omit=dev`: 취약점 0. 전체 감사는 개발 의존성 typescript-eslint→minimatch 관련 중간 등급 7건. 자동 수정이 해결하지 못하며 major 강제 변경은 하지 않았다. 이 항목은 플래너 확인 대상으로 남긴다.
- 현재 제한: DB·워커는 후속 단계이며 명령은 안내 후 종료 1. dev:all은 워커 미구현으로 두 프로세스를 종료하므로 현재는 dev 사용. 디자인·글꼴·메뉴 화면·도메인 규칙·저장 기능은 미구현. Git 저장소가 아직 없어 커밋하지 않았다.
- 인계: P0-2 검수 요청. P0-3 및 P0-4/5는 시작하지 않았다. 플래너는 위 검사 명령과 README로 재현 가능. 기존 HANDOFF의 특정 검수 에이전트 명칭보다 PLAN v2.2의 플래너/코더 역할 구분을 적용했다.

### R-001 후속 · F-001 처리 진행

- 플래너의 P0-2 통과 및 F-001(첫 커밋 후 P0-3 진행) 확인.
- `git init` 완료. `.gitignore`의 data/storage/backups/tmp를 루트 기준으로 수정하여 `lib/storage` 소스 폴더가 잘못 제외되던 문제 해결.
- staging 목록에 tmp·tsbuildinfo·실데이터·비밀값이 포함되지 않은 것을 확인.
- `git commit -m 'P0-2: 프로젝트 기본 설정'` 시 Git 작성자 정보 미설정으로 실패. 사용자에게 이 저장소에 사용할 이름·이메일을 요청한 상태. 전역 설정은 변경하지 않았다. 첫 커밋 전이므로 P0-3은 아직 시작하지 않음.
- (플래너 대행, 2026-11-15) 은영님이 작성자 정보를 주어 **이 저장소에만**(`git config --local`) 설정하고 첫 커밋 `220bb3d P0-2: 프로젝트 기본 설정` 생성. 전역 설정 변경 없음, 원격 없음·푸시 안 함. 커밋 전 확인: 47개 파일, `.env`·data·tmp·tsbuildinfo·키 형태 문자열 없음. P0-1 디자인 문서와 PLAN v2.3도 함께 포함. **F-001 처리됨 → 구현 담당은 P0-3 진행 가능.** 확인 판정은 검수 담당(Codex).
