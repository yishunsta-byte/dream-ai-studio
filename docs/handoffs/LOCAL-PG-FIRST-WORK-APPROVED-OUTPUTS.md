# 로컬 PG 첫 프로젝트의 승인 출력 일치 검증

제품 기준 `e30db53d9fd6a4e16b8322844f9a37e5a7342031`. 격리 Next 개발 서버와 PG 17.12에서 새 쇼핑 숏폼 프로젝트를 만들었다. 실제 프로젝트 API로 요구 확인과 기획 승인을 마치고 서로 다른 PNG 두 장을 첨부·선택한 다음, WAV와 한글 자막을 저장하고 편집 검수를 승인했다. 제품 소스 변경 없이 실제 HTTP 요청과 출력 파일을 검증했다.

## 같은 승인본에서 받은 파일

승인 기준은 리비전 6, 타임라인 `01a1f4cf-dc50-712b-97b0-639bf2407e12`다. 검수 응답, MP4 작업 입력 스냅샷, ZIP 생성 요청, ZIP 매니페스트에 같은 기준이 들어 있었다. MP4 작업 입력 스냅샷과 ZIP 요청의 타임라인 SHA-256은 DB 원문 및 ZIP의 `edit/timeline.json`과 동일했다. `53b95283588f01c35a98dca451567800c0c41a33fa48d81109fd91f2f0be302b`

| 출력 | 바이트 | SHA-256 |
| --- | ---: | --- |
| MP4 | 71,614 | `c86f5e51dc67f554129518ecbcc537f010c5e4b496ee18e63c46cb58597a1930` |
| SRT | 82 | `ce42bc71c1625abe3a111f8c3014e068818e5af91b48e19478f02ef73a70e0dd` |
| VTT | 125 | `23050e0d11e24998a7973e051bd5e75f31a7aaff8b71b585c8591eae7f526a1f` |
| ZIP | 2,088,402 | `efce4dcf20933ecbf8b3186b8c82db8e5f59d2de092596c7e0d2a0c83ac3714e` |

- 렌더 요청 202, 실제 렌더 실행 200, ZIP 생성 201이었다. 소유자 다운로드 네 경로는 각각 200과 해당 MIME, 첨부 헤더, `no-store`를 반환했다. 같은 경로를 다른 계정으로 호출하면 모두 404였다.
- ZIP을 다시 열어 17개 항목을 확인했다. 매니페스트에 있는 파일의 크기와 SHA-256을 재계산했고, PNG 두 장의 바이트·장면 순서·선택 버전 및 WAV 원본 바이트와 권리 메모를 대조했다. ZIP의 `subtitles/manual.srt`, `subtitles/timeline.vtt`는 개별 다운로드 응답과 바이트 단위로 같았다. 자막에는 한글 두 줄이 보존됐고 VTT 큐는 `00:00:00.500`부터 `00:00:02.333`까지였다.
- MP4는 1080×1920, 30fps, 90프레임, AAC였다. 프레임 번호는 0부터 센다. 프레임 29에서 RGB `(254,0,0)`, 프레임 30과 89에서 `(0,1,255)`를 측정했다. 48kHz 단일 채널로 디코딩한 144,000 샘플에서 초반 600Hz 신호와 이후 무음 구간을 확인했다. 한글 자막 두 줄은 페이드가 적용된 상태에서 픽셀 검출 기준을 프레임 15–67 동안 충족했고, 필수 광고 표기는 0–89 전체에서 검출됐다.

## 자막 수정 후 이전 다운로드

`POST /api/projects/{id}/timeline/subtitles`로 자막 첫 줄만 수정했다. 리비전 7로 증가하고 검수 승인이 초기화됐다. 두 타임라인 원문을 비교해 영상, 오디오, 오디오 권리 데이터가 동일함을 확인했다. 앞서 성공한 MP4·SRT·VTT·ZIP URL을 소유자 세션에서 다시 호출했을 때 네 경로 모두 409 `CURRENT_TIMELINE_CONFLICT`를 반환했고 첨부 헤더도 없었다.

## 재현 및 검수 범위

격리 작업 경로는 `D:/starwork/p2-first-work-all-outputs`다. 제품 기준 커밋 위에서 시험 전용 환경과 `tests/postgres/first-work-approved-outputs.probe.mjs`를 사용했다. 결과 로그는 같은 경로의 `first-work-all-outputs.log`에 있다.

```powershell
$env:T371_VERIFY_HTTP = '1'
$env:T371_VERIFY_RENDER_AUDIO = '1'
$env:T371_VERIFY_FIRST_WORK_MODE = 'two'
$env:T371_VERIFY_FIRST_WORK_CAPTIONS = '1'
$env:T371_VERIFY_EXPORT_API = '1'
$env:T371_VERIFY_ALL_OUTPUTS = '1'
node --conditions=react-server --import tsx tests/postgres/t368-run-private-image-project-create.mjs
```

이번 검수는 루프백 PG와 합성 미디어에서 제품 HTTP 경로 및 생성 파일을 확인했다. 운영 Storage, 브라우저 클릭 흐름, 편집 프로그램 반입은 이 검수의 범위 밖이다. 검사 후 시험 역할과 PG 프로세스·리스너·임시 클러스터를 정리했다.

> 새 로컬 PG 프로젝트의 승인 r6에서 받은 MP4·SRT·VTT·ZIP을 대조했습니다. ZIP 안의 자막과 개별 다운로드가 바이트 단위로 일치했고 MP4에서 두 장면 전환, WAV 음원, 한글 자막과 필수 광고 표기를 확인했습니다. 자막 한 줄만 수정한 r7에서는 이전 다운로드 네 경로가 모두 409로 차단됐습니다. 제품 변경 없이 검증 기록을 남겼습니다.
