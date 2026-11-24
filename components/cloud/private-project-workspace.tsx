"use client";
import { useState } from "react";
import type { MenuSnapshot } from "@/lib/menus/inputs";
import { ProjectForm } from "@/components/project-form";
import { PrivateWavPanel } from "./private-wav-panel";

export function PrivateProjectWorkspace({ snapshot }: { snapshot: MenuSnapshot }) {
  const [projectId, setProjectId] = useState<string>();
  return <>
    <ProjectForm privatePng snapshot={snapshot} choices={{assets: [], characters: []}} onCreated={setProjectId} />
    <PrivateWavPanel projectId={projectId} />
  </>;
}
