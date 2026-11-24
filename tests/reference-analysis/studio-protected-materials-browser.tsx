// 보호 목록 격리 HTTP 통합 시험용 브라우저 진입점. 서버가 준 HTML에는 자료 정보가 없고, 목록은 이 화면이 GET으로 받는다.
import { createRoot } from "react-dom/client";
import { StudioProtectedMaterialsAnalysis } from "../../components/reference-analysis/studio-protected-materials-analysis";
import "../../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<StudioProtectedMaterialsAnalysis listUri="/api/studio/reference-analysis/materials"
  analyzeUri="/api/studio/reference-analysis" transport={(uri, init) => fetch(uri, init)} timeoutMs={8_000} />);
