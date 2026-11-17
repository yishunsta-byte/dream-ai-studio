# T170 F168-1 build trace 집중 독립 검수 — bounded PASS

- 담당: 독립 Codex `term_0ff3fb9d53ae5c6d505d1f2b4fcf1374`, task `task_0c45305b0131`, dispatch `ctx_34cc506c81d0`, 2026-11-17 KST.
- 수정: **`46664c7583215cbafaa87c9925c5cd017dc3e66c`**, T169 보고서 전문. 수정 전: **`7b50c715bc81eea68dd376150b1b48fcc1d8d746`**.
- 결론: **F168-1과 외부 runtime glob 오류는 아래 C: 격리 환경에서 독립 재현·해소 확인, bounded PASS.** 필수 수정 발견 없음. 검증기의 파일명/경로 기반 한계와 임의 이름 바이너리 관찰은 아래처럼 명시한다. 전체709·실제 배포·D: 배치·standalone 이식성을 새로 통과시킨 결과가 아니다.
- 제품 파일은 수정하지 않았다. 보고서만 선택 커밋한다. 작성자 T169 수치와 아래 독립 수치는 별개 실행이며 같은 결과가 직접 재현됐다.

## 환경·저장원·줄 끝 identity

- **ROOT:** `C:/Users/Administrator/AppData/Local/Temp/t170-trace-fc2dd4f786c94060baa327800861438f` (CLI 출력에는 같은 Windows 위치의 `ADMINI~1` 표기도 있음).
- `ROOT/app`: 수정 전 전체 git archive에서 시작한 사본. node_modules는 설치본에서 **robocopy 실제 복사**, exit1(파일 복사 성공)이며 junction이 아니다. ffmpeg/probe도 `.tools/ffmpeg`에 물리 복사했다.
- `ROOT/fixed-source`: 수정 후 git archive. 수정 전 재현 뒤 변경5파일만 **ReadAllBytes/WriteAllBytes**로 app에 반영했다. 같은 app·같은 물리 dependency/tool·같은 sentinel에서 전후를 비교했다.
- 외부 runtime=`ROOT/external`, 루트 runtime=`ROOT/app`, 하위 runtime=`ROOT/app/rt-case`.
- 세 위치 각각 data/storage/backups/tmp/.tools에 가짜 sentinel을 두고 `.env.local`에는 `T170_SYNTHETIC_SENTINEL=not_a_secret`만 썼다. 실제 DB/비밀/사용자 자료가 아니다. 나중의 API smoke에는 별도 `ROOT/live-runtime` 새 가짜 DB를 사용했다.

이번 archive의 일반 텍스트는 **CRLF**였다(발행 SQL의 eol=lf 정책은 유지). 따라서 archive raw bytes를 Git의 정규화 LF blob이나 작성자 LF SHA와 같다고 주장하지 않는다. 빌드한3파일의 CR/LF 수는 각각10/10,20/20,27/27이며 next.config/verify-build에는 UTF-8 BOM이 있다. `git hash-object --path=<repo path>` 결과는 정확히 수정 커밋 blob과 같았다.

| 파일 | archive raw SHA256 앞8 | LF 정규화 SHA256 앞8 | 정규화 Git blob 앞8 |
|---|---|---|---|
| next.config.ts | `7893498c` | `f0e735a8` | `8ef86b78` |
| lib/media/tools.ts | `8b0cef83` | `123fd7fb` | `df640589` |
| scripts/verify-build.mjs | `1d46d69f` | `905af83b` | `39505369` |

LF 정규화 SHA 앞8은 T169 보고서와도 일치했다. 전체 hash·BOM/CR/LF 수는 ROOT/line-ending-identity.json 및 independent-diff-identity.json에 있다. 빌드 편의를 위해 원본 제품의 줄 끝을 다시 쓰거나 검사 기대값을 바꾸지 않았다.

## 실제 Next16.4.6 guide·Windows glob 원인

설치된 Next의 `dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`에서 project-root 상대 glob, route key `/*`, forward slash 권고를 읽었다. 설치된 collect-build-traces.js의 실제 exclude 적용 경로도 읽었다.

