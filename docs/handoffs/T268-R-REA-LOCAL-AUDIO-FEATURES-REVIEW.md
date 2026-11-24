# T268-R REA 로컬 음원 독립 검수

2026-11-19 KST · Codex(Tester) · 기준 `232957e650e698e5d5990f01fa374bc33f53a2ad` · 배정 `msg_12c9bdeb263a`

**조건부 통과.** 로컬 모노 PCM 분석과 다음 독립 단위는 진행할 수 있다. 실제 다채널 자료의 신호·무음과 BPM을 화면이나 공유 결과에 연결하기 전에는 결과가 모노 변환 기준임을 명시하거나 채널별 에너지로 보완한다. [구현 보고](T268-REA-LOCAL-AUDIO-FEATURES.md)

## P2 · 모노 변환의 신호 상쇄

2초짜리 무손실 스테레오 ALAC/M4A를 별도로 합성해 같은 사인파의 왼쪽·오른쪽 위상을 반대로 뒀다. 기존 FFmpeg의 스테레오 PCM에서 두 채널의 RMS가 각각 약 0.353554였는데, REA의 모든 50ms 창은 RMS 0이었다. `0–2000ms` 전체가 `quiet`, BPM은 `quiet_signal`이었다. 같은 위상의 대조 음원에서는 모노 RMS가 약 0.353552였다. 측정은 모노 PCM에 대해 맞으며, 스테레오 원본의 무음으로 해석하면 틀린다. 현재 private 관찰에는 `RMS measured … PCM windows`만 기록된다. [다운믹스와 관찰](../../lib/reference-analysis/audio-features.ts)

최소 보완으로 같은 소스의 모노 다운믹스 RMS임을 관찰·표시 계약에 명시하고, 채널 상쇄가 있을 수 있는 자료에서 `quiet_signal`을 원본 무음으로 표시하지 않는다. 원본 신호 여부가 필요하면 채널별 에너지 또는 에너지를 보존하는 집계와 해당 회귀를 추가한다. 반복 에너지의 120 BPM은 추정이며, 실제 음악의 박자와 세분 단위가 같다는 근거로 사용하지 않는다.

## 통과한 범위

- 별도 4초 ALAC 펄스에서 32,000개 표본과 50ms 창 80개를 확인했다. 첫 100ms의 두 창 RMS는 약 0.353554, 그 다음 창은 0이었다. 신호 `0–100ms` 뒤 무음 `100–500ms`를 구분했다. 0–3500ms의 500ms 간격 상승 8건은 120 BPM으로 추정했고, RMS와 상승은 관찰, BPM은 해당 관찰을 참조한 추정이었다. 별도의 2초 디지털 무음은 `quiet_signal`, 불규칙 300/700ms 교대 펄스는 `irregular_intervals`였다. [음원 분석](../../lib/reference-analysis/audio-features.ts)
- 별도 음원에서 중간 샘플 구간을 제거해 PTS 불연속을 만들었다. 실물 ffprobe에서 중간 패킷 구간의 간격 변화를 확인했고 REA는 `sample_timing_unverified`와 관찰 미출력으로 끝났다. 기존 시험은 불연속 PTS 합성 로그, 시작 시각 미확인 WAV 및 음원 두 트랙을 거절했다. 시간 정렬이 입증되지 않은 지원 컨테이너는 특징 분석 불가로 처리된다. [음원 시험](../../tests/reference-analysis/audio-features.test.ts)
- 별도 25초 음원은 `analysis_limit`이었다. 기존 64 MiB 검사, 24초·192,000개 표본·출력당 1 MiB의 구현 경계를 확인했다. 이미 취소된 신호와 1ms 기한을 `cancelled`와 `timed_out`으로 구분했고, 진행 중 두 상태는 네이티브 시험에서 실제 합성 자식 `close`와 사본 제거를 재검증했다. 추가 실행 전후 관리 사본 목록이 같았고 합성 원본도 정리했다. [로컬 검사](../../lib/reference-analysis/local-file.ts)
- 실제 음원 분석에는 프로브가 확인한 스트림 인덱스와 같은 관리 사본을 사용했다. PCM은 내부 계산에 사용되며 결과에는 요약된 수치와 근거만 있다. 내부 사본 절대경로가 검사 JSON에 없었고 공유 DTO에서 비공개 파일명은 제외됐다. 공용 검사 콜백 변경 후 영상의 컷·PTS·표지·표시 비율·종료 회귀가 모두 통과했다.

## 실행 범위

고정 커밋과 관련 파일의 일치를 확인했다. `contract.test.ts`, `boundaries.test.ts`, `local-file.test.ts`, `video-features.test.ts`, `audio-features.test.ts` 기본 **36 통과·34 건너뜀**, 네이티브 **70/70 통과**. `tmp/t268-rea-typecheck.json` 범위 TypeScript와 REA 라이브러리·지정 시험 다섯 파일 ESLint 경고 0 검사가 통과했다. 추가 자료는 기존 로컬 도구로 합성했고 보고서 한 파일을 추가했다.
