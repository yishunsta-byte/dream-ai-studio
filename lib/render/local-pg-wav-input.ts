import "server-only";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { z } from "zod";
import type { MixRequest } from "@/lib/audio/mix";
import { FPS, MAX_OUTPUT_FRAMES } from "@/lib/audio/profile";
import { isVerifiedActor, type VerifiedActor } from "@/lib/db/postgres/types";
import { requiredDisclosures } from "@/lib/edit/schema";
import { canonicalJson, outputFrames, timelineV2Schema, totalFrames } from "@/lib/edit/timeline";
import { inspectPcmWav } from "@/lib/services/postgres/pcm-wav";

const expectedSchema = z.strictObject({ projectId: z.uuidv7(), timelineId: z.uuid(), contentRevision: z.number().int().positive().safe() });
type Expected = z.infer<typeof expectedSchema>;
type Connection = { port: number; password: string };
type Source = { id: string; sha256: string; sizeBytes: number; durationMs: number; content: Buffer | null };

class RenderInputError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROJECT_MISSING" | "STALE_TIMELINE" | "INVALID_TIMELINE" | "SOURCE_UNAVAILABLE" | "SOURCE_CHANGED" | "READ_UNAVAILABLE" | "REQUIRED_DISCLOSURE_MISSING") {
    super(code);
  }
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

