# P1-08 관리자 오디오 작업실 연결

- 기준 `ab167cd9b29a0256170edcd3b231af09d57b9b00`
- 격리 작업트리 `D:/starwork/design-admin-audio-embed-3aaf87c`
- [합성 로그인 미리보기](http://127.0.0.1:22478/auth/callback?token_hash=preview&type=magiclink&next=%2Fadmin%23admin-music-analysis)

## 구현

- 기존 **오디오 분석** 메뉴의 `#admin-music-analysis` 본문에 Audio Analyzer v1.15의 `AudioStudio`를 직접 표시한다. 공통 상단 메뉴와 기존 상세 제목 초점, 단일 `main`을 유지한다. PC는 왼쪽 모드·절차, 오른쪽 업로드·분석 결과다. 모바일은 프로그램의 메뉴를 접어 연다. 본문에 있던 별도 음악 업로더는 원본 작업실 안의 업로더로 통합했다.
- 기본은 자동 감지와 상세 보고서다. 자동·음성·음악 모드, FLAC·파형, 컨텍스트·특별 요청, 기본/상세 결과와 기존 보호 업로드를 재사용한다. 기존 음악 공개 준비는 음악 모드에서 바로 분석한 기본 보고서 결과의 **공개 준비**로 연결한다. Suno 편집과 공개 준비에 들어가는 제안 원문은 기존과 같은 동작이다.
- 소유 확인한 프로젝트·장면의 기존 복귀 링크를 같은 본문에 표시한다. 보호 전용 `/admin/audio-analysis` 진입 링크도 유지한다. API 설정은 내장형에서 같은 관리자 화면의 섹션으로, 전용 화면에서 `/admin#admin-api-integrations`로 연다. 인증 파일, DB, API, 영상 코드는 그대로다.

## 자체 검수

| 검수 | 결과 |
| --- | --- |
| 단위·정적·빌드 | 관리자 Vitest 32파일·258건, 변경 파일 ESLint, `git diff --check`, Next.js `build --webpack` 통과 |
| 실제 Next, 합성 인증 1440·390·320px | 상단 메뉴 → 같은 주소의 오디오 본문, 초점, 헤더/메인/파일 입력 각 1개, 문서 가로 넘침 0. PC 왼쪽 모드와 모바일 드로어의 선택/닫기/초점 복귀를 확인 |
| 브라우저에서 공급자 응답 대역 | 합성 WAV 드롭·파형·키보드 탐색, 세 모드의 실제 화면 요청 계약 및 동의, Suno 편집 뒤 공개 준비의 원문, 작업실 복귀 경로, 브라우저 뒤로 가기와 파일 교체 후 맥락 유지 확인. 공개 쓰기와 공급자 호출은 0 |
| 보호 전용 주소 | 합성 인증 후 독립 오디오 화면과 API 설정 주소, 미인증 307 및 프로젝트·장면이 담긴 기존 로그인 복귀 주소를 확인 |

[1440px](/D:/starwork/design-analysis-check/admin-audio-embed-3aaf87c/audio-embedded-1440.png) · [390px](/D:/starwork/design-analysis-check/admin-audio-embed-3aaf87c/audio-embedded-390.png) · [320px](/D:/starwork/design-analysis-check/admin-audio-embed-3aaf87c/audio-embedded-320.png) · [브라우저 결과](/D:/starwork/design-analysis-check/admin-audio-embed-3aaf87c/verification.json)

검수 환경은 공급자 대신 브라우저 응답 대역을 사용한다. 100 MiB 실제 업로드, Gemini 응답 및 운영 저장소 연결은 이 UI 결합의 검수 항목과 구분한다. 이 후보는 Master의 통합 검수 대상으로 인계한다.

공용 브라우저 공개 검수 `tests/admin/admin-premiere-publication.ego.mjs:262–273`은 기본 화면에서 곧바로 음악 분석을 누르는 예전 경로를 사용한다. 통합 시 이 스크립트에 음악 모드와 기본 보고서 선택을 추가한다. 이 후보의 전용 브라우저 검수에서는 해당 선택을 거쳐 기존 공개 준비까지 통과했다.

Master 전달 문구

P1-08-ADMIN-AUDIO-EMBED 자체 검수를 완료했습니다. 기존 관리자 탭 아래에 원본 오디오 v1.15를 연결했고 공개 준비, 작업실 복귀, 보호 전용 주소를 보존했습니다. 1440·390·320px와 세 모드의 합성 동작이 통과했습니다. 공급자·DB·인증 코드는 변경하지 않았습니다.
