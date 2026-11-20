import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabasePublicConfig } from "../auth/config";
import { createSupabaseServer } from "../auth/server";
import { containsNonPublicText } from "./publication-text";

const table = "reference_analysis_publications";
const columns = "id,title,summary,prompt,media,status,published_at";
const resultFields = {
  id: z.uuid(),
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(600),
  prompt: z.string().trim().min(1).max(2000),
  media: z.enum(["image", "music", "video"]),
};

export const publishReferenceAnalysisSchema = z.strictObject({ ...resultFields, authorized: z.literal(true) })
  .refine(({ title, summary, prompt }) => ![title, summary, prompt].some(containsNonPublicText));
export const revokeReferenceAnalysisSchema = z.strictObject({ id: resultFields.id });

const resultSchema = z.strictObject({
  ...resultFields,
  status: z.enum(["published", "revoked"]),
  published_at: z.iso.datetime({ offset: true }),
}).transform(({ published_at, ...result }) => ({ ...result, publishedAt: new Date(published_at).toISOString() }));

type Display = z.output<typeof resultSchema>;
type PublishInput = z.infer<typeof publishReferenceAnalysisSchema>;

export async function openReferencePublicationStore(ownerId: string) {
  const session = await createSupabaseServer();
  if (!session) return null;
  const { data, error } = await session.auth.getUser();
  if (error || data.user?.id.toLowerCase() !== ownerId) return null;
  const client = session;

  async function read(id: string) {
    const response = await client.from(table).select(columns).eq("id", id).maybeSingle();
    if (response.error) throw new Error("REFERENCE_PUBLICATIONS_READ");
    return response.data ? resultSchema.parse(response.data) : null;
  }

  async function list() {
    const response = await client.from(table).select(columns).order("published_at", { ascending: false }).limit(48);
    if (response.error) throw new Error("REFERENCE_PUBLICATIONS_LIST");
    return resultSchema.array().parse(response.data);
  }

  async function publish(input: PublishInput) {
    const { id, title, summary, prompt, media } = input;
    const response = await client.from(table).insert({ id, title, summary, prompt, media }).select(columns).single();
    if (!response.error) return resultSchema.parse(response.data);
    if (response.error.code !== "23505") throw new Error("REFERENCE_PUBLICATIONS_WRITE");
    const previous = await read(id);
    if (!previous || previous.status !== "published" || previous.title !== title || previous.summary !== summary ||
      previous.prompt !== prompt || previous.media !== media) return null;
    return previous;
  }

  async function revoke(id: string) {
    const response = await client.from(table).update({ status: "revoked" }).eq("id", id).eq("status", "published").select("id").maybeSingle();
    if (response.error) throw new Error("REFERENCE_PUBLICATIONS_REVOKE");
    if (response.data) return true;
    return (await read(id))?.status === "revoked";
  }

  return { list, publish, revoke };
}

export async function listPublishedReferenceAnalyses(): Promise<{ kind: "ok"; items: Display[] } | { kind: "unavailable" }> {
  try {
    const config = supabasePublicConfig();
    if (!config) return { kind: "unavailable" };
    const client = createClient(config.url, config.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(8000) }) },
    });
    const response = await client.from(table).select(columns).eq("status", "published").order("published_at", { ascending: false }).limit(24);
    if (response.error) return { kind: "unavailable" };
    const items = resultSchema.array().parse(response.data);
    return { kind: "ok", items: items.filter((item) => item.status === "published") };
  } catch { return { kind: "unavailable" }; }
}