async function snapshot(connection: Connection, actor: VerifiedActor, expected: Expected, includeBytes: boolean) {
  const client = new Client({ host: "127.0.0.1", database: "dream_test_t367", user: "local_wav_render_read_login",
    port: connection.port, password: connection.password, ssl: false, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8s'");
    const { rows: [target] } = await client.query<{ ok: boolean }>(`SELECT
      inet_server_addr() = '127.0.0.1'::inet AND current_database() = 'dream_test_t367'
      AND current_setting('server_version_num')::int / 10000 = 17
      AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit)
      AND (SELECT array_agg(p.rolname::text) FROM pg_roles p WHERE p.oid <> r.oid AND pg_has_role(r.oid,p.oid,'MEMBER'))
        = ARRAY['local_wav_render_read']::text[] AS ok FROM pg_roles r WHERE r.rolname = session_user`);
    if (!target?.ok) throw new RenderInputError("READ_UNAVAILABLE");
    await client.query("SET LOCAL ROLE local_wav_render_read");
    await client.query("SELECT set_config('dream.actor_id',$1,true)", [actor.id]);
    const { rows: [row] } = await client.query<{
      current_timeline_rev_id: string | null; content_revision: string; aspect: string; inputs_json: string;
      timeline_json: string | null; timeline_sha256: string | null; revision: string | null; basis_revision: string | null; approved: boolean;
    }>(`SELECT p.current_timeline_rev_id,p.content_revision,p.aspect,p.inputs_json,t.timeline_json,t.timeline_sha256,t.revision,
        t.content_revision AS basis_revision, EXISTS(SELECT FROM dream.stage_states s WHERE s.owner_id=p.owner_id
          AND s.project_id=p.id AND s.stage='produce' AND s.status='approved') AS approved
      FROM dream.projects p LEFT JOIN dream.timeline_revisions t
        ON (t.owner_id,t.project_id,t.id)=(p.owner_id,p.id,p.current_timeline_rev_id)
      WHERE p.owner_id=$1 AND p.id=$2 AND p.archived_at IS NULL AND p.menu_id='shopping-shorts'`, [actor.id, expected.projectId]);
    if (!row) throw new RenderInputError("PROJECT_MISSING");
    if (row.current_timeline_rev_id !== expected.timelineId || Number(row.content_revision) !== expected.contentRevision)
      throw new RenderInputError("STALE_TIMELINE");
    if (!row.approved || !row.timeline_json || Number(row.basis_revision) !== expected.contentRevision ||
      sha256(row.timeline_json) !== row.timeline_sha256) throw new RenderInputError("INVALID_TIMELINE");
    const timeline = timelineV2Schema.safeParse(JSON.parse(row.timeline_json));
    if (!timeline.success || canonicalJson(timeline.data) !== row.timeline_json || timeline.data.aspect !== row.aspect ||
        !timeline.data.video.length || timeline.data.video.some(clip => !clip.assetId || !clip.sceneVersionId) || !timeline.data.audio.length)
      throw new RenderInputError("INVALID_TIMELINE");
    const frames = outputFrames(timeline.data);
    if (frames < 1 || frames > MAX_OUTPUT_FRAMES) throw new RenderInputError("INVALID_TIMELINE");
    const inputs = z.record(z.string(), z.unknown()).parse(JSON.parse(row.inputs_json));
    const videoFrames = totalFrames(timeline.data.video);
    for (const content of requiredDisclosures(inputs)) {
      const labels = timeline.data.text.filter(layer => layer.kind === "disclosure" && layer.content === content);
      if (labels.length !== 1 || !labels[0].locked || labels[0].timing.startFrame !== 0 ||
          labels[0].timing.endFrame < videoFrames)
        throw new RenderInputError("REQUIRED_DISCLOSURE_MISSING");
    }
    const ids = [...new Set(timeline.data.audio.map(clip => clip.assetId))];
    const { rows: sources } = await client.query<Source>(`SELECT a.id,f.digest AS sha256,f.size_bytes AS "sizeBytes",
        f.duration_ms AS "durationMs",CASE WHEN $4::boolean THEN f.content END AS content
      FROM local_wav.files f JOIN dream.assets a ON (a.owner_id,a.id)=(f.owner_id,f.asset_id)
      JOIN dream.project_assets l ON (l.owner_id,l.asset_id)=(a.owner_id,a.id)
      WHERE a.owner_id=$1 AND l.project_id=$2 AND a.id=ANY($3::uuid[]) AND l.purpose='productionAudio'
        AND a.archived_at IS NULL AND a.is_mock=0 AND a.kind='audio' AND a.mime='audio/wav'
        AND (a.sha256,a.size_bytes,a.duration_ms)=(f.digest,f.size_bytes,f.duration_ms)
        AND a.file_path=a.owner_id::text||'/assets/'||a.id::text||'/'||f.digest||'.wav'
      ORDER BY a.id`, [actor.id, expected.projectId, ids, includeBytes]);
    if (sources.length !== ids.length) throw new RenderInputError("SOURCE_UNAVAILABLE");
    await client.query("COMMIT");
    return { timeline: timeline.data, timelineSha256: sha256(row.timeline_json), timelineRevision: Number(row.revision), frames, sources };
  } catch (error) {
    if (error instanceof RenderInputError) throw error;
    throw new RenderInputError("READ_UNAVAILABLE");
  } finally {
    await client.end().catch(() => undefined);
  }
}

type Prepared = Pick<MixRequest, "audio" | "audioJoins" | "outputFrames" | "sources" | "workRoot"> & {
  timeline: z.infer<typeof timelineV2Schema>; timelineSha256: string; timelineRevision: number;
};

/** Trusted local caller supplies a pinned silent video. This adapter stages only the saved PG soundtrack. */
export async function useLocalPgWavRenderInput<T>(connection: Connection, actor: VerifiedActor, request: Expected,
  consume: (prepared: Prepared) => Promise<T>): Promise<T> {
  if (!isVerifiedActor(actor) || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535 || !connection.password)
    throw new RenderInputError("INVALID_REQUEST");
  const expected = expectedSchema.safeParse(request);
  if (!expected.success) throw new RenderInputError("INVALID_REQUEST");
  const input = await snapshot(connection, actor, expected.data, true);
  const workRoot = await mkdtemp(join(tmpdir(), "dream-pg-wav-render-"));
  try {
    const sources: MixRequest["sources"] = {};
    for (const { id, content, sha256: hash, sizeBytes, durationMs } of input.sources) {
      const wav = content && inspectPcmWav(content);
      if (!content || !wav || content.length !== sizeBytes || sha256(content) !== hash ||
          Math.max(1, Math.round(wav.frames * 1000 / wav.sampleRate)) !== durationMs ||
          input.timeline.audio.some(clip => clip.assetId === id &&
            (clip.sourceInFrame + clip.durationFrames) * wav.sampleRate > wav.frames * FPS))
        throw new RenderInputError("SOURCE_CHANGED");
      const path = join(workRoot, `${id}.wav`);
      await writeFile(path, content, { flag: "wx", mode: 0o600 });
      sources[id] = { path, sha256: hash, sizeBytes };
    }
    const result = await consume({ timeline: input.timeline, timelineSha256: input.timelineSha256, timelineRevision: input.timelineRevision,
      outputFrames: input.frames, audio: input.timeline.audio, audioJoins: input.timeline.audioJoins, sources, workRoot });
    const current = await snapshot(connection, actor, expected.data, false);
    if (current.timelineSha256 !== input.timelineSha256) throw new RenderInputError("STALE_TIMELINE");
    if (current.sources.some((source, index) => source.id !== input.sources[index].id ||
        source.sha256 !== input.sources[index].sha256 || source.sizeBytes !== input.sources[index].sizeBytes))
      throw new RenderInputError("SOURCE_CHANGED");
    return result;
  } finally {
    await rm(workRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}
