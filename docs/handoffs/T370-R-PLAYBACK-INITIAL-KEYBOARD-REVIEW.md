# T370 최초 재생 키보드 독립 검수

기준은 `8918cde1be6d10ef01bd53b58bd7a42bb1bdf43c`의 `NeonShowcase` blob `ebcc35ea74a5cbcbce94ae3cafc394381ca4de89`이다. Next 16.4.6과 Chromium에서 390×844·1440×900, FFmpeg로 생성한 자체 시험 MP4(H.264)·M4A(AAC)를 사용했다. 매 키 시험마다 새 문서에서 상세를 열고 `preload=none`, 일시정지, `readyState=0`, 파일 요청 0을 확인했다. 시험 스크립트는 `play()`를 호출하지 않았다. [앞선 오류 복구 시험](T370-R-PLAYBACK-KEYBOARD-REVIEW.md)

| 비교 | 처음 입력 결과 |
| --- | --- |
| 고정 전체 사본의 Next 개발 서버 | 두 폭·두 매체에서 `VIDEO` 또는 `AUDIO` 자체에 첫 Tab이 닿았다. 그 상태의 Space·Enter 8건 모두 요청 0, 재생 시간 0이었다. 전후 Tab 순환에서도 브라우저 기본 **재생** 버튼에는 닿지 않았다. 음원의 **미디어 컨트롤 더보기**에는 닿았다. |
| 개발 서버에서 포인터를 쓰는 대조 | 브라우저 기본 **재생** 버튼을 클릭하니 네 조합에서 모두 첫 `Range: bytes=0-`이 206을 받았고 정상 재생됐다. |
| 브라우저 기본 미디어 대조 | 390px 시험 문서에서 같은 파일의 `controls preload=none tabindex=0`을 사용하니 요소 자체에서 Space·Enter 4/4가 첫 206과 재생으로 이어졌다. `tabindex`를 생략한 4/4도 동일했다. `preload=metadata` 대조에서는 첫 키 입력 전에 파일 요청이 발생했다. |
| 고정 UI의 격리 배포 모드 | 요소 자체에서 Space·Enter 7/8 재생. 390px 영상의 Space 한 번은 요청 없이 끝났다. 브라우저 접근성 트리에서 기본 **재생** 버튼임을 확인한 뒤 누른 Space·Enter는 두 폭·두 매체 8/8에서 첫 206과 실제 재생으로 이어졌다. 버튼까지 Tab은 2–6회였다. 역방향으로도 버튼과 요소, 닫기에 도달했다. |

개발 모드의 표준 Tab 경로에서는 최초 재생이 막혔다. 동일 속성의 기본 미디어 대조에서 재현되지 않았으므로 `preload=none` 또는 `tabindex=0`만으로는 설명되지 않는다. 초기 `.pause()`를 추가한 기본 미디어 대조에서도 재생이 시작됐으므로 Strict Mode의 정리 호출 하나를 원인으로 확정할 수 없다. 격리 배포 모드에서는 브라우저 재생 버튼을 통한 키보드 경로를 재현했다. 미디어 요소 자체의 단축키와 첫 Tab 순서는 초기 상태에 따라 달랐다.

전체 사본의 일반 `next build --webpack`은 컴파일 뒤 별도 `app/api/projects/route.ts`의 GET 매개변수 타입 검사에서 멈췄다. 동일한 미디어 컴포넌트·CSS, 글꼴, 잠금 파일과 합성 페이지·자료 경로만 담은 별도 UI 프로젝트는 표준 배포 빌드와 타입 검사를 통과했다. 위 배포 모드 관찰은 그 UI 프로젝트 범위다. 다른 브라우저·실기기·운영 배포는 미확인이다. 제품 소스와 운영 변경은 없었고 소유 루프백 서버 두 개를 종료했다.

증거는 로컬 `D:/starwork/t370-keyboard-8918cde-independent/assets/`에 보존했다. `cold-start-proof.json` SHA-256 `c995b07b762fb5edbdfc39274786f56b74c599c8c62c77c743c89d3857fdf36f`, `cold-start-production.json` SHA-256 `16e697921a2b4b5a822be6199ee1613b522bcb31f9882ae04d2e9aebebd79245`, `cold-start-native-controls.json` SHA-256 `4e526a4e902cbed669e337c33393bbfc6a353172636df0ff463e731c3da6044f`다.
