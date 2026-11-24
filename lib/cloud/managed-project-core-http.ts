import "server-only";
import { createHash } from "node:crypto";
import { v7 } from "uuid";
import { z } from "zod";
import { authDeniedResponse } from "@/lib/auth/api";
import { rejectCrossSite } from "@/lib/auth/config";
import { resolveServerAuth } from "@/lib/auth/resolve";
import { openManagedProjectCore } from "@/lib/cloud/managed-project-core";
import { readBoundedUpload } from "@/lib/cloud/read-bounded-upload";
import { withActorTransaction } from "@/lib/db/postgres/transaction";
import { actorFromVerifiedUserId, type ActorTransaction, type VerifiedActor } from "@/lib/db/postgres/types";
import { getMenuConfig } from "@/lib/menus/server";
import { snapshotForMenu } from "@/lib/menus/snapshot";
import type { ProjectCreateAsset } from "@/lib/repo/postgres/project-create";
import { isProjectCreateError, preparePostgresProjectCreate } from "@/lib/services/postgres/project-create";

const value = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()).max(100)]);
const createBody = z.strictObject({ menuId:z.string().min(1).max(80), inputs:z.record(z.string(),value) });
const briefBody = z.strictObject({ acknowledged:z.literal(true), revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const id = z.uuidv7();
const assetChoice = z.strictObject({id,title:z.string(),kind:z.enum(["image","video"])});
const assetPageSize = 100;
const noCache = { "cache-control":"private, no-store" };
const json = (value: unknown, status=200) => Response.json(value,{status,headers:noCache});
const unavailable = () => json({code:"PROJECT_CORE_UNAVAILABLE",error:"프로젝트 저장소 연결을 확인해 주세요."},503);
const missing = () => json({code:"PROJECT_NOT_FOUND",error:"프로젝트를 찾을 수 없어요."},404);
const conflict = () => json({code:"IDEMPOTENCY_CONFLICT",error:"같은 요청 번호로 다른 내용을 저장할 수 없어요."},409);
const invalid = (error: string) => json({code:"INVALID_INPUT",errors:{_form:error}},400);
type Operation = "create" | "brief";
type Saved = { projectId: string; revision: number | null };

async function requestJson(request: Request) {
  const payload = await readBoundedUpload(request, 64 * 1024).catch(() => null);
  if (payload === null) return json({code:"PAYLOAD_TOO_LARGE",error:"저장 요청이 너무 커요."},413);
  try { return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(payload)) as unknown; }
  catch { return invalid("입력 내용을 읽을 수 없어요."); }
}

async function http(request: Request, write: boolean,
  execute: (actor: VerifiedActor, transact: (body: (tx: ActorTransaction)=>Promise<Response>)=>Promise<Response>)=>Promise<Response>) {
  const auth = await resolveServerAuth();
  if (auth.kind === "denied") return authDeniedResponse(auth);
  if (auth.kind !== "verified") return unavailable();
  try {
    const connection = openManagedProjectCore();
    if (!connection) return unavailable();
    if (write) {
      const rejected = rejectCrossSite(request,{json:true});
      if (rejected) return rejected;
    }
    const actor = actorFromVerifiedUserId(auth.userId);
    return await execute(actor, step => withActorTransaction(connection.pool,actor,step,{
      ...(write ? {} : {mode:"read-only-repeatable-read" as const}),
      prepareSession:connection.prepareSession,preserveDomainError:isProjectCreateError,
    }));
  } catch (error) {
    if (isProjectCreateError(error)) return json({code:error.code,...(error.errors && {errors:error.errors})},error.status);
    return unavailable();
  }
}

const fingerprint = (content: unknown) => createHash("sha256").update(JSON.stringify(content)).digest("hex");

async function receipt(tx: ActorTransaction, operation: Operation, key: string, sha: string,
  action: ()=>Promise<Saved | Response>) {
  const keys = [tx.actorId,operation,key];
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,102))",[keys.join("/")]);
  const {rows:[previous]} = await tx.query<{input_sha:string;project_id:string;response_revision:string|null}>(`
    SELECT input_sha,project_id,response_revision FROM dream_project_core.requests WHERE owner_id=$1 AND operation=$2 AND request_id=$3`,keys);
  let saved: Saved;
  if (previous) {
    if (previous.input_sha !== sha) return conflict();
    const visible = await tx.query("SELECT id FROM dream.projects WHERE owner_id=$1 AND id=$2 AND archived_at IS NULL",
      [tx.actorId,previous.project_id]);
    if (visible.rowCount !== 1) return missing();
    saved = {projectId:previous.project_id, revision:previous.response_revision === null ? null : Number(previous.response_revision)};
  } else {
    const result = await action();
    if (result instanceof Response) return result;
    saved=result;
    await tx.query(`INSERT INTO dream_project_core.requests(owner_id,operation,request_id,input_sha,project_id,response_revision)
      VALUES($1,$2,$3,$4,$5,$6)`,[...keys,sha,saved.projectId,saved.revision]);
  }
  return operation === "create" ? json({id:saved.projectId},201) : json({stage:"plan",revision:saved.revision});
}

