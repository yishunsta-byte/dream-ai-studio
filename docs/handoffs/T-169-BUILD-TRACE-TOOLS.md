# T-169 운영 빌드에 실행 도구 추적 제외 (F168-1 수정)

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_555310f6c7a6 · 근거: `T-168-AUDIO-EXPORT-UI-REVIEW.md` F168-1
- 기준 `7b50c71` + 이 변경이에요. 자체 수정·자체 확인이고 **독립 재검수 전**이에요.
- 바꾼 파일
  - `next.config.ts`
  - `lib/media/tools.ts`(도구 경로를 찾는 방식)
  - `scripts/verify-build.mjs`
  - 새 `tests/t169-build-tracing.test.ts`
- 바꾸지 않은 것: UI, 서비스, DB, migration, 자료, 발행 fixture, 패키지, 설치 도구(`.tools`)
- 작업트리의 `next-env.d.ts` 변경(`.next/dev/types`)은 다른 세션의 개발 서버가 만든 것이라 stage하지 않았어요.

## 1. 원인 (실제 재현과 Next 설치본 코드로 확인)
- Next **16.4.6**이에요. 설치본 문서 `output.md`에 따르면 `outputFileTracingExcludes` 값은 "프로젝트 루트 기준 glob"이에요.
- **Webpack 빌드(Windows)**
  - `next/dist/build/collect-build-traces.js` 470~540행: 제외 glob을 `path.join(dir, exclude)`로 만든 뒤 picomatch로 비교해요.
  - Windows에서는 `path.join`이 `\`로 바꿔요. 그런데 picomatch는 `\`를 escape 문자로 읽어서 **어떤 제외 규칙도 맞지 않아요.**
  - Next의 picomatch로 직접 확인했어요(`tmp/t169/pm.cjs`). `\` 패턴은 false, `/` 패턴은 true였어요.
  - webpack 추적 단계(`next-trace-entrypoints-plugin`)의 `traceIgnores`는 설정으로 바꿀 수 없는 빈 목록이에요.
  - 결론: **이 환경의 Webpack에서는 config의 제외 규칙이 효과가 없어요.**
- 추적이 생긴 이유
  - `lib/media/tools.ts`가 `existsSync(join(process.cwd(),".tools/ffmpeg",`${name}…exe`))`를 썼어요.
  - nft가 이 경로를 정적으로 계산해서 실제 ffmpeg.exe와 ffprobe.exe를 서버 추적에 넣었어요.
  - 그래서 물리 도구가 있는 사본에서만 실패했어요. 그전 빌드 사본들은 git 추적 파일만 복사해서 `.tools`가 없었어요.
- **Turbopack 빌드(기본 `next build`)**
  - 제외 규칙이 동작해서, 데이터 폴더가 프로젝트 안에 있으면 수정 전에도 통과했어요.
  - 다만 **`DREAM_DATA_ROOT`가 프로젝트 밖이면 빌드 자체가 실패했어요.** 메시지는 `glob '../…/data/**/*' is invalid, it has a prefix that navigates out of the project root`예요. config가 바깥 경로 glob을 만들었기 때문이에요.

## 2. 수정
- `lib/media/tools.ts`
  - 도구 폴더를 앱 루트(`resolve(process.cwd())`)에서 **실행할 때** `mediaToolsFolder()`로 계산해요. 빌드 때 상수로 정하지 않아요.
  - 찾는 순서는 그대로예요: 환경 변수(`FFMPEG_PATH`/`FFPROBE_PATH`) → 앱 `.tools/ffmpeg`의 실제 파일 → PATH 이름
  - 실행 파일 이름은 숨기지 않았어요. 서버 묶음에 도구를 넣지 않는 것만 바뀌었어요. 도구는 로컬 worker나 child process가 이 PC의 `.tools`에서 실행해요(기존 분리 그대로).
- `next.config.ts`
  - 프로젝트 기준 기본 제외는 그대로예요(Turbopack에서 계속 동작).
  - 데이터 폴더가 프로젝트 **안**이면 그 폴더의 항목만 더하고, **밖**이면 더하지 않아요.
  - 밖에 있는 파일은 두 추적기 모두 tracing root 밖이라 넣지 않아요. verify-build가 데이터 폴더를 따로 검사해요.
- `scripts/verify-build.mjs`: 기존 검사보다 같거나 더 엄격해요.
  - 새 `toolTrace`: 앱이나 데이터 폴더의 `.tools` 아래 파일, 또는 **어디에 있든** `ffmpeg`/`ffprobe`(`.exe`) 실행 파일을 거절해요. 링크를 따라간 실제 경로에도 적용해요.
  - 실행 도구용 문구를 따로 두었어요: "이 PC의 실행 도구(.tools·ffmpeg·ffprobe)가 포함되어 중단했어요."
  - 기존 데이터·비밀(`privateTrace`) 검사와 렌더 도구(`renderTrace`) 검사, 그 문구는 그대로예요. 둘이 함께 걸리면 데이터·비밀 문구가 먼저 나와요.
  - 실패하면 위반을 **모두** stderr에 적어요: `추적 위반 N건 (파일 목록 M개)`, 그리고 `종류 / trace / <app>·<data> 상대 경로`. PC 절대 경로는 쓰지 않아요.
  - 검사를 끄거나 허용 목록을 두지 않았어요.

## 3. 재현·검증
**환경**
- `git archive HEAD`를 OS 임시 폴더에 풀었어요.
- node_modules는 robocopy로 실제 복사했어요(junction 아님).
- `.tools/ffmpeg/ffmpeg.exe`와 `ffprobe.exe`는 **물리 복사**했어요. sha가 설치본과 같아요: `3256173f…`, `f0d36ecb…`
- 외부 `DREAM_DATA_ROOT`는 별도 임시 폴더예요.
- 사용자의 3013 서버와 공유 `.next`는 쓰지 않았어요.

| 경우 | 수정 전 | 수정 후 |
|---|---|---|
| Webpack · 외부 데이터 | build 0 / **verify 1**. trace 37개, 항목 6942개, **위반 40건 / 파일 목록 20개**, 대상 `.tools/ffmpeg/ffmpeg.exe`·`ffprobe.exe`(F168-1과 같아요) | build 0 / verify 0. 항목 6902개, 위반 0 |
| Turbopack · 외부 데이터 | **build 1**(바깥 경로 glob 오류) | build 0 / verify 0. 항목 7692개, 위반 0 |
| Turbopack · 데이터=앱 | build 0 / verify 0(7692) | build 0 / verify 0(7692) |
| Webpack · 데이터=앱 | (수정 전 = 위 Webpack 실패와 같은 원인) | build 0 / verify 0(6902) |
| Webpack · 앱 안 하위 데이터 폴더(가짜 db·storage·`.env.local`·`.tools/ffprobe.exe` 포함) | — | build 0 / verify 0 |
| Turbopack · 같은 하위 폴더 | — | build 0 / verify 0 |

- **수정 전후 Webpack 추적 목록 전체 비교**(외부 데이터, 같은 사본, 정렬한 `trace -> 파일` 줄): 빠진 줄은 40개이고 모두 `.tools/ffmpeg/ffmpeg.exe`·`ffprobe.exe`예요. 새로 생긴 줄은 0개예요. **도구 말고는 바뀐 추적이 없어요.**
- **필요한 런타임 파일은 그대로 있어요**: migration SQL(0010 포함), `docs/spec/menus.json`, `config/providers.json`, 글꼴·OFL. Webpack과 Turbopack 모두 확인했어요.
  - `better_sqlite3.node`는 수정 전후 모두 trace 목록에 없어요(빌더가 패키지를 외부로 처리해요). 기존과 같고 이번 변경과는 관계없어요.
- 수정 전 Webpack 결과를 새 verify 스크립트로 다시 돌리면 `추적 위반 40건 (파일 목록 20개)`와 위반 목록 뒤에 "이 PC의 실행 도구" 오류로 실패해요.
- **시험**
  - 새 `tests/t169-build-tracing.test.ts`(5개)
    - 앱·데이터 `.tools`, 패키지 안 `ffprobe` 거절, 위반 목록·건수, 목록에 절대 경로 없음
    - 링크 별명과 이름만 바꾼 복사본 거절, 비슷한 이름의 일반 코드(`ffmpeg-helpers/index.js` 등) 통과
    - 데이터+도구가 같이 있으면 데이터 문구가 먼저, 렌더 문구는 그대로
    - config가 바깥 폴더면 `..`나 드라이브 glob을 만들지 않고, 안이면 하위 폴더 항목을 더함
    - 도구 위치 순서(환경 변수 → 앱 `.tools` 실제 파일 → PATH)
  - 기존 `build-tracing.test.ts` 4개는 그대로 통과해요.
  - `eslint .` exit 0, `tsc --noEmit --incremental false` exit 0, vitest 전체 **66파일 통과·2 skip, 709 통과·19 skip**
- **원본 SHA-256**(앞 8자리)
  - 수정 전: `next.config.ts` 2a7daddd, `verify-build.mjs` 4f0bff14, `tools.ts` b3da9850
  - 수정 후: `next.config.ts` f0e735a8, `verify-build.mjs` 905af83b, `tools.ts` 123fd7fb
- 실행한 명령
  - 사본에서 `node node_modules/next/dist/bin/next build [--webpack]` → `node scripts/verify-build.mjs`
  - 진단: `tmp/t169/traces.mjs`(위반 목록), `dump.cjs`(전후 목록), `needed.cjs`(필요 파일), `pm.cjs`(picomatch 동작)
- **실패 로그 보관**: `tmp/t169/before-*.log`, `before2-*.log`, `list-before-webpack.txt`, `list-after-webpack.txt`
  - 이 로그는 커밋하지 않아요. Node 오류 stack에 PC 경로가 들어 있어서예요.
- 빌드 사본과 외부 데이터 임시 폴더는 지웠어요. 원본 node_modules 266개와 설치 도구 hash는 그대로예요.

## 4. 남은 점
- Next 16.4.6 Webpack(Windows)에서 config 제외 규칙이 효과가 없는 것은 Next 쪽 문제예요. 이번 수정은 도구가 애초에 추적되지 않게 한 것이고, 앞으로 다른 경로가 `process.cwd()`로 고정 조합되어 데이터 폴더를 가리키면 Webpack에서 다시 추적될 수 있어요.
  - 그 경우에도 verify-build가 실패해서 막아요. 그래서 운영 빌드는 실패로 드러나고 조용히 통과하지는 않아요.
- 운영 기본 빌드(`npm run build`)는 Turbopack이에요. Webpack은 검수용 경로로 둘 다 확인했어요.
- 실제 배포, 실사용 DB, 다른 PC·드라이브(D: 등) 배치는 확인하지 않았어요. 이번 확인은 C: 임시 폴더에서만 했어요.
