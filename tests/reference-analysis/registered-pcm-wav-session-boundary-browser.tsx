// 등록 WAV 같은 문서 세션 경계 시험용 브라우저 진입점. 클라우드 레이아웃과 같은 순서로 SessionBoundary → ProtectedContent →
// 보호 목록 화면을 그린다. 계정 표시값(합성 이메일)은 서버가 쿠키 세션에 따라 data-account로만 준다(레이아웃의 account와 같은 역할).
import { createRoot } from "react-dom/client";
import { ProtectedContent, SessionBoundary } from "../../components/auth/session-boundary";
import { StudioProtectedMaterialsAnalysis } from "../../components/reference-analysis/studio-protected-materials-analysis";
import "../../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<SessionBoundary account={root.dataset.account || null}><ProtectedContent>
  <StudioProtectedMaterialsAnalysis listUri="/api/studio/reference-analysis/materials"
    analyzeUri="/api/studio/reference-analysis" transport={(uri, init) => fetch(uri, init)} timeoutMs={8_000} />
</ProtectedContent></SessionBoundary>);
