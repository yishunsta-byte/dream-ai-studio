# PG 저장 음원의 AAC 구간 판정

기준 음원은 서로 구별되는 합성 WAV를 사용한다. 각 신호에 반복되지 않는 순서를 두고 클립 처음과 끝 인근의 신호가 충분히 들리게 만든다. 타임라인의 위치·끝·무음 검증에서는 페이드와 덮킹을 끈다. 원본의 자체 무음이 있다면 예상 PCM에 넣는다.

1. 실제 최종 MP4를 고정 FFmpeg로 48 kHz 스테레오 f32le로 디코드한다. 영상과 음성의 표시 시작 시각 및 타임베이스도 ffprobe로 저장한다. 기존 출력 계약의 0초 원점과 30fps를 확인하고, 1프레임은 채널당 1,600샘플로 계산한다. 기대 음성 구간은 [startFrame × 1600, (startFrame + durationFrames) × 1600)이고 sourceInFrame은 원본 비교를 시작할 샘플이다.
2. 총 디코드 샘플 수는 채널당 outputFrames × 1600과 정확히 일치해야 한다. 처음 음성 packet의 음수 PTS와 skip_samples는 증빙에 적는다. MP4를 정상 디코드한 PCM에 encoder delay를 다시 빼거나 길이를 맞추는 atrim·apad를 적용하지 않는다. 표시 시각과 원본 기준 샘플 수를 따로 비교한다.
3. 클립 내부에서 sourceInFrame을 반영한 원본 PCM과 정규화 상관을 계산한다. 첫·끝 경계 및 페이드에서 떨어진 구간에서 기대 위치 ±2프레임을 탐색한다. T137은 상관 >0.9 및 지연 0샘플을 확인했다. 같은 고정 프로필에서는 이를 우선한다. 새 fixture에서 잔차 허용이 필요하면 원본·출력 비교 실측을 남기고 최대 1ms(48샘플)를 별도 제안 기준으로 쓴다. 1프레임 경계 오차만 검사하면 1024샘플(21.33ms)의 정렬 오류를 놓칠 수 있다.
4. 시작과 끝은 양 채널의 짧은 RMS 창으로 탐지한다. 창 10ms, 이동 간격 1ms, 시작값 예시 -50dBFS를 두고 해당 fixture의 활성·무음 중앙부에서 충분히 구분되는지 먼저 확인한다. 두 경계 각각 기대 시각과의 차이 ≤1프레임(33.33ms)을 시험 허용으로 제안한다. 경계 +/-1프레임을 뺀 앞·사이·뒤 무음 구간에서 RMS가 기준을 넘는 창이 없는지 확인한다. 빈 무음 구간이 생기지 않도록 fixture에 여유를 둔다. 실제 PCM의 AAC 번짐 때문에 완전 영점 비교는 PCM 믹스에서만 적용한다.
5. 출력 SHA-256과 타임라인 ID·리비전, 예상/관측 시작·끝, 내부 상관과 지연, 무음 구간 최대 RMS, PCM 샘플 수와 도구 버전을 남긴다. 합성 구간의 정확도 검증이며 목소리 의미 동기화나 휴대폰 청취 판정에는 별도 근거가 필요하다.

기존 근거로 T134는 AAC initial_padding=1024, -60dBFS 최초 초과점의 앞쪽 차이 최대 256샘플 및 내부 상관 지연 0을 확인했다. T137은 실제 파일 900×1600샘플과 음악 원본의 이동량을 확인했다. 기존 T172 4초 MP4를 읽어서 영상·음성 stream start_time=0, AAC 첫 packet PTS=-1024와 skip_samples=1024, 실제 디코드 192000샘플/채널을 재확인했다. [DSP 시험](../../tests/p2-5b-audio-dsp.test.ts) · [실제 렌더 시험](../../tests/p2-5c-render-audio-e2e.test.ts) · [T172 샘플](T-172-TEXT-ONLY-RERENDER.md) · [FFmpeg 패딩 필드](https://www.ffmpeg.org/doxygen/9.0/structAVCodecParameters.html) · [QuickTime AAC 표시 샘플](https://developer.apple.com/documentation/quicktime-file-format/using_track_structures_to_represent_encode_delay_explictly)

> 플래너 전달문 — 기존 AAC 출력에서 packet의 1024샘플 priming은 정상 디코드로 제거됐습니다. 30fps 경계는 1프레임 이내, 내부 신호 정렬은 0샘플 기준, 무음은 경계 1프레임을 제외한 RMS로 별도 확인하는 합성 시험을 권장합니다.
