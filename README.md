# Dream AI Studio

현재 마일스톤: **P0-2 프로젝트 기본 설정**. 제품 디자인과 메뉴·저장·생성 기능은 후속 단계입니다. 첫 화면은 실행 확인용 임시 문구입니다.

## 실행

Node.js 22.13 이상인 22.x 또는 24 이상과 npm 10 이상이 필요합니다. 현재 PC의 Node 26에서 검증했습니다. ESLint와 Vitest의 공통 지원 범위에 맞췄습니다.

```powershell
npm.cmd ci
npm.cmd run dev
```

브라우저에서 http://127.0.0.1:3000 을 엽니다. 웹 서버는 개발·운영 모두 127.0.0.1에만 바인딩합니다. PowerShell 실행 정책이 npm.ps1을 차단하면 위처럼 `npm.cmd`를 사용합니다. 다른 셸에서는 `npm`을 사용할 수 있습니다.

```powershell
npm.cmd run build
npm.cmd run start
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
```

| 명령 | 현재 동작 |
|---|---|
| dev / build / start | 웹 개발 / 빌드 / 운영 실행 |
| lint / typecheck / test | ESLint / Next 타입 생성과 TS strict / Vitest 단발 실행 |
| test:watch | 테스트 감시 |
| worker | P1-6에서 구현 예정, 현재 안내 후 종료 코드 1 |
| db:migrate / db:seed | P1-1에서 구현 예정, 현재 안내 후 종료 코드 1; 데이터 변경 없음 |
| dev:all | 웹·워커 동시 실행; 현재 워커 미구현으로 둘 다 종료 |

`dev:all`은 워커 도입 전까지 개발 서버 실행에 사용하지 않습니다. 현재 DB 초기화나 가짜 데이터 입력은 실행되지 않습니다. API 키나 환경변수는 필요 없습니다. 향후 비밀값은 `.env.local`에만 저장합니다.

## 구조와 협업

`app`은 화면, `components`는 공통 UI, `lib/services`는 업무 로직, `lib/domain`은 순수 규칙, `lib/repo`와 `lib/db`는 DB 접근을 맡습니다. 작업·AI·저장소 모듈은 각각 `lib/jobs`, `lib/providers`, `lib/storage`로 분리합니다. DB·파일·비밀을 다루는 구현에는 `server-only` 경계를 적용합니다. 폴더의 `.gitkeep`은 이후 단계의 자리이며 구현 완료를 의미하지 않습니다.

최상위 기준은 [PLAN](docs/PLAN.md), 구현 규칙은 [CLAUDE.md](CLAUDE.md), 실제 검증 기록은 [PROGRESS](docs/PROGRESS.md), 플래너 검수는 [REVIEW](docs/REVIEW.md)입니다. 제품 디자인은 플래너의 `docs/design/` 산출물을 따른 다음 단계에서 적용합니다.

의존성은 정확한 버전과 package-lock.json으로 고정합니다. npm 공식 레지스트리의 engines/peerDependencies와 [Next 설치 문서](https://nextjs.org/docs/app/getting-started/installation), [Vitest 문서](https://vitest.dev/guide/)를 확인했습니다. SQLite/Drizzle은 P1-1에서 도입하며 현재 설치하지 않습니다.
