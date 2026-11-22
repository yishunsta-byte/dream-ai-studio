"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { GeminiSettingsCard } from "./admin-gemini-settings";
import { StyleDnaEngineSettingsCards } from "./admin-style-dna-engine-settings";
import styles from "./admin-platform-integrations.module.css";

const platforms = [
  { id: "openai", name: "OpenAI", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", name: "Claude", keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", name: "Gemini", keyUrl: "https://aistudio.google.com/apikey" },
] as const;

export function AdminIntegrationCredentials() {
  const panel = useId();
  const [selected, setSelected] = useState<typeof platforms[number]["id"]>();
  const active = platforms.find(platform => platform.id === selected);
  return <>
    <div className={styles.engineButtons} role="group" aria-label="AI 플랫폼 선택">
      {platforms.map(platform => <Button key={platform.id} variant={platform.id === selected ? "primary" : "secondary"}
        aria-controls={panel} aria-pressed={platform.id === selected} onClick={() => setSelected(platform.id)}>
        {platform.name} 키·모델
      </Button>)}
    </div>
    <div id={panel}>
      {active && <>
        <a className={styles.setupLink} href={active.keyUrl} target="_blank" rel="noreferrer">{active.name} API 키 발급</a>
        {active.id === "gemini" ? <GeminiSettingsCard />
          : <StyleDnaEngineSettingsCards key={active.id} only={active.id} />}
      </>}
    </div>
  </>;
}
