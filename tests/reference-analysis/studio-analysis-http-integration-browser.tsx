import { createRoot } from "react-dom/client";
import { StudioRegisteredAnalysis } from "../../components/reference-analysis/studio-registered-analysis";
import { createStudioRegisteredAnalysisProvider } from "../../components/reference-analysis/studio-registered-analysis-provider";
import "../../app/globals.css";

const root = document.getElementById("root");
const { uri, projectId, assetId } = root?.dataset ?? {};
if (!root || !uri || !projectId || !assetId) throw new Error("Missing fixture configuration");

const copied: string[] = [];
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: async (text: string) => { copied.push(text); } },
});
Object.assign(window, { fixtureCopied: copied });

const provider = createStudioRegisteredAnalysisProvider({
  uri, transport: fetch, timeoutMs: 3_000,
  materials: [{ projectId, assetId, label: "합성 등록 이미지" }],
});
createRoot(root).render(<StudioRegisteredAnalysis provider={provider} />);
