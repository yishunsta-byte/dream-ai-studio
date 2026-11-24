# 검증된 등록 PCM WAV의 시작 시각 보완

2026-11-20 KST · Codes(Backend) · Master 배정 `msg_784ffa280d87` · 실측 기준 `28dcba0`

실제 FFprobe가 컨테이너와 트랙의 시작 시각을 모두 생략하더라도, 검증된 등록 PCM WAV는 첫 샘플부터 음악 관찰값을 만들 수 있다. 유효한 시작 시각이 있는 파일은 기존 타임스탬프 판정을 사용한다. [시작 시각과 프레임 실측](REA-CLOUD-PCM-WAV-TIMELINE-VERIFICATION.md)

## 적용 조건

- 기존 서버 사본의 등록 SHA-256·파일 크기·자료 세대 확인을 통과한 음악 입력에서만 검토한다. 실제 MIME은 `audio/wav`여야 한다. 등록 증거가 없으면 이전처럼 도구의 시간 정보를 사용한다.
- RIFF/WAVE에 표준 16바이트 `fmt`와 단일 `data`가 이 순서로 정확히 있어야 한다. 16비트 정수 PCM, 모노·스테레오, 8–192 kHz, 정확한 RIFF·data 크기, 블록 정렬과 바이트 속도를 확인한다. 헤더만 다시 읽어 전체 파일의 추가 메모리 복사를 피했다.
- FFprobe의 단일 `pcm_s16le` 트랙에서 채널, 샘플레이트, 시간 단위, 프레임 수, 컨테이너·트랙 길이가 사본과 일치해야 한다. 길이는 PCM 프레임 수를 기준으로 도구의 마이크로초 표시 정밀도 내에서 대조한다. 명시된 시작값 일부가 없거나 일치하지 않는 경우에는 보완 분기에 진입하지 않는다.
- FFmpeg에 전체 PCM을 디코딩·재샘플링하게 하고, 첫 출력 PTS가 0이며 채널·PTS가 연속이고 출력 샘플 수가 원본 프레임을 변환한 범위에 들 때만 RMS를 확정한다. 표시 시간은 실제 원본에서 반올림한 트랙 끝을 넘지 않는다. 등록 증거와 원본 경로는 반환 DTO에 실리지 않는다.

## 검증

Windows 저장소의 실제 FFprobe·FFmpeg 9.0.2를 사용했다. 정상 시험은 도구의 출력을 수정하지 않았다.

| 표본 | 실제 결과 |
| --- | --- |
| 8 kHz 모노, 1,000 원본 프레임 | 채널당 1,000개 분석 표본, 0–50·50–100·100–125ms. RMS 0.25·0·0.125. |
| 48 kHz 스테레오, 6,000 원본 프레임 | 8 kHz로 채널당 1,000개 표본. 같은 세 구간에서 반대 위상 채널의 RMS 약 0.25 유지. |
| 44.1 kHz 모노, 5,534 원본 프레임 | 채널당 1,004개 출력 표본. 마지막 관찰 구간은 원본 길이를 반올림한 125ms에 맞췄다. |
| 실패 | JUNK 포함 등록 WAV, 잘린 data, 프레임 끝 정렬 오류, 불일치한 바이트 속도는 보완 시작값과 음악 관찰값을 얻지 못했다. 다른 SHA는 FFprobe 호출 전에 차단됐다. 도구의 프레임 수·샘플레이트·일부 시작 시각 불일치를 각각 주입한 실패 시험도 음악 결과를 반환하지 않았다. |

세 사본의 등록 증명, 원본 해시와 임시 파일 정리를 확인했다. 등록 증거 없는 WAV는 종전처럼 `track_unverified`였다. 등록 MP3와 기존 M4A·영상·파일 경계 회귀를 포함한 네이티브 44건과 기본 참고 분석 회귀 236건이 통과했다. 기본 실행에서 조건부 74건은 건너뛰었다. 변경 파일 ESLint와 TypeScript 검사도 통과했다.

```powershell
$env:DREAM_REA_NATIVE_TEST='1'
npx.cmd vitest run tests/reference-analysis/registered-pcm-wav-timeline.test.ts tests/reference-analysis/audio-features.test.ts tests/reference-analysis/local-file.test.ts tests/reference-analysis/video-features.test.ts --maxWorkers=2
Remove-Item Env:DREAM_REA_NATIVE_TEST
```

검증된 등록 발급자·재승인, PostgreSQL에 원문을 등록하는 실흐름, 클라우드 공개 경로·운영 전송은 별도 배정이 필요하다. [음악 등록 계약](REA-CLOUD-MUSIC-AUTHORITY-SCOPE.md) · [T323 운영 전송 조건](T323-REA-TWO-HOST-STAGING-READINESS.md)
