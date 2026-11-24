# 로컬 PG 렌더 자식과 Next 운영 빌드 분리

수정 커밋 `3d55ebd`. `cd454b6`의 D 드라이브 격리 사본에서 운영 빌드를 재현했다. Turbopack이 실행 라우트에서 네이티브 `fork(script)`의 자식 스크립트를 모듈로 해석하면서 `Can't resolve <dynamic>` 오류가 났다. Node 런타임 호출로 바꾸면 컴파일됐지만, 운영 라우트가 실행 모듈을 계속 불러오면 `verify-build`는 `render/child.ts`와 `render/entry.tsx`의 추적 두 건을 검출했다.

`lib/render/run.ts`에서 Node 런타임이 체크아웃의 자식 TypeScript 파일을 실행하도록 했다. `app/api/projects/[id]/renders/[jobId]/execute/route.ts`는 운영에서 기존 로컬 전용 차단을 먼저 적용한다. 개발에서 로컬 기능을 사용할 때 실행 모듈을 불러온다.

## 검증

- D 드라이브 `D:/starwork/p2-build-pg-render-fork` 고정 사본에 물리 `node_modules`를 두고 `npm.cmd run build`를 실행했다. 기본 Turbopack 빌드와 기존 `scripts/verify-build.mjs`가 통과했다. 서버 파일 추적 목록 76개에서 운영 렌더 금지 항목 0건이었다. 로그는 `repro-build-physical.log`, `candidate-build.log`, `guarded-build.log`에 있다.
- 같은 결과를 `npm.cmd start`로 루프백에 띄웠다. 두 로컬 기능 플래그를 켠 상태에서 실행 GET·POST가 모두 503 `RENDER_EXECUTION_UNAVAILABLE`, `private, no-store`를 반환했다. 시험 리스너를 종료했다.
- 별도 격리 Next **개발 Turbopack**·PG17.12로 실제 소유 프로젝트를 승인해 한글 두 줄·잠긴 광고 표기·PNG 두 장·WAV를 90프레임 MP4로 다운로드했다. 71,614바이트 SHA-256이 `c86f5e51dc67f554129518ecbcc537f010c5e4b496ee18e63c46cb58597a1930`으로 수정 전 개발 증거와 같았다. 글자가 없는 PNG/WAV 경로도 통과했다. 렌더 중 요청 중단 뒤 `RENDER_CANCELED`, 임대·임시 폴더 정리 및 출력 0건을 확인했고, 같은 작업 재시도에서 완료 결과 한 건을 받았다. `D:/starwork/p2-pg-first-work-e2e/first-work-caption-turbo-fixed.log`.
- `npm.cmd run typecheck`와 변경 경로 ESLint, 인증·렌더·파일 추적 시험 5파일 207건을 통과했다.

> `3d55ebd`의 로컬 운영 빌드와 파일 추적 검증을 통과했습니다. 운영 서버는 로컬 실행·다운로드를 503으로 차단합니다. 개발 Turbopack에서는 실제 PG17 한글·광고 표기 MP4와 자식 프로세스 취소·재실행을 확인했습니다.