// T368 receipt closure shared by the suggestions and the authoritative write.
const currentAssetReceipts = `FROM dream.assets a
    JOIN dream.asset_receipt_state s ON (s.owner_id,s.asset_id)=(a.owner_id,a.id)
    JOIN dream.storage_objects o ON (o.owner_id,o.id,o.registered_asset_id)=(s.owner_id,s.object_id,s.asset_id)
    JOIN dream.storage_verification_receipts r ON (r.owner_id,r.id,r.object_id,r.asset_id,r.identity_digest,r.generation)
      =(s.owner_id,s.current_receipt_id,o.id,a.id,o.identity_digest,o.active_generation)
    JOIN dream.storage_verification_operations v ON (v.owner_id,v.id,v.object_id,v.generation,v.terminal_receipt_id)
      =(r.owner_id,r.operation_id,r.object_id,r.generation,r.id)
    JOIN dream.storage_policies p ON (p.policy_id,p.epoch,p.digest)=(r.policy_id,r.policy_epoch,r.policy_digest)
    WHERE a.owner_id=$1 AND a.archived_at IS NULL AND a.is_mock=0
      AND o.lifecycle='registered' AND s.status='ready' AND v.status='succeeded'
      AND a.kind IN ('image','video')
      AND (a.file_path,a.sha256,a.size_bytes,a.mime,a.kind,a.width,a.height)
        =(o.object_key,o.sha256,o.size_bytes,o.mime,o.kind,r.width,r.height)
      AND a.duration_ms IS NOT DISTINCT FROM r.duration_ms
      AND r.verified_at<=clock_timestamp() AND r.not_after>clock_timestamp()`;

async function hasCurrentAssetReceipt(asset: ProjectCreateAsset, _actor: VerifiedActor, tx: ActorTransaction) {
  // Keep the object, receipt pointer and policy stable through project commit.
  const result = await tx.query(`SELECT a.id ${currentAssetReceipts} AND a.id=$2 FOR SHARE OF o,s,p`,[tx.actorId,asset.id]);
  return result.rowCount === 1;
}

export function managedProjectAssetChoices(request: Request) {
  return http(request,false,async (_actor,transact) => {
    const cursors = new URL(request.url).searchParams.getAll("cursor");
    const cursor = cursors[0] ?? null;
    if (cursors.length > 1 || (cursor !== null && !id.safeParse(cursor).success)) {
      return invalid("자료 목록의 다음 페이지 정보를 확인해 주세요.");
    }
    return transact(async tx => {
      const {rows} = await tx.query(
        `SELECT a.id,a.title,a.kind ${currentAssetReceipts}
         AND ($2::uuid IS NULL OR a.id<$2) ORDER BY a.id DESC LIMIT $3`,[tx.actorId,cursor,assetPageSize+1]);
      const assets = rows.slice(0,assetPageSize).map(row => assetChoice.parse(row));
      const nextCursor = rows.length > assetPageSize ? assets.at(-1)?.id : undefined;
      return json({assets,...(nextCursor && {nextCursor})});
    });
  });
}

