# 공개 콘텐츠 URL 분석 · 로컬 작업실 검증

2026-11-19 KST · 구현 및 자체 검수. 개발 기준 `83a1eef`, 공통 분석기와 CLI `e8d334c`, 로컬 작업실 화면 `1ae0e2e`. 운영 비교 소스 `3c57eff`는 Master가 확인했다.

로컬 작업실의 `/studio/reference-analysis`에서 공개 미디어 파일 URL을 입력하고 분석 권리를 확인하면, 기존 디코더가 실제 바이트를 읽고 공통 결과 화면에 관찰 근거와 편집 가능한 창작 초안을 표시한다. 기존 합성 체험도 별도 입력으로 이용할 수 있다. 실제 URL 분석은 결과 미리보기까지 수행한다. 이 입력을 통한 기존 프로젝트 적용이나 저장은 구현 범위 밖이다.

## 실제 파일과 화면 결과

별도 작업 사본과 빈 로컬 DB에서 Next 서버를 시작했다. Chromium으로 폼에 각 URL을 입력하고 사용권 확인, 실행, 관찰 근거와 프롬프트 표시까지 확인했다.

| 실제 입력 | 읽은 크기 | 화면에서 확인한 근거 | 프롬프트 |
| --- | ---: | --- | ---: |
| [MDN, 손 그림 JPG](https://interactive-examples.mdn.mozilla.net/media/cc0-images/painted-hand-298-332.jpg) | 12,108 B | 전체 영역에서 주요 색 `#e0e060` 비중 65.95%, 밝기 상위 구간 43.65% | 17개 |
| [Tone.js, Salamander 피아노 A4 MP3](https://tonejs.github.io/audio/salamander/A4.mp3) | 61,148 B | 0–13,323 ms, 2채널, 최대 정규화 RMS 약 13% | 1개 |
| [MDN, 꽃 MP4](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4) | 1,128,375 B | 0 ms의 실제 디코딩 프레임 | 1개 |

원본 해시는 실연동 시험에 고정했다. 테스트용 계정과 등록 자료를 격리한 제품 POST 핸들러에서도 같은 세 파일의 관찰·프롬프트 DTO를 받았다. 화면 시험은 로컬 직접 URL 입력으로 별도로 수행했다. [실연동 시험](../../tests/reference-analysis/real-url-integration.test.ts)

MDN의 R&B WAV는 컨테이너와 스트림 시작 시각이 모두 없어 시간 범위를 확정하지 못했고, 현재 엔진은 음악 프롬프트를 반환하지 않았다. 기존 사용자 예시인 YouTube 영상 두 개는 oEmbed로 제목을 재확인했다. 동영상 자체와 댓글 분석은 미검증이다. [SweeTeez](https://www.youtube.com/watch?v=GVhztzBPsOY) · [Sophia Han](https://www.youtube.com/watch?v=CfHRo311sk0)

## 구현과 검증 방법

로컬 화면은 기본 SQLite 모드, 로컬 인증 판정, 동일한 루프백 출처, 건별 사용권 확인을 검사한다. 읽을 수 있는 공개 원본은 `interactive-examples.mdn.mozilla.net`, `mdn.github.io`, `tonejs.github.io`다. 서명 쿼리·사용자 정보·리디렉션을 거절한다. 수신 및 분석은 전체 30초·64 MiB 한도 안에서 진행하고, 임시 파일 SHA-256과 실제 형식을 검증한다. 제공자 페이지·프로필 URL은 이 파일 입력의 지원 범위 밖이다. 운영자 CLI는 `--origin`으로 별도 권한을 가진 원본을 지정할 수 있다. [로컬 작업실](../../components/reference-analysis/local-url-analysis.tsx) · [서버 액션](../../app/%28studio%29/studio/reference-analysis/actions.ts) · [공통 수신·분석기](../../lib/reference-analysis/local-media-url.ts)

```powershell
node --conditions=react-server --import tsx scripts/analyze-reference-url.ts --authorized https://tonejs.github.io/audio/salamander/A4.mp3
$env:DREAM_REA_LIVE_URL_CHECK='1'
$env:DREAM_REA_NATIVE_TEST='1'
$env:DREAM_REA_HTTP_BROWSER='C:/Program Files/Google/Chrome/Application/chrome.exe'
node node_modules/vitest/vitest.mjs run tests/reference-analysis/local-url-action.test.ts tests/reference-analysis/real-url-integration.test.ts tests/reference-analysis/project-preview.test.ts tests/reference-analysis/studio-analysis-http.test.ts tests/reference-analysis/studio-analysis-http-integration.test.ts
```

- 다섯 파일 38건 통과. 클라우드 인증 모드, 사용권 미확인, 다른 출처·호스트, 미허용 미디어 원본, 서명 쿼리 거절을 포함한다.
- 실제 CLI 입력 3종 통과. 변경 파일 ESLint와 격리 개발 사본 전체 TypeScript 확인을 통과했다.
- 격리 Next production webpack 컴파일은 성공했다. 빌드의 별도 생성 타입 검사에서 기존 `app/api/projects/route.ts`의 선택적 GET 요청 인자가 Next의 요청 타입과 맞지 않아 실패했다. 운영에 배포할 수 있는 빌드로 판정하지 않았다.

## 운영 연결

Master의 당일 확인에서 운영 익명 분석 페이지 요청은 로그인으로 307, API 요청은 401이었다. 운영 소스 `3c57eff`에는 분석 경로가 없다. 개발 소스의 `/cloud/reference-analysis`는 인증 뒤 자료 없는 셸을 제공하고 `studioAnalysisConnection`은 운영 공급자 없이 생성된다. 기존 FFmpeg 바이너리는 서버 빌드에 포함되지 않는다. 운영 파일 등록 권한·분석 실행 환경·보호 결과 전송이 연결되고 배포 후보 빌드가 성공한 뒤 실제 로그인 계정으로 확인해야 한다. [연결 코드](../../lib/reference-analysis/studio-analysis-connection.ts) · [클라우드 셸](../../components/reference-analysis/studio-registered-analysis-page.tsx)

**Master 전달문** · 공개 파일 URL 세 건을 로컬 작업실에 직접 입력해 색 분포, 음악 음량, 영상 프레임과 프롬프트를 확인했습니다. 개발 제품 커밋은 `e8d334c`와 `1ae0e2e`이고 관련 시험 38건을 통과했습니다. 클라우드에는 실제 권한 공급자와 분석 런타임이 필요하며 운영 배포는 보류 상태입니다.
