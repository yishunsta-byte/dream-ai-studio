import { z } from "zod";
export const bundleFileSchema=z.strictObject({path:z.string().min(1).max(255),sha256:z.string().regex(/^[a-f0-9]{64}$/),sizeBytes:z.number().int().nonnegative().safe(),mime:z.string().min(1),sceneId:z.uuidv7().optional(),versionId:z.uuidv7().optional(),durationMs:z.number().int().nonnegative().nullable().optional(),width:z.number().int().positive().nullable().optional(),height:z.number().int().positive().nullable().optional(),rights:z.string().nullable().optional()});
// manifestVersion 1: the P1/P2 editing bundle as written since P1 (unchanged; every stored v1 row and ZIP reads as before).
export const manifestV1Schema=z.strictObject({manifestVersion:z.literal(1),project:z.strictObject({id:z.uuidv7(),title:z.string(),aspect:z.enum(["9:16","16:9","1:1"]),lengthSec:z.number().int().positive()}),menu:z.strictObject({id:z.string(),label:z.string()}),templateVersion:z.string(),contentRevision:z.number().int().positive(),planId:z.uuidv7(),exportedAt:z.iso.datetime(),isMock:z.boolean(),kind:z.literal("editing-bundle"),files:z.array(bundleFileSchema).min(1).max(1000)});
// manifestVersion 2 (P2-6 S2, T-154 4.2 / T-158): only a bundle that carries the sound source files of a v2 timeline.
// The v1 fields stay as they are; it adds the timeline it was made from and, on each sound source file, which asset and
// roles it is. Writable only on a database with 0010 (its journal entry makes a 1..9 app refuse the database and its
// backups instead of misreading these rows).
export const EXPORT_AUDIO_PROFILE="p2-5-local-v1";
const audioFileSchema=bundleFileSchema.extend({audio:z.strictObject({assetId:z.uuid(),roles:z.array(z.enum(["voice","music","effect"])).min(1).max(3),isMock:z.boolean()})});
const v2FileSchema=z.union([audioFileSchema,bundleFileSchema]);
export const manifestV2Schema=manifestV1Schema.extend({manifestVersion:z.literal(2),timeline:z.strictObject({revisionId:z.uuidv7(),schemaVersion:z.literal(2),audioMixProfile:z.literal(EXPORT_AUDIO_PROFILE)}),files:z.array(v2FileSchema).min(1).max(1000)}).superRefine((manifest,context)=>{
  const audio=manifest.files.filter(file=>"audio" in file) as z.infer<typeof audioFileSchema>[];
  if(!audio.length)context.addIssue({code:"custom",path:["files"],message:"manifest 2 needs at least one sound source file"});
  const assets=new Set<string>();
  for(const file of audio){
    if(!file.path.startsWith("audio/")||file.sceneId!==undefined||file.versionId!==undefined)context.addIssue({code:"custom",path:["files"],message:"sound source file entry differs"});
    if(assets.has(file.audio.assetId))context.addIssue({code:"custom",path:["files"],message:"sound source listed twice"});assets.add(file.audio.assetId);
    if(new Set(file.audio.roles).size!==file.audio.roles.length)context.addIssue({code:"custom",path:["files"],message:"sound roles repeated"});
  }
  if(manifest.files.some(file=>!("audio" in file)&&file.path.startsWith("audio/")))context.addIssue({code:"custom",path:["files"],message:"file under audio/ without its sound source"});
  // T-160 (T-154 4.3): a sample sound makes the whole bundle a sample. One way only: real sounds may still sit in a
  // bundle that is a sample because of its scenes or other files.
  if(audio.some(file=>file.audio.isMock)&&!manifest.isMock)context.addIssue({code:"custom",path:["isMock"],message:"a sample sound source needs a sample bundle"});
});
export const manifestSchema=z.union([manifestV1Schema,manifestV2Schema]);
export const exportJobSchema=z.strictObject({schemaVersion:z.literal(1),projectId:z.uuidv7(),revision:z.number().int().positive(),planId:z.uuidv7(),exportId:z.uuidv7()});
export type BundleManifest=z.infer<typeof manifestSchema>;
export type BundleManifestV1=z.infer<typeof manifestV1Schema>;
export type BundleManifestV2=z.infer<typeof manifestV2Schema>;
