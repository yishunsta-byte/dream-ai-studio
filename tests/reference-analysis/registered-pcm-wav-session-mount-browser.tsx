// 등록 WAV 보호 분석 · 세션 확인 중 최초 마운트·POST 403 시험용 브라우저 진입점.
// 클라우드 레이아웃과 같은 SessionBoundary → ProtectedContent 안에 보호 목록 화면을 둔다. 주소에 ?defer=1이 있으면
// 화면을 바로 그리지 않고 window "fixture-mount" 이벤트 때 그린다(레이아웃이 유지된 채 페이지만 바뀌는 클라이언트 이동과 같은 순간).
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProtectedContent, SessionBoundary } from "../../components/auth/session-boundary";
import { StudioProtectedMaterialsAnalysis } from "../../components/reference-analysis/studio-protected-materials-analysis";
import "../../app/globals.css";

function Deferred() {
  const [mounted, setMounted] = useState(() => !new URLSearchParams(window.location.search).has("defer"));
  useEffect(() => {
    const mount = () => setMounted(true);
    window.addEventListener("fixture-mount", mount);
    return () => window.removeEventListener("fixture-mount", mount);
  }, []);
  return mounted ? <StudioProtectedMaterialsAnalysis listUri="/api/studio/reference-analysis/materials"
    analyzeUri="/api/studio/reference-analysis" transport={(uri, init) => fetch(uri, init)} timeoutMs={8_000} />
    : <p data-fixture-deferred="">자료 화면 준비 전</p>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<SessionBoundary account={root.dataset.account || null}><ProtectedContent><Deferred /></ProtectedContent></SessionBoundary>);
