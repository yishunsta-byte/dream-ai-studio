import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { openDatabase, type DatabaseHandle } from "../../lib/db/connection";
import { isVerifiedActor, type VerifiedActor } from "../../lib/db/postgres/types";
import { referenceApplyPermissionGeneration } from "../../lib/reference-analysis/apply-lifecycle";
import { createPrivateReferencePreviewRecord, previewReferenceProject } from "../../lib/reference-analysis/project-preview";
import { analyzeRegisteredReferenceSnapshot } from "../../lib/reference-analysis/registered-snapshot";
import { syntheticReferenceApplyStore } from "../../lib/reference-analysis/synthetic-apply-store";
import { libraryRepository } from "../../lib/repo/library";
import { installSyntheticApplyTables, owner } from "./atomic-apply-fixture";

export const referencePurpose = "synthetic-rea-reference";
const registeredName = "registered-source.mp4";
const notAvailable = { status: "unavailable" } as const;
const validForMs = 120;
const contentDigest = (data: Buffer) => createHash("sha256").update(data).digest("hex");

type Registration = {
  storeId: string; restoreGeneration: string; ownerId: string; projectId: string; assetId: string;
  linkGeneration: string; scopePermissionGeneration: string; ownerPermissionGeneration: string; sourceRevision: string;
  sha256: string; filePath: string; sizeBytes: number; timelineId: string; contentRevision: number;
};
type CurrentAnalysis = {
  analysisId: string; analysisRevision: string; snapshotSha256: string;
  completedAtMs: number; validUntilMs: number;
};

function scopeOf(value: Registration) {
  const { storeId, restoreGeneration, ownerId, projectId, assetId } = value;
  return { storeId, restoreGeneration, ownerId, projectId, assetId };
}

function generationsOf(value: Registration) {
  const { linkGeneration, sourceRevision } = value;
  return { linkGeneration, permissionGeneration: referenceApplyPermissionGeneration(value), sourceRevision };
}

function receiptGenerationsOf(value: Registration) {
  const { linkGeneration, scopePermissionGeneration, ownerPermissionGeneration } = value;
  return { linkGeneration, scopePermissionGeneration, ownerPermissionGeneration };
}

export function installIsolatedReferenceFixture(
  handle: DatabaseHandle, managedRoot: string, projectId: string, assetId: string,
) {
  installSyntheticApplyTables(handle);
  handle.sqlite.exec(`
    CREATE TABLE rea_e2e_workspace (id INTEGER PRIMARY KEY CHECK (id = 1), store_id TEXT NOT NULL, restore_generation TEXT NOT NULL);
    CREATE TABLE rea_e2e_grant (
      project_id TEXT NOT NULL, asset_id TEXT NOT NULL, owner_id TEXT NOT NULL, active INTEGER NOT NULL,
      link_generation TEXT NOT NULL, permission_generation TEXT NOT NULL, owner_permission_generation TEXT NOT NULL, source_revision TEXT NOT NULL,
      PRIMARY KEY (project_id, asset_id),
      FOREIGN KEY (project_id) REFERENCES projects(id), FOREIGN KEY (asset_id) REFERENCES assets(id)
    );
    CREATE TABLE rea_e2e_analysis (
      project_id TEXT NOT NULL, asset_id TEXT NOT NULL, scope_json TEXT NOT NULL, generations_json TEXT NOT NULL, analysis_json TEXT NOT NULL,
      PRIMARY KEY (project_id, asset_id), FOREIGN KEY (project_id, asset_id) REFERENCES rea_e2e_grant(project_id, asset_id)
    );
  `);
  const content = readFileSync(join(managedRoot, registeredName));
  libraryRepository(handle).insertAsset({
    id: assetId, kind: "video", title: "private synthetic registration", role: "original", origin: "upload",
    mime: "video/mp4", filePath: registeredName, sha256: contentDigest(content), sizeBytes: content.length,
  });
  handle.sqlite.prepare("INSERT INTO project_assets(project_id,asset_id,purpose) VALUES (?,?,?)").run(projectId, assetId, referencePurpose);
  handle.sqlite.prepare("INSERT INTO rea_e2e_workspace VALUES (1,'fixture-store','restore-1')").run();
  handle.sqlite.prepare("INSERT INTO rea_e2e_grant VALUES (?,?,?,1,'link-1','grant-1','owner-grant-1','source-1')").run(projectId, assetId, owner.id);
}

