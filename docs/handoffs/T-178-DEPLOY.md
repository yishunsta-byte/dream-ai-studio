# T-178 배포 검증·실제 배포 (695e69b → 127.0.0.1:3013)

- 담당: CC-DATA-01 · 지시: CX-MASTER-01 msg_b30e382f2927
- 범위: 질문 msg_036cb3a13dd1에 Master가 "사용자 최신 배포 지시 있음"(msg_5ff81682b02f)으로 답했어요. 은영님께 직접 확인해서 **"리허설 후 실제 배포까지"**로 정했어요. "배포 후 실제 라이브 상태로 작업을 이어간다"는 지시도 함께 받았어요.
- 배포한 코드: HEAD `695e69b`. 작업트리에 남은 것은 커밋 안 된 다른 사람의 보고서 2개뿐이에요(제품 코드 아님).
- 제품 코드·migration·fixture·도구·패키지는 바꾸지 않았어요. 보고서만 커밋해요.

## 1. 배포 전 상태
- 3013은 저장소 폴더의 `next dev`였어요. 프로세스 트리는 cmd 37880 → next 3764 → server 55956이었어요.
- 작업 처리기(worker)는 떠 있지 않았어요.
- 실제 데이터 루트는 저장소 기본 폴더(`data/`)예요.
  - DB는 **단계 3**(0001~0003)이고, `integrity_check` ok
  - 프로젝트·장면·자료·작업 0개인 빈 DB
  - `storage/`·`backups/` 폴더는 없었어요.
  - 이 사실은 DB **사본**에서만 읽었어요.

## 2. 리허설 (OS 임시 폴더, 실제 데이터는 건드리지 않음)
- 앱 사본 준비
  - `git archive HEAD`
  - node_modules는 robocopy /XJ(266개)
  - `.tools`는 물리 복사(링크 0, ffmpeg sha `3256173f…`가 원본과 같음)
- 데이터: 실제 `data/app.db`·`-wal`·`-shm`을 임시 런타임으로 **복사**했어요.

| 단계 | 결과 |
|---|---|
| `db:migrate`(사본) | exit 0, "새 마이그레이션 7개"(3→10). 자동 복사본 `backups/pre-migrate/…_s3-s10.db`. 다시 실행하면 "0개" exit 0 |
| `next build`(Turbopack) + `verify-build` | 둘 다 exit 0 |
| `next start`(43178) + worker | `/`·`/settings`·`/jobs`·`/library`·`/history` 200, `/projects/new` 307. `/api/jobs` `workerOnline:true`. 시작 때 백업 작업 1개 성공 |
| 정리 | 리허설 프로세스 트리를 모두 멈췄어요(43178 리슨 0, worker 0). 사본 2개 삭제(사본 안 `.next/node_modules` 내부 링크를 먼저 끊음). 원본 node_modules 266개 그대로 |

렌더·내보내기 실제 실행은 리허설에서 하지 않았어요. 실제 DB에 프로젝트가 없고, 같은 경로는 T172/T174 실제 렌더 e2e로 이미 확인했어요.

## 3. 실제 배포 (저장소 폴더, 순서대로)
1. 3013 `next dev` 트리(3764)를 멈췄어요 → 3013 리슨 0
2. 실제 DB 수동 사본: `backups/pre-deploy-T178-20261117/`
   - `app.db` 290,816 B sha256 `9d1eb1b1…`
   - `-shm`, `-wal`(0 B)
3. `db:migrate`: exit 0, 새 마이그레이션 7개(3→10). 자동 복사본 `backups/pre-migrate/20261117T024503Z_s3-s10.db`(자동으로 지우지 않음)
4. `next build` exit 0, `verify-build` exit 0
   - 빌드가 `next-env.d.ts`를 HEAD 내용으로 되돌려서 작업트리 변경도 사라졌어요.
5. 운영 실행: 창 없는 별도 프로세스로 띄워서 이 세션이 끝나도 계속 돌아요.
   - 웹: `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3013` → PID **51032**
   - 작업 처리기: `node --conditions=react-server --env-file-if-exists=.env.local --import tsx worker/main.ts` → PID **62484**
   - 로그: `tmp/t178/live-web.*.log`, `live-worker.*.log`. PID 기록: `tmp/t178/live-pids.txt`
6. 확인
   - 페이지: `/`·`/settings`·`/jobs`·`/library`·`/history` 200, `/projects/new` 307
   - `/api/jobs` `workerOnline:true`, 시작 백업 1개 성공
   - worker 로그 "샘플 작업 처리기 시작 · 동시 작업 1개"
   - `.env.local` 없음 안내(정상, 샘플 모드)
   - ego-browser 1280/390: 제목 "Dream AI Studio", h1 "작업실", 가로 넘침 -15/0
   - 화면 캡처 `tmp/t178/live-home-1280.png`를 직접 열어 확인: "이 환경의 백업 성공", 빈 프로젝트 안내, 샘플 모드 배지

## 4. 되돌리기 (필요할 때)
1. PID 51032·62484를 멈춰요.
2. `data/app.db`를 `backups/pre-deploy-T178-20261117/app.db`(또는 `backups/pre-migrate/…_s3-s10.db`)로 되돌려요.
3. 이전 코드로 다시 띄워요.
- 단계 10 DB는 옛 앱이 열지 않아요(호환 게이트). 그래서 되돌릴 때는 **DB와 코드를 함께** 되돌려야 해요.

## 5. 이후 작업 시 주의
- 3013은 이제 **운영 모드(`next start`)**예요. 코드를 바꿔도 자동으로 반영되지 않아요.
  - 반영하려면 다시 빌드한 뒤 두 프로세스를 재시작해야 해요.
  - 공유 `.next`에서 빌드하면 실행 중인 서버에 영향을 줘요. 다음 배포 때는 서버를 멈춘 뒤 빌드해요.
- 다른 담당이 3013을 `next dev`로 다시 띄우면 운영 빌드 `.next`와 섞여요. 개발 서버는 다른 포트를 써야 해요.
- 작업 처리기가 떠 있어야 렌더·내보내기·백업 작업이 진행돼요.
- 실제 휴대폰 재생, 청취, 화면 읽기 프로그램 확인은 여전히 미검증이에요.
