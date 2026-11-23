import { GeminiSettingsCard } from "./admin-gemini-settings";
import { StyleDnaEngineSettingsCards } from "./admin-style-dna-engine-settings";
import styles from "./admin-platform-integrations.module.css";

export function AdminIntegrationCredentials() {
  return <div className={styles.engineCards} role="group" aria-label="텍스트·분석 플랫폼">
    <StyleDnaEngineSettingsCards />
    <GeminiSettingsCard />
  </div>;
}
