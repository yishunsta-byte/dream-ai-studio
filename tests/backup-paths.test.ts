import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { physicalPath, removeOwnedStaging, validateBackupDirectory, validateRestoreTarget } from "@/lib/backup/paths";
let root:string,aliasRoot:string;
beforeEach(async()=>{aliasRoot=await mkdtemp(join(tmpdir(),"dream-path-test-"));root=await realpath(aliasRoot);await mkdir(join(root,"runtime"));vi.stubEnv("DREAM_DATA_ROOT",join(aliasRoot,"runtime"));});
afterEach(async()=>{vi.unstubAllEnvs();if(dirname(await realpath(root))!==await realpath(tmpdir()))throw new Error("Temporary boundary rejected");await rm(root,{recursive:true,force:true});});
describe("physical runtime boundaries",()=>{
 it("rejects physical data/storage overlap in both directions",async()=>{for(const name of ["data","storage"]){const physical=join(root,`physical-${name}`);await mkdir(physical);await symlink(physical,join(root,"runtime",name),"junction");for(const target of [physical,join(physical,"new"),root]){await expect(validateBackupDirectory(target,false)).rejects.toThrow();await expect(validateRestoreTarget(target)).rejects.toThrow();}}});
 it("permits dedicated backup descendants but rejects restore and ancestor overlap",async()=>{const physical=join(root,"physical-backups");await mkdir(physical);await symlink(physical,join(root,"runtime/backups"),"junction");expect(await validateBackupDirectory(physical,false)).toBe(physical);expect(await validateBackupDirectory(join(physical,"new"),true)).toBe(join(physical,"new"));for(const target of [physical,join(physical,"restore"),root])await expect(validateRestoreTarget(target)).rejects.toThrow();await expect(validateBackupDirectory(root,false)).rejects.toThrow();});
 it("normalizes the OS short-alias spelling and cleans owned staging safely",async()=>{expect(await physicalPath(join(aliasRoot,"runtime","missing"))).toBe(join(root,"runtime","missing"));const staging=join(aliasRoot,".dream-owner-test");await mkdir(staging);await removeOwnedStaging(staging,aliasRoot,"owner-test");await expect(realpath(staging)).rejects.toThrow();await expect(removeOwnedStaging(join(root,"runtime"),root,"")).rejects.toThrow();});
 it("allows an independent empty restore target and rejects a populated one",async()=>{const target=join(root,"restored");expect(await validateRestoreTarget(target)).toBe(target);await mkdir(target);expect(await validateRestoreTarget(target)).toBe(target);await mkdir(join(target,"existing"));await expect(validateRestoreTarget(target)).rejects.toThrow();});
});
