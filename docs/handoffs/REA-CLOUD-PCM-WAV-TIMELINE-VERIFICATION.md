# 등록 PCM WAV의 분석 시간축 검증

2026-11-20 KST · Codes(Backend) · Master 배정 `msg_0bfb0937ad6c` · 권한 조사 `239f12f`

**정상 PCM WAV 두 건 모두 도구가 시작 시각을 생략해 현재 분석기가 결과를 보류했다.** 포맷·프레임·사본 해시를 검증한 두 시험에서만 파일 내부 시작을 0으로 주입했을 때, 실제 FFmpeg 디코더와 기존 분석기가 예상 시간 구간과 RMS를 반환했다. 제품의 시간축 판정은 그대로다. [음악 등록 권한 조사](REA-CLOUD-MUSIC-AUTHORITY-SCOPE.md)

## 실제 실행

Windows의 저장소 내 FFmpeg·FFprobe 9.0.2를 사용했다. 125ms 합성 PCM을 만들고 기존 WAV 등록 검사 `inspectPcmWav`와 등록 사본 분석기를 실행했다. 각 시험은 원본의 SHA-256 및 시험용 자료 세대를 등록 증거로 넘겨 분석 사본이 같은 바이트에서 출발하도록 했다. 실제 PG 등록 경로에 자료를 쓰는 검증은 별도다.

| 표본 | 등록 검사 및 FFprobe | 실제 원본 PCM 디코딩 | 기존 분석 | 시작값 0을 주입한 시험 |
| --- | --- | --- | --- | --- |
| 8 kHz·16비트 모노 | 2,044 B, 1,000프레임, `time_base=1/8000`, `duration_ts=1000`, 0.125초 | 2,000 B. 원본 data 청크와 바이트 일치 | 검사 완료, `track_unverified`. 등록 분석은 `unverified_analysis` | 8 kHz 채널당 1,000개 표본, 0–125ms. RMS 0.25, 0, 0.125 |
| 48 kHz·16비트 스테레오, 좌우 반대값 | 24,044 B, 6,000프레임, `time_base=1/48000`, `duration_ts=6000`, 0.125초 | 24,000 B. 원본 data 청크와 바이트 일치 | 검사 완료, `track_unverified`. 등록 분석은 `unverified_analysis` | 8 kHz 채널당 1,000개 표본, 0–125ms. RMS 약 0.25, 0.25, 0.25 |

두 파일에서 컨테이너와 단일 `pcm_s16le` 트랙의 `start_time`이 모두 없었다. 실제 PCM 원본의 정렬은 모노 2바이트, 스테레오 4바이트 단위였다. 주입 시험은 FFprobe 결과에서 누락된 시작값 두 개만 채웠다. 기존 검증기로 연속된 디코더 PTS·채널 수·샘플 수를 확인했고 0–50, 50–100, 100–125ms의 관찰창이 나왔다. 등록 증거와 원본 파일의 SHA-256은 유지됐고 분석 사본은 정리됐다.

## 실패와 경계

- RIFF 길이를 갱신한 뒤 data를 자른 경우, 스테레오 프레임 끝이 어긋난 경우, fmt의 바이트 속도가 채널 수와 불일치하는 경우는 기존 등록 검사가 거절했다.
- 올바른 RIFF 원본에 다른 등록 SHA-256을 주면 분석 사본 검증이 `invalid_file`로 끝났다. FFprobe·FFmpeg 호출은 0회였다.
- `JUNK` 청크가 있는 WAV도 기존 등록 검사에서 정상 상태와 같은 메타데이터를 반환했다. 따라서 등록 검사를 통과했다는 사실만으로 단순한 `fmt`→`data` 배치나 시간축을 가정할 수 없다.

## 배정할 최소 후속 구현

등록 사본에서만 누락된 시작 시각을 다루는 좁은 PCM 시간축 계약을 제안한다. RIFF/WAVE, 단일 표준 16비트 PCM fmt·data, 정확한 크기·프레임 정렬, 등록 SHA-256·용량 및 서버 발급 자료 세대를 먼저 검증한다. 실제 단일 `pcm_s16le` 스트림의 채널·샘플레이트·프레임 길이와 일치할 때 첫 PCM 샘플을 0으로 두고 `frames / sampleRate`로 파일 내부 종료 시각을 계산한다. 실제 유효 타임스탬프는 기존 경로에서 사용한다. 타임스탬프 충돌, 추가 시간 관련 청크나 검증하지 않은 레이아웃, 다중 트랙, 프레임·채널·SHA 불일치는 기존 보류 판정을 유지한다. 기존 재샘플링·연속성·상한을 적용한 뒤에만 관찰값을 반환한다.

첫 후속 구현의 합격 기준은 이번 두 파일을 시험용 FFprobe 주입 없이 통과시키고 잘못된 파일은 계속 차단하는 것이다. 추가 샘플레이트·끝 프레임 반올림·메타데이터 포함 WAV는 별도 검증한다. 음악 승인·등록 공급원, 실제 PG 저장물과 클라우드 POST, T323 운영 전송은 이번 검증 범위 밖이다.

```powershell
$env:DREAM_REA_NATIVE_TEST='1'
npx.cmd vitest run tests/reference-analysis/registered-pcm-wav-timeline.test.ts tests/reference-analysis/audio-features.test.ts --maxWorkers=2
Remove-Item Env:DREAM_REA_NATIVE_TEST
```

두 파일 14건 통과. 추가 시험 파일 ESLint와 소스 TypeScript 검사 통과. [전용 검증](../../tests/reference-analysis/registered-pcm-wav-timeline.test.ts)
