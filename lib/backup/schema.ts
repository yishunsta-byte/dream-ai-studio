import { z } from "zod";
export const inventoryFileSchema=z.strictObject({path:z.string().min(1).max(255),sha256:z.string().regex(/^[a-f0-9]{64}$/),sizeBytes:z.number().int().nonnegative().safe()});
export const backupManifestSchema=z.strictObject({schemaVersion:z.literal(1),backupId:z.uuidv7(),appVersion:z.literal("0.1.0"),createdAt:z.iso.datetime(),database:inventoryFileSchema,files:z.array(inventoryFileSchema).max(10000),inventorySha256:z.string().regex(/^[a-f0-9]{64}$/),migrations:z.array(z.strictObject({version:z.number().int().positive(),name:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(100)});
export const backupJobSchema=z.strictObject({schemaVersion:z.literal(1),backupId:z.uuidv7(),kind:z.enum(["auto","manual"])});
export const backupMetaSchema=z.strictObject({zipSha256:z.string().regex(/^[a-f0-9]{64}$/),sizeBytes:z.number().int().nonnegative().safe(),fileCount:z.number().int().nonnegative(),verifiedAt:z.iso.datetime()});
export type BackupManifest=z.infer<typeof backupManifestSchema>;
export const restoreTicketSchema=z.strictObject({id:z.uuidv7(),backupId:z.uuidv7(),destination:z.string(),staging:z.string(),expiresAt:z.iso.datetime(),manifest:backupManifestSchema,status:z.enum(["ready","finishing","prepared","completed","failed"]),pendingJobs:z.number().int().nonnegative(),projects:z.number().int().nonnegative(),assets:z.number().int().nonnegative(),claim:z.uuidv7().nullable().default(null),leaseUntil:z.iso.datetime().nullable().default(null),normalizedDatabase:inventoryFileSchema.optional(),completedAt:z.iso.datetime().optional()});
export type RestoreTicket=z.infer<typeof restoreTicketSchema>;
export const restoreInfoSchema=z.strictObject({schemaVersion:z.literal(1),ticketId:z.uuidv7(),backupId:z.uuidv7(),destination:z.string(),backupCreatedAt:z.iso.datetime(),restoredAt:z.iso.datetime(),sourceDatabaseSha256:z.string().regex(/^[a-f0-9]{64}$/),database:inventoryFileSchema});
export type RestoreInfo=z.infer<typeof restoreInfoSchema>;
// Private state of a restored instance (DB setting `restore.info`). Paths stay server-side.
export const restoreStateSchema=z.object({ticketId:z.uuidv7(),backupId:z.uuidv7(),destination:z.string(),backupCreatedAt:z.iso.datetime(),restoredAt:z.iso.datetime(),inheritedBackupIds:z.array(z.string().min(1)).max(1000000).optional(),protectedRoots:z.array(z.string().min(1)).max(256).optional()});
export type RestoreState=z.infer<typeof restoreStateSchema>;
// Marks which instance requested a backup row: null for a never-restored instance, else that instance's restore ticket.
export const backupOriginSchema=z.strictObject({schemaVersion:z.literal(1),restoreTicketId:z.uuidv7().nullable()});
export const backupOriginKey=(id:string)=>`backup.${id}.origin`;
// `present` without `state` means a restored instance whose record cannot be read: callers stay conservative.
export function parseRestoreState(valueJson:string|undefined):{present:boolean;state:RestoreState|null}{if(valueJson===undefined)return {present:false,state:null};try{const parsed=restoreStateSchema.safeParse(JSON.parse(valueJson));return {present:true,state:parsed.success?parsed.data:null};}catch{return {present:true,state:null};}}
