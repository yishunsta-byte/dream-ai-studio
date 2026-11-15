# 로컬 미디어 도구

확인일: 2026-11-15.

- FFmpeg 공식 배포 안내: https://ffmpeg.org/download.html
- 안내된 Windows 빌드: https://www.gyan.dev/ffmpeg/builds/
- 사용 버전:9.0.2 essentials, ZIP https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip
- 게시된 SHA256:60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba
- 로컬 설치:scripts/install-media.ps1. 해당 ZIP의 두 실행 파일과 LICENSE만 .tools/ffmpeg에 추출한다. ZIP의 SHA256을 확인했고 ffprobe -version의9.0.2를 실행 확인했다. GPL 라이선스는 배포 ZIP에 들어 있는 원문을 함께 보관한다. 도구는 Git 및 Next 빌드 추적에서 제외한다.

실행은 child_process.execFile로 직접 하며 shell을 사용하지 않는다. ffprobe는30초 제한·출력1MB 제한·file/pipe 프로토콜만 사용한다. 이미지 서명과 전체 디코딩·해상도는 file-type 및 Sharp, 오디오/영상 길이·해상도는 ffprobe로 검사한다. FFMPEG_PATH/FFPROBE_PATH로 다른 환경의 설치 위치를 지정할 수 있다.
