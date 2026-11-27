import { GeminiSettingsCard } from "./admin-gemini-settings";
import { StyleDnaEngineSettingsCards } from "./admin-style-dna-engine-settings";
import { StyleDnaGenerationSettingsCards } from "./admin-style-dna-generation-settings";
import styles from "./admin-platform-integrations.module.css";

export function AdminIntegrationCredentials() {
  return <div className={styles.engineCards} role="group" aria-label="텍스트·분석 플랫폼">
    <StyleDnaEngineSettingsCards />
    <GeminiSettingsCard />
  </div>;
}

// 이미지 생성 공급자 키(분석 엔진 키와 따로 저장·버전 관리). '이미지·음악·영상 생성 API' 절에 둔다.
export function AdminGenerationCredentials() {
  return <div className={styles.engineCards} role="group" aria-label="이미지 생성 플랫폼">
    <StyleDnaGenerationSettingsCards />
  </div>;
}
