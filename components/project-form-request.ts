import { v7 } from "uuid";
import type { ProjectInputErrors } from "@/lib/menus/inputs";

// One instance per mounted form. Keep the key if the response is lost.
export function createProjectFormRequest() {
  let previous: { body: string; key: string } | undefined;
  let busy = false;
  let saved = false;

  return async function submit(menuId: string, inputs: Record<string, unknown>) {
    if (busy || saved) return;
    busy = true;
    try {
      const body = JSON.stringify({ menuId, inputs });
      if (previous?.body !== body) previous = { body, key: v7() };
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": previous.key },
        body,
      });
      const result = await response.json();
      if (!response.ok) {
        const errors: ProjectInputErrors = result?.errors ?? { _form: "저장하지 못했어요. 다시 시도해 주세요." };
        return { errors };
      }
      if (typeof result?.id !== "string" || !result.id) throw new Error("Missing project ID");
      saved = true;
      return { id: result.id as string };
    } finally {
      busy = false;
    }
  };
}