function lookupRegistration(handle: DatabaseHandle, actor: VerifiedActor, projectId: string, assetId: string) {
  if (!isVerifiedActor(actor)) return undefined;
  return handle.sqlite.prepare<[string, string, string, string], Registration>(`
    SELECT w.store_id AS storeId, w.restore_generation AS restoreGeneration,
      g.owner_id AS ownerId, p.id AS projectId, a.id AS assetId, g.link_generation AS linkGeneration,
      g.permission_generation AS scopePermissionGeneration, g.owner_permission_generation AS ownerPermissionGeneration,
      g.source_revision AS sourceRevision,
      a.sha256, a.file_path AS filePath, a.size_bytes AS sizeBytes,
      p.current_timeline_rev_id AS timelineId, p.content_revision AS contentRevision
    FROM rea_e2e_grant g
    JOIN projects p ON p.id = g.project_id
    JOIN project_assets pa ON pa.project_id = p.id AND pa.asset_id = g.asset_id AND pa.purpose = ?
    JOIN assets a ON a.id = pa.asset_id
    JOIN rea_e2e_workspace w ON w.id = 1
    WHERE g.owner_id = ? AND p.id = ? AND a.id = ? AND g.active = 1 AND p.archived_at IS NULL
      AND a.archived_at IS NULL AND a.kind = 'video' AND a.mime = 'video/mp4'
  `).get(referencePurpose, actor.id, projectId, assetId);
}

function managedPath(root: string, registration: Registration) {
  // This fixture registers exactly one synthetic file below its test-owned directory.
  if (registration.filePath !== registeredName || registration.sizeBytes <= 0 || registration.sizeBytes > 1_048_576) return;
  const path = join(root, registeredName);
  try {
    const info = lstatSync(path);
    if (info.isFile() && info.nlink === 1 && info.size === registration.sizeBytes &&
      dirname(realpathSync(path)) === realpathSync(root)) return path;
  } catch { /* A missing or inaccessible managed synthetic file has no authority. */ }
}

function contentMatches(root: string, registration: Registration) {
  const path = managedPath(root, registration);
  if (!path) return false;
  try { return contentDigest(readFileSync(path)) === registration.sha256; }
  catch { return false; }
}

const authorityKey = (r: Registration) => JSON.stringify({ ...scopeOf(r), ...generationsOf(r), sha256: r.sha256 });

export function isolatedApplyStore(handle: DatabaseHandle, managedRoot: string, nowMs: () => number) {
  return syntheticReferenceApplyStore(handle, {
    nowMs, receiptRetentionMs: 200,
    resolveAuthority(db, actor, requested) {
      if (db !== handle || !db.sqlite.inTransaction) throw new Error("Fixture authority must share the apply transaction");
      const registration = lookupRegistration(db, actor, requested.projectId, requested.assetId);
      if (!registration) return null;
      const scope = scopeOf(registration);
      const stored = db.sqlite.prepare<[string, string], {
        scope_json: string; generations_json: string; analysis_json: string;
      }>(`SELECT scope_json, generations_json, analysis_json FROM rea_e2e_analysis
          WHERE project_id = ? AND asset_id = ?`).get(scope.projectId, scope.assetId);
      const execution = stored && stored.scope_json === JSON.stringify(scope) && contentMatches(managedRoot, registration) ? {
        kind: "verified", ...generationsOf(registration), registeredSha256: registration.sha256,
        analysis: { status: "active", ...JSON.parse(stored.generations_json), ...JSON.parse(stored.analysis_json) },
        timeline: { timelineId: registration.timelineId, contentRevision: registration.contentRevision },
      } : undefined;
      return { kind: "verified", scope, receiptAccess: "granted", receiptGenerations: receiptGenerationsOf(registration), execution };
    },
  });
}

