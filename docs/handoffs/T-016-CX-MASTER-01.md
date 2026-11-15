# T-016 · 복원 출처·중단 기록 안내와 자동 백업 주체

담당 CX-MASTER-01, parent P1종료,2026-11-16. T014 데이터 보고 D1/D2를 읽고 기존 권한 안에서 직접 수정했다. 코드작성자의 자체검증이며 독립검수는 아니다.

결정: 백업 스냅샷 당시 running이었던 관리 행을 succeeded로 바꾸지 않는다. 복원 출처·시각은 검증된 restore.info에서 별도로 보여주고 복원본의 중단 기록과 실제 백업 실패를 구분한다. 원본 백업/DB/완료결과를 변경하지 않는다. 향후 구버전 호환은 T017 준비명세이며 P2구현승인이 아니다.

변경: services/backups.ts의 RESTORE_INTERRUPTED 오류 우선순위를 사용자취소보다 앞에 두고 interruptedByRestore DTO와 lastFailure 제외로 관리중단을 새 실패로 표시하지 않는다. 정상취소·실제실패는 유지. 자동 enqueue actor는 worker, 수동은local-user. settings panel의 중단행은 warning/복원으로중단·설명, settings page 상단은 출처백업/복원시각과 기록 해석 안내. 허용파일4개 외제품코드변경없음, T015 production/export와 비중첩.

검증: backup-service에 회귀2개 추가. backup/restore/history3파일46검사, 전체23파일193검사, typecheck/lint/build 성공·빌드경고0/사적추적0. 기존 가상복원본을 별도3041로 열어1280/390에서 실제 안내·출처/복원시각·복원중단목록·실제lastSuccess·lastFailure 구분·가로넘침0 확인. tmp/t016-1280.png, t016-390.png. 검증서버/브라우저 종료. 실제사용자data미접근.

미완료: T015 F0161/2코딩세션은 플랫폼 명령승인 대기. V13잔여와 독립재검수·은영님 흐름확인/디자인승인 전P2금지 유지. T016수정은 독립재검수 대상에 추가한다.

전달문: T014의D1/D2를 Master가T016으로수정했습니다. 이력을성공으로바꾸지않고출처설명·복원중단/실패구분·자동worker기록을보완했습니다. 전체193검사/build/lint/typecheck·1280/390실제복원본확인통과, 자체검증이며P1전체통과아닙니다.
