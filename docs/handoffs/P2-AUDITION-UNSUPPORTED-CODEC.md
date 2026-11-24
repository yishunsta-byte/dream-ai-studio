# P2 유효한 WAV의 브라우저 미지원 코덱 검증

T150의 미검증 V9 항목을 가상 프로젝트 사본에서 재현했다. FFmpeg로 gsm_ms 코덱의 8kHz, 2초 사인파 WAV를 생성했다. ffprobe가 코덱과 길이를 확인했고 FFmpeg 전체 디코딩이 종료 코드 0이었다. 로컬 자료 업로드 API가 파일 ID를 발급했다.

Chrome 157.0.8103.50의 편집 화면에서 제목 초안을 바꾸고, 새 WAV를 소리 목록에서 골라 ‘원본 듣기’를 실행했다. HTML 오디오 재생은 NotSupportedError, MediaError.code=4로 실패했다. 편집기에 ‘원본 미리듣기를 열지 못했어요’가 표시되고 입력했던 제목은 그대로였다.

‘다시 불러오기’로 오류가 사라지고 일시정지 상태가 됐다. 같은 파일을 재생하면 오류가 다시 표시됐다. ‘미리듣기 닫기’ 후 정상 합성 음원을 열었을 때 오류 안내가 사라지고 재생 위치가 0.071356초까지 진행했다. 초안 값은 끝까지 일치했다.

재현용 파일 생성 명령은 다음과 같다.

```powershell
ffmpeg -f lavfi -i sine=frequency=500:duration=2:sample_rate=8000 -c:a gsm_ms valid-gsm.wav
ffmpeg -v error -i valid-gsm.wav -f null -
```

시험은 로컬 Next 편집 화면과 자료 API를 사용했다. 브라우저와 코덱 조합별 지원 범위, 실제 스피커 청취는 별도다. 원자료 tmp/p2-codec/result.json.

> 플래너 전달문 — T150에서 남았던 유효한 파일의 미지원 코덱 오류를 실제 브라우저에서 확인했습니다. 오류·재시도·정상 음원 전환 동안 미저장 편집 문구가 유지됐습니다.