- 제외 목록을 `path.join(dir, exclude)`로 조합하고 그 결과를 picomatch에 넘긴다. match 대상도 `path.join(pageDir,file)`이다.
- includes에는 slash 정규화가 보이지만 해당 excludes 조합에는 같은 처리가 없다.
- webpack-config.js가 trace entrypoint plugin에 넘기는 `traceIgnores`는 실제 `[]`다. 제품 config만으로 이 초기 trace를 막는 연결은 확인되지 않았다.
- 설치된 **Next의 compiled picomatch**로 실제 사본 경로 `.tools/**/*`를 계산해 직접 비교했다. Windows join의 역슬래시 pattern/path는 **false**, 양쪽을 forward slash로 정규화하면 **true**였다. ROOT/picomatch.json.

이것은 이번 `.tools` 경로/Next16.4.6/Windows 재현의 근거다. 모든 glob·플랫폼·Next 버전에서 무조건 같다는 일반화는 하지 않는다. 수정은 runtime appRoot 계산을 통해 도구가 애초에 trace에 들어가지 않게 하고, 검증기는 유지·강화한다.

## 수정 전·후 실제 빌드 행렬

각 case는 같은 app에서 `DREAM_DATA_ROOT`를 지정하고 `node node_modules/next/dist/bin/next build [--webpack]`를 실행했다. build가0일 때만 **그 case의 실제 verify-build CLI**를 호출했다. 원본 trace를 사후 삭제하거나 목록을 편집하지 않았다. ROOT/build-case.mjs에 명령·수집 절차가 있다.

| 소스/엔진/runtime | build | verify | server trace 수 | trace entry 수 | 실제 위반 |
|---|---:|---:|---:|---:|---:|
| 수정 전 Webpack / 외부 | 0 | **1** | 37 | **6942** | **40** |
| 수정 전 Turbopack / 외부 | **1** | 미실행 | — | — | 바깥 glob 오류 |
| 수정 후 Webpack / 외부 | 0 | 0 | 37 | **6902** | 0 |
| 수정 후 Turbopack / 외부 | 0 | 0 | 37 | **7692** | 0 |
| 수정 후 Webpack / 앱 루트 | 0 | 0 | 37 | 6902 | 0 |
| 수정 후 Turbopack / 앱 루트 | 0 | 0 | 37 | 7692 | 0 |
| 수정 후 Webpack / 앱 하위 | 0 | 0 | 37 | 6902 | 0 |
| 수정 후 Turbopack / 앱 하위 | 0 | 0 | 37 | 7692 | 0 |

수정 전 Webpack의40개는20개 trace에 든 ffmpeg.exe/probe.exe뿐이었다(F168-1 재현). 수정 전 Turbopack은 `glob '../external/data/**/*' is invalid, it has a prefix that navigates out of the project root`로 실패했다. 수정 후 config가 외부 경로 glob을 만들지 않아 통과했다.

각 case의 `*-result.json`, `*-files.json`, build log와 `*-verify.log`를 따로 보존했다. ROOT/build-matrix.json은 이 독립8회 결과를 모은 것이다. 수정 전 Turbopack/루트 조합은 다시 실행하지 않았으므로 T169의 그 행은 작성자 증거로만 남긴다.

### 전후 추적 diff 및 필수 자료

수정 전/후 **Webpack 외부 runtime의 모든 `trace → file` 항목**을 같은 상대경로 표현으로 직접 비교했다.

- 제거 **40**, 추가 **0**, trace 개수37 유지.
- 제거된 고유 파일은 **`.tools/ffmpeg/ffmpeg.exe`, `.tools/ffmpeg/ffprobe.exe`만**이다.
- 도구 외 필수 자료의 추적을 줄여서 맞춘 통과가 아니다. ROOT/independent-diff-identity.json에 전체 diff가 있다.
- 수정 후6case 모두 migration **11파일**(SQL0001~0010 중 코드0005의 entry/shared 포함), `docs/spec/menus.json`, `config/providers.json`, 글꼴 파일과 OFL이 유지됐다.
- source data/env/storage sentinel, 실행 도구, 렌더 toolchain의 verifier 분류 위반은 모두0이었다. sentinel이 있다고 해서 모든 가능 경로의 비밀 누출을 증명한 것은 아니며, 이번 생성 trace와 실제 배치한 가짜 위치를 검사한 결과다.
- **better_sqlite3.node는 수정 전·후 모두 목록에 없었다.** 아래 local upload smoke는 물리 node_modules가 있는 상태에서 성공했다. 이를 standalone 산출물에 native 모듈이 자동 포함된다거나 다른 PC로 복사만 하면 동작한다는 보장으로 확대하지 않는다.

