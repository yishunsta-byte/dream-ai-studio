import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, it } from "vitest";
const script=resolve("scripts/verify-build.mjs");let root:string,app:string,external:string;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-trace-test-")));app=join(root,"app");external=join(root,"external");for(const path of [join(app,".next/server"),join(app,"public"),join(external,"data"),join(external,"datastore")])mkdirSync(path,{recursive:true});});
afterEach(()=>{if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});
function check(file:string){const manifest=join(app,".next/server/fixture.nft.json");writeFileSync(manifest,JSON.stringify({files:[relative(dirname(manifest),file)]}));return spawnSync(process.execPath,[script],{cwd:app,env:{...process.env,DREAM_DATA_ROOT:external},encoding:"utf8"});}
it("rejects a traced external runtime database and a symlink alias",()=>{const file=join(external,"data/private.db");writeFileSync(file,"fixture");expect(check(file).status).not.toBe(0);const linked=join(app,"public/linked");symlinkSync(join(external,"data"),linked,"junction");expect(check(join(linked,"private.db")).status).not.toBe(0);});
it("rejects external env traces but allows similarly named public folders",()=>{const secret=join(external,".env.local");writeFileSync(secret,"fixture only");expect(check(secret).status).not.toBe(0);const publicFile=join(external,"datastore/public.txt");writeFileSync(publicFile,"fixture");expect(check(publicFile).status).toBe(0);});
it("rejects an innocently named symlink to a runtime env file",()=>{const secret=join(external,".env.local"),alias=join(app,"public/settings.txt");writeFileSync(secret,"fixture only");symlinkSync(secret,alias,"file");expect(check(alias).status).not.toBe(0);});
// T-114: the render toolchain (renderer, bundler, compositor, browser, render/ entry) never enters a Next trace.
it("rejects traced render toolchain files and allows the player package",()=>{
  for(const path of ["node_modules/@remotion/renderer/dist/index.js","node_modules/@remotion/bundler/dist/index.js","node_modules/@remotion/compositor-win32-x64-msvc/remotion.exe","render/child.ts",".remotion/chrome-headless-shell/x.exe"]){const file=join(app,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,"fixture");const result=check(file);expect(result.status,path).not.toBe(0);expect(result.stderr,path).toContain("영상 만들기 도구");}
  const player=join(app,"node_modules/@remotion/player/dist/index.js");mkdirSync(dirname(player),{recursive:true});writeFileSync(player,"fixture");expect(check(player).status).toBe(0);
  const remotion=join(app,"node_modules/remotion/dist/index.js");mkdirSync(dirname(remotion),{recursive:true});writeFileSync(remotion,"fixture");expect(check(remotion).status).toBe(0);
});
