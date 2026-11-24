# T251 승인 작품 목록 공개 홈 연결

- 담당: Codex(Front)(term_a0a6f98c) · 배정: CX-MASTER-01 `msg_08af69da29af` · t241 1줄 범위 승인 `msg_1a5dbdbabb84`
- 상태: **ready_review**
- 코드 커밋: `dda8096`(4경로)
- 이 보고는 별도 커밋이에요. 합쳐서 5경로예요.

## 바꾼 것(5경로)
| 경로 | 내용 |
|---|---|
| `lib/public-showcase/showcase-feed.ts`(신규) | `import "server-only"`. `PUBLISHED_WORK_RECORDS`(명시적 공개 목록, 지금은 얼린 빈 배열)와 `buildShowcaseFeed(records?, policy?)` |
| `app/(public)/page.tsx` | `SAMPLE_WORKS` 직접 전달 대신 서버에서 `buildShowcaseFeed()` 결과의 `works`만 `NeonShowcase`에 넘겨요. |
| `tests/public-showcase/showcase-feed.test.ts`(신규) | 6건 |
| `tests/t241-public-home-route.test.ts` | 홈 import 기대값 1줄. `works` 대신 `showcase-feed`로 바꿨어요(Master 승인). |
| `docs/handoffs/T251-PUBLIC-SHOWCASE-FEED.md`(신규) | 이 보고 |

## 동작
- 공개 목록을 T249 변환기 `toPublishedWorks`로 그대로 걸러요. 기준은 published·승인 시각·권리 확인·철회·완료·공개 주소예요.
- 통과한 작품이 1개 이상이면 **그 작품만** 보여 줘요(`source: "published"`). 예시와 섞지 않아요.
- 통과한 작품이 없으면 **예시 6개**를 그대로 보여 줘요(`source: "sample"`, 같은 `SAMPLE_WORKS` 객체).
  - 목록이 비었을 때, 모두 미승인·철회됐을 때, 목록 모양이 아닐 때가 여기에 해당해요.
- 제외 이유와 원자료(소유자 메일, 저장 경로)는 화면 props로 넘기지 않아요.
- 재생 화면은 T250 `NeonShowcase`를 그대로 써요. 승인 작품의 `media`가 그대로 전달돼요.
- 현재 승인 작품 공급원이 없어요. 그래서 기본 목록은 비어 있고, **운영 화면은 지금과 똑같이 예시 6개**예요.

## 시험
- **`showcase-feed.test.ts` 6건**
  1. 기본 목록이 비어 있고 얼려 있으며, 그래서 예시가 나와요.
  2. 승인 1건과 초안·철회·권리 미확인·렌더 중이 섞이면 승인 1건만 나와요. sample은 false이고, 미디어는 유지되고, 노출되는 것이 없어요.
  3. 모두 제외되거나 목록이 아닌 입력 5종이면 예시로 대신해요.
  4. 승인 시각이 미래인 작품은 그 시각 전까지 나오지 않아요.
  5. 실제 화면 렌더에서 승인 작품은 예시 표시 없이 나오고, 예시 목록일 때는 예시 표시가 있어요.
  6. 연결 범위: 홈 import는 `next`·`neon-showcase`·`showcase-feed`이고, `buildShowcaseFeed()` 결과만 넘겨요. feed의 import는 정확히 `server-only`·`published-works`·`works`이고, fetch·supabase·fs·env·db를 쓰지 않아요.
- **결과:** `tests/public-showcase` 3파일 + `t241-public-home-route` + `t243-admin-login` = 5파일 **65 passed (65)**
- tsc는 공유 `.next` 생성 파일 오류 말고는 0건이에요. 범위 eslint 0이에요.
- **저장소 밖 사본 빌드**(`dda8096` archive, scratchpad)
  - `npm run build` exit 0, 경고 0, BUILD_ID `jt4MpCz3Uf6A9YRGp82cT`
  - `/`는 기존처럼 dynamic(ƒ)이에요.
- **`next start` 익명 HTTP**(127.0.0.1:43251, 가짜 Supabase 주소)
  - `/` 200이고, 예시 대표 작품 "NEON AFTER HOURS"·"대표 작품 · 예시"·관리자 로그인·작업실 로그인 링크가 있어요.
  - `/admin` 307 → `/admin/login?next=%2Fadmin`

## 후속 실제 공급원 연결 지점
1. **공개 승인 기록 저장소**(별도 승인 필요): 승인자 권한, 권리 확인, 철회, 공개 파일 위치가 들어가요. DB 테이블과 RLS, 또는 관리자가 관리하는 서버 설정이 될 수 있어요.
2. **서버 전용 담당 함수:** 그 기록을 읽어 T249 원자료 모양(`id`·`publication`·`artifact`·`display`)으로 만들어요.
   - 그다음 `app/(public)/page.tsx`에서 `buildShowcaseFeed(await loadPublishedRecords(), { allowedOrigins })`처럼 넘기면 돼요.
   - 화면·변환기는 바꾸지 않아요.
   - 바깥 CDN을 쓰면 정책 `allowedOrigins`에 https 정확한 출처만 넣어요.
3. **공개 파일 발행 작업:** 완성 파일을 `/media/public/`·`/showcase/` 또는 허용 CDN 공개 위치로 복사해요. 비공개 저장소의 서명 주소는 쓰지 않아요.
4. 공급원이 비동기가 되면 홈의 캐시와 다시 읽기 주기를 정해야 해요. 승인 철회가 바로 반영돼야 하기 때문이에요.

## 범위
- 실제 자료 게시, 운영 배포, 개인 DB·PC 자료 읽기, 운영 설정은 하지 않았어요.
- 공유 `.next`·3013·50963·ego는 쓰지 않았어요. 빌드는 저장소 밖 사본에서만 했어요.