export async function prepareIsolatedCut(
  handle: DatabaseHandle, managedRoot: string, actor: VerifiedActor, nowMs: () => number,
  request: { projectId: string; assetId: string; selectionId: string; moveSceneId: string; afterSceneId: string },
) {
  const { projectId, assetId, selectionId, moveSceneId, afterSceneId } = request;
  const registration = lookupRegistration(handle, actor, projectId, assetId);
  const path = registration && managedPath(managedRoot, registration);
  if (!registration || !path) return notAvailable;
  const analysis = await analyzeRegisteredReferenceSnapshot(path,
    { kind: "file", name: registeredName, sizeBytes: registration.sizeBytes, permission: "synthetic" },
    { sha256: registration.sha256, sourceGeneration: registration.sourceRevision }, { managedRoot });
  if (analysis.status !== "bound" || analysis.analysis.media !== "video") return notAvailable;

  const completedAtMs = nowMs();
  const currentAnalysis: CurrentAnalysis = {
    analysisId: randomUUID(), analysisRevision: randomUUID(), snapshotSha256: analysis.proof.snapshotSha256,
    completedAtMs, validUntilMs: completedAtMs + validForMs,
  };
  const previewScope = {
    projectId, sourceId: assetId, sourceRevision: analysis.proof.sourceGeneration, analysisRevision: currentAnalysis.analysisRevision,
  };
  const record = createPrivateReferencePreviewRecord(actor, previewScope, completedAtMs, analysis.analysis);
  const preview = previewReferenceProject(record, actor, { scope: previewScope, nowMs: nowMs(), maxAgeMs: validForMs }, [selectionId]);
  if (preview.status !== "ready" || preview.proposals[0]?.inference?.measure !== "candidate_cut") return notAvailable;

  const confirmation = isolatedApplyStore(handle, managedRoot, nowMs).prepare(actor, {
    schemaVersion: 1, confirmationId: randomUUID(), scope: scopeOf(registration), status: "pending",
    issuedAtMs: nowMs(), executionExpiresAtMs: completedAtMs + validForMs,
    basis: {
      ...generationsOf(registration), analysisId: currentAnalysis.analysisId, analysisRevision: currentAnalysis.analysisRevision,
      snapshotSha256: currentAnalysis.snapshotSha256, timelineId: registration.timelineId, contentRevision: registration.contentRevision,
    },
  }, { selectionId, moveSceneId, afterSceneId }, db => {
    const current = lookupRegistration(db, actor, projectId, assetId);
    if (!current || authorityKey(current) !== authorityKey(registration) || !contentMatches(managedRoot, current)) return false;
    return db.sqlite.prepare(`
      INSERT INTO rea_e2e_analysis(project_id,asset_id,scope_json,generations_json,analysis_json) VALUES (?,?,?,?,?)
      ON CONFLICT(project_id,asset_id) DO UPDATE SET
        scope_json = excluded.scope_json, generations_json = excluded.generations_json, analysis_json = excluded.analysis_json
    `).run(projectId, assetId, JSON.stringify(scopeOf(current)), JSON.stringify(generationsOf(current)), JSON.stringify(currentAnalysis)).changes === 1;
  });
  return confirmation.status === "prepared" ? { ...confirmation, preview } : notAvailable;
}

export function runIsolatedReferenceWorker(path: string, root: string, action: string, confirmationId: string, now: number) {
  const handle = openDatabase(path, { fileMustExist: true });
  try {
    const store = isolatedApplyStore(handle, root, () => now);
    if (action === "apply") {
      const result = store.apply(owner, confirmationId, true);
      if (result.status !== "applied") throw new Error("Fixture confirmation was rejected in the apply process");
      return; // Deliberately discard the committed response.
    }
    if (action !== "receipt") throw new Error("Unrecognized fixture action");
    process.stdout.write(JSON.stringify(store.readReceipt(owner, confirmationId)));
  } finally { handle.close(); }
}
