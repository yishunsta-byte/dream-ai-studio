# 구현 의존성 확인 기록

## P1-8 ZIP 작성·검증 · 2026-11-15

- zip-stream **7.0.5**, yauzl **3.4.0**: npm 공식 레지스트리 버전·Node engines·MIT 라이선스 확인 후 정확 버전 고정. ZIP64 스트리밍 작성과 중앙 디렉터리 기반 순차 읽기/크기 검증에 사용한다. 형식은 zod와 파일 SHA256으로 추가 검증한다.
- 타입: @types/zip-stream **7.0.0**, @types/yauzl **3.4.0**, 개발 의존성 고정.
- 공식 근거: [zip-stream 소스·API](https://github.com/archiverjs/node-zip-stream), [yauzl 소스·크기/경로 검증 문서](https://github.com/thejoshwolfe/yauzl). 설치된 각 패키지 README와 실제 export도 확인했다.
- 디렉터리 glob 기능을 가진 archiver 8은 검토 중 하위 minimatch 운영 취약점이 확인돼 최종 의존성에서 제거했다. 실제 파일 목록을 직접 스트리밍하는 zip-stream으로 대체했고 강제 override/major 자동 수정은 하지 않았다.
- 최종 감사: 운영0, 전체개발 moderate7/high0/critical0(Q-001의 기존 범위). 설치 스크립트 추가 승인 대상 없음. ZIP64 헤더/스트리밍/재열기/실제 압축 해제를 작은 fixture로 검사했으며 실제4GB 이상 부하 시험을 의미하지 않는다.
