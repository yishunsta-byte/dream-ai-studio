import { z } from "zod";
import { studioAnalysisResultSchema } from "./studio-analysis-result-dto";

const versionPrefix = "dream.local-url-analysis.version.";
const draftPrefix = "dream.local-url-analysis.draft.";
const savedVersion = z.strictObject({
  id: z.uuid(),
  url: z.string().max(4096).refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }),
  createdAt: z.iso.datetime(),
  result: studioAnalysisResultSchema,
});

type ParsedVersion = z.infer<typeof savedVersion>;
export type LocalUrlVersion = Omit<ParsedVersion, "result"> & {
  result: Extract<ParsedVersion["result"], { status: "ready" }>;
};

export function readLocalUrlVersions(storage: Storage): LocalUrlVersion[] {
  const versions: LocalUrlVersion[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(versionPrefix)) continue;
    const value = storage.getItem(key);
    if (value === null) continue;
    try {
      const entry = savedVersion.safeParse(JSON.parse(value));
      if (entry.success && entry.data.result.status === "ready" && key === versionPrefix + entry.data.id) {
        versions.push({ ...entry.data, result: entry.data.result });
      }
    } catch { /* A damaged entry does not hide other versions. */ }
  }
  return versions.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
}

export function saveLocalUrlVersion(storage: Storage, version: LocalUrlVersion) {
  storage.setItem(versionPrefix + version.id, JSON.stringify(savedVersion.parse(version)));
}

export function readLocalUrlDrafts(storage: Storage, version: LocalUrlVersion) {
  const drafts: Record<number, string> = {};
  version.result.proposals.forEach(({ selectionId }, index) => {
    const value = storage.getItem(`${draftPrefix}${version.id}.${selectionId}`);
    if (value !== null) drafts[index] = value;
  });
  return drafts;
}

export function saveLocalUrlDraft(storage: Storage, version: LocalUrlVersion, index: number, prompt: string) {
  storage.setItem(`${draftPrefix}${version.id}.${version.result.proposals[index].selectionId}`, prompt);
}
