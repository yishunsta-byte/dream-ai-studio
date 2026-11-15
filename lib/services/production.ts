import "server-only";
import { withDatabase } from "@/lib/db/server";
import { planningRepository } from "@/lib/repo/planning";
import { jobsRepository } from "@/lib/repo/jobs";
import { WorkflowError } from "@/lib/domain/stages";
export function readProduction(projectId:string){return withDatabase(handle=>{const planning=planningRepository(handle),repo=jobsRepository(handle),project=repo.project(projectId);if(!project)throw new WorkflowError("NOT_FOUND","프로젝트를 찾을 수 없어요.",404);return {projectId,revision:project.contentRevision,approved:!!project.approvedPlanId,scenes:planning.allScenes(projectId).filter(scene=>!scene.archivedAt).map(scene=>({id:scene.id,title:scene.title,description:scene.description,durationSec:scene.durationSec,versions:repo.versions(scene.id).map(version=>({id:version.id,version:version.version,status:version.status,kind:version.kind})),selectedVersionId:scene.selectedVersionId}))};});}
export type ProductionData=ReturnType<typeof readProduction>;