## verify-build 독립 negative control

새 검증기는 기존 privateTrace/renderTrace와 recursive `.next/server/**/*.nft.json` scan을 유지한다. 임시 프로젝트의 **deep/route/page.js.nft.json**에 아래 파일을 각각 넣고 실제 CLI exit와 진단을 검사했다. 실제 exe control에는 사본의 물리 ffprobe.exe bytes를 사용했다(문자열 fixture를 실행 파일이라고 부르지 않음).

| 대조 | exit / 실제 진단 |
|---|---|
| `.tools` 밖 vendor/ffprobe.exe 실제 복사 | **1**, tool1건 |
| `.tools/opaque.bin`에 실제 exe를 복사하고 public/innocent.bin 링크로 참조 | **1**, 실제 경로를 따라 tool1건 |
| 외부 runtime/data/sentinel.db와 env의 innocently named 파일 링크 | **1**, private2건 |
| 한 깊은 trace에 private+다른 경로 ffmpeg.exe+@remotion/renderer | **1**, private/tool/render **3건 모두 출력** |
| lib/media/tools.js, ffmpeg-helpers/index.js, ffprobe-guide.txt | **0**, 일반 코드·설명 파일 허용 |

ROOT/negative-controls.json에 CLI 원문과 상태를 보존했다. 새5시험과 기존4시험도 별도로 독립 실행했다. 허용 목록으로 실제 위반을 빼거나, 첫 항목만 보고 나머지 scan을 생략한 수정은 확인되지 않았다. tool에 해당하는 `.tools` entry가 이전 private에서 새 tool 문구로 분류되는 것은 거절 축소가 아니다.

**관찰된 한계/문구 정밀화:** `.tools` 밖에 실제 exe bytes를 **vendor/processor.bin**이라는 임의 이름으로 복사하고 trace에 넣으면 exit0이다. 검증기는 **이름·경로·realpath 기반이며 바이너리 내용 서명 검사기가 아니다**. T169의 “이름을 바꾼 복사본 거절”은 `.tools` 내부 또는 ffmpeg/probe로 식별되는 이름/실제 경로에서만 성립한다. arbitrary opaque 이름까지 찾아낸다고 표현하면 안 된다. 현재 제품 resolver가 쓰는 알려진 `.tools/ffmpeg` 배치·ffmpeg/probe 이름과 F168-1 수정 범위에서는 차단이 확인됐으므로 이를 새 OS 격리/전 실행파일 내용 탐지 요구로 확대해 FAIL로 세지 않았다. 배치 정책이 이 범위 밖으로 확장되면 별도 검증이 필요하다.

## resolver·실제 미디어/컴파일된 앱 runtime

새 함수는 반환 경로를 runtime appRoot에서 계산하지만 **환경 변수→앱 `.tools/ffmpeg` 실제 파일→PATH 이름** 순서는 유지된다. 독립 실행으로 다음을 확인했다.

1. env를 비운 상태에서 사본의 physical ffmpeg/probe 경로를 선택하고 실제 `-version` 실행.
2. 다른 `ROOT/env-tools` physical copy를 env로 지정하면 앱 도구가 있어도 env 경로를 선택하고 실제 ffprobe 실행.
3. 도구가 없는 가짜 cwd에서 env를 비우면 ffmpeg/ffprobe 이름을 반환. 프로세스 전용 PATH에 사본 도구 폴더를 넣고 실제 ffprobe 실행.
4. 사본 ffmpeg로 16kHz·0.2초 합성 sine WAV를 생성하고 inspectMedia가 **audio/wav·duration200ms**로 판독. ROOT/runtime-media.json.

마지막 Turbopack 산출물을 **같은 C: 사본의 local Next start(127.0.0.1:3170)**로 열고, 새 가짜 DB를 제품 CLI로10단계 migrate했다. env tool override 없이 앱 물리 도구를 사용하도록 한 뒤 실제 컴파일된 `/api/assets/upload`에 위 WAV를 보냈다.