export function managedProjectCreate(request: Request) {
  return http(request,true,async (actor,transact) => {
    const key = id.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return invalid("프로젝트 생성 요청 번호를 확인해 주세요.");
    const raw = await requestJson(request);
    if (raw instanceof Response) return raw;
    const command = createBody.safeParse(raw);
    if (!command.success) return invalid("입력 항목을 확인해 주세요.");
    const {menuId,inputs} = command.data;
    const sha = fingerprint([menuId,Object.keys(inputs).sort().map(field=>[field,inputs[field]])]);
    return transact(tx => receipt(tx,"create",key.data.toLowerCase(),sha,async () => {
      const config = getMenuConfig();
      const menu = config.menus.find(item=>item.id===menuId);
      if (!menu || menu.availability !== "active" || menu.id !== "shopping-shorts") {
        return json({code:"STAGE_LOCKED",error:"이 분야의 프로젝트를 만들 수 없어요."},409);
      }
      const insert = preparePostgresProjectCreate(actor,menuId,inputs,snapshotForMenu(config,menu),hasCurrentAssetReceipt);
      return {projectId:await insert(tx),revision:null};
    }));
  });
}

export function managedProjectBrief(request: Request, params: Promise<{ id: string }>) {
  const write = request.method === "POST";
  return http(request,write,async (_actor,transact) => {
    const projectId = id.safeParse((await params).id);
    if (!projectId.success) return missing();
    const target = projectId.data.toLowerCase();
    if (!write) return transact(async tx => {
      const result = await briefView(tx,target,false);
      return result ? json(result) : missing();
    });
    const key = id.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return invalid("브리프 저장 요청 번호를 확인해 주세요.");
    const raw = await requestJson(request);
    if (raw instanceof Response) return raw;
    const command = briefBody.safeParse(raw);
    if (!command.success) return invalid("요구 사항을 검토한 뒤 승인해 주세요.");
    const expected = command.data.revision;
    return transact(tx => receipt(tx,"brief",key.data.toLowerCase(),fingerprint([target,expected]),async () => {
      const brief = await briefView(tx,target,true);
      if (!brief) return missing();
      if (brief.revision !== expected || brief.stages.intake !== "approved" || brief.stages.brief !== "todo" || brief.stages.plan !== "locked") {
        return json({code:"BRIEF_CONFLICT",error:"프로젝트가 변경됐어요. 현재 상태를 다시 확인해 주세요."},409);
      }
      const keys = [tx.actorId,target];
      const approved = await tx.query(`UPDATE dream.stage_states SET status='approved',approved_revision=$3,approved_at=clock_timestamp()
        WHERE owner_id=$1 AND project_id=$2 AND stage='brief' AND status='todo'`,[...keys,expected]);
      const ready = await tx.query(`UPDATE dream.stage_states SET status='todo'
        WHERE owner_id=$1 AND project_id=$2 AND stage='plan' AND status='locked'`,keys);
      if (approved.rowCount !== 1 || ready.rowCount !== 1) throw new Error("Brief transition changed");
      await tx.query(`INSERT INTO dream.activity_log(owner_id,id,project_id,actor,action,detail_json,created_at)
        VALUES($1,$3,$2,'local-user','brief.confirm',$4,clock_timestamp())`,[...keys,v7(),JSON.stringify({revision:expected})]);
      return {projectId:target,revision:expected};
    }));
  });
}

async function briefView(tx: ActorTransaction, projectId: string, lock: boolean) {
  const keys = [tx.actorId,projectId];
  const {rows:[project]} = await tx.query<{revision:string;lengthSec:string;title:string;goal:string;target:string;
    aspect:string;facts:string|null;product:string|null;rights:string|null;sources:string|null}>(`
    SELECT title,goal,target,aspect,length_sec AS "lengthSec",content_revision AS revision,
      inputs_json::jsonb->>'facts' AS facts,inputs_json::jsonb->>'productName' AS product,
      inputs_json::jsonb->>'usageRights' AS rights,inputs_json::jsonb->>'factSources' AS sources
    FROM dream.projects WHERE owner_id=$1 AND id=$2 AND menu_id='shopping-shorts' AND archived_at IS NULL`
    + (lock ? " FOR UPDATE" : ""),keys);
  if (!project) return null;
  const {rows} = await tx.query<{stage:string;status:string}>(`SELECT stage,status FROM dream.stage_states
    WHERE owner_id=$1 AND project_id=$2 AND stage IN ('intake','brief','plan')`,keys);
  const revision = Number(project.revision), lengthSec = Number(project.lengthSec);
  if (rows.length !== 3 || !Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(lengthSec) || lengthSec < 1) {
    throw new Error("Brief storage is incomplete");
  }
  return {...project,revision,lengthSec,stages:Object.fromEntries(rows.map(row=>[row.stage,row.status]))};
}