- 실제 **HTTP201**.
- 가짜 DB 저장 행 `kind:audio,mime:audio/wav,duration_ms:200,size_bytes:6478`.
- 저장 Buffer=업로드 Buffer, SHA256 `8ed98522ec6668d22a93675134897bc011bec9bdfbfe9ae6f9a6bcd6c112d8d3`.

따라서 도구를 trace에서 뺀 뒤에도 실제 컴파일된 업로드 경로의 ffprobe 사용과 필요한 local 코드가 살아 있음을 확인했다. ROOT/compiled-runtime-upload.json. 이 서버는 로컬 smoke이며 외부 배포가 아니다. D: 설치본에서 도구를 복사해 왔다는 사실도 **D:에서 앱을 배치·실행 검증했다**는 뜻이 아니다.

## 시험·정적 검사

사본의 고정 수정 소스에서 다음을 실행했다.

```text
node node_modules/vitest/vitest.mjs run tests/t169-build-tracing.test.ts tests/build-tracing.test.ts tests/media-storage.test.ts
npm.cmd run lint
npm.cmd run typecheck
```

- 새5+기존4+미디어9 = **3파일/18 PASS**, exit0. 미디어 도구가 실제 존재하여 해당 미디어 시험을 skip하지 않았다.
- lint exit0, typecheck(`next typegen && tsc --noEmit`) exit0.
- ROOT/related.log, lint.log, type.log. 전체709는 재실행하지 않았다.
- package/lock·발행 migration·고정 fixture·UI/service의 `git diff --exit-code 46664c7^ 46664c7 -- ...`는0이었다.

## 종료·보호·잔존·미검증

local smoke의 소유 exec session2819만 중지했다. **3170 listener 없음**, ROOT를 명령줄에 가진 node/ffmpeg/ffprobe 최종 조회0건이다. 사용자 **3013은 시작·종료 모두 PID55956**, 공유 `.next/dev/lock`은 표시상 2026-11-17 09:31:32·107바이트로 유지됐다. 공유 `.next` 전체 hash를 비교한 것은 아니며 해당 경로에 빌드·삭제 명령을 실행하지 않았다. 사용자 DB/비밀 파일도 사용하지 않았다.

설치본과 physical 사본의 도구 hash는 시작·종료 동일했다.

- ffmpeg `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`
- ffprobe `f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52`

ROOT 아래 app과 물리 dependency 복사본만 삭제하도록 절대 임시 경계·하위 경계·junction 아님을 가드한 명령을 제출했으나 **자동 승인 검토가 프로세스 생성 자체를 `blocked by policy`로 거절했다.** 삭제는 실행되지 않았고 우회하지 않았다. app/물리 node_modules·tool copies·sentinel·negative-control 링크·가짜 DB·빌드/로그/JSON이 ROOT에 남는다. 정리 완료를 주장하지 않는다. 이전 검수 잔존은 건드리지 않았다.

실제 배포·D: runtime 배치·standalone/native dependency 배포·다른 OS/Next버전·전체709·render/DSP/음질·사용자 DB 이관은 미검증이다. 알려진 이름/경로 기반 검증의 한계도 위 관찰대로 유지한다.

## Master/플래너 복사 전달문

T170은 46664c7의 F168-1 수정에 대해 **bounded PASS**입니다. 수정 전 Webpack40개 도구 추적/verify실패와 외부 Turbopack glob실패를 재현했고, 수정 후 두 엔진×외부/루트/하위6case는 build·verify가 모두 통과했습니다. 전후 Webpack 전체 diff는 도구40개 제거·추가0, 필수 migration/메뉴/provider/font/OFL 유지이며 새5+기존4+media9·lint/type와 컴파일된 앱의 합성 WAV upload201도 확인했습니다. 검증기는 알려진 파일명/경로/realpath 기반으로 임의 opaque 이름의 외부 복사본 내용까지 탐지하지 않으며 standalone/D배치 보장은 아닙니다. 3170은 종료·3013 PID55956은 유지했고 app 삭제는 자동 승인 검토 거절로 미실행되어 ROOT 증거가 남습니다.
