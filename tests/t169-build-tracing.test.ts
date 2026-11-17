// T-169: native tools never enter a Next server trace. The verifier names them on its own (also through a link or under
// another name's folder), the config never writes a glob outside the project, and the tools folder is resolved at run time.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const script=resolve("scripts/verify-build.mjs");let root:string,app:string,external:string;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dream-t169-test-")));app=join(root,"app");external=join(root,"external");for(const path of [join(app,".next/server"),join(app,"public"),join(external,"data")])mkdirSync(path,{recursive:true});});
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();if(dirname(realpathSync(root))!==realpathSync(tmpdir()))throw new Error("Temporary boundary rejected");rmSync(root,{recursive:true,force:true});});
function check(files:string[],data=external){const manifest=join(app,".next/server/app/page.js.nft.json");mkdirSync(dirname(manifest),{recursive:true});writeFileSync(manifest,JSON.stringify({files:files.map(file=>relative(dirname(manifest),file))}));return spawnSync(process.execPath,[script],{cwd:app,env:{...process.env,DREAM_DATA_ROOT:data},encoding:"utf8"});}
const put=(file:string,text="fixture")=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);return file;};

describe("verify-build: 이 PC 실행 도구",()=>{
  it("앱·데이터 폴더의 .tools, 어디에 있든 ffmpeg/ffprobe 실행 파일은 실행 도구로 거절하고 위반을 모두 적는다",()=>{
    const appTool=put(join(app,".tools/ffmpeg/ffmpeg.exe")),dataTool=put(join(external,".tools/ffmpeg/ffprobe.exe")),packaged=put(join(app,"node_modules/some-pkg/bin/ffprobe")),other=put(join(app,".tools/remotion-browser/readme.txt"));
    for(const file of [appTool,dataTool,packaged,other]){const result=check([file]);expect(result.status,file).not.toBe(0);expect(result.stderr,file).toContain("이 PC의 실행 도구");}
    const result=check([appTool,dataTool,join(app,"public/ok.txt")]);expect(result.stderr).toContain("추적 위반 2건 (파일 목록 1개)");expect(result.stderr).toContain("<app>/.tools/ffmpeg/ffmpeg.exe");expect(result.stderr).toContain("<data>/.tools/ffmpeg/ffprobe.exe");
    expect(result.stderr).not.toContain(root);
  });
  it("이름을 바꾼 링크로 실행 도구를 가리켜도 거절하고, 비슷한 이름의 일반 코드는 통과",()=>{
    const tool=put(join(app,".tools/ffmpeg/ffmpeg.exe")),alias=join(app,"public/helper.bin");symlinkSync(tool,alias,"file");expect(check([alias]).status).not.toBe(0);
    const copied=join(app,"public/ffmpeg");copyFileSync(tool,copied);expect(check([copied]).stderr).toContain("이 PC의 실행 도구");
    for(const path of ["node_modules/ffmpeg-helpers/index.js","lib/media/tools.js","public/ffmpeg-guide.txt"]){const file=put(join(app,path));expect(check([file]).status,path).toBe(0);}
  });
  it("데이터·비밀이 함께 있으면 그 문구가 먼저이고, 렌더 도구 문구는 그대로",()=>{
    const db=put(join(external,"data/app.db")),tool=put(join(app,".tools/ffmpeg/ffmpeg.exe"));const both=check([tool,db]);expect(both.stderr).toContain("로컬 데이터나 비밀 설정");expect(both.stderr).toContain("추적 위반 2건");
    const renderer=put(join(app,"node_modules/@remotion/renderer/dist/index.js"));expect(check([renderer]).stderr).toContain("영상 만들기 도구");
  });
});

describe("next.config: 프로젝트 밖 glob 없음",()=>{
  async function excludes(data:string|null){vi.resetModules();if(data===null)vi.stubEnv("DREAM_DATA_ROOT","");else vi.stubEnv("DREAM_DATA_ROOT",data);return ((await import("../next.config")).default.outputFileTracingExcludes as Record<string,string[]>)["/*"];}
  it("데이터 폴더가 프로젝트 밖이면 상대 glob만, 안이면 그 폴더 항목을 더한다",async()=>{
    const base=["./data/**/*","./storage/**/*","./backups/**/*","./tmp/**/*","./.tools/**/*","./.env*"];
    const outside=await excludes(external);expect(outside).toEqual(base);expect(outside.some(glob=>glob.startsWith("..")||/^[A-Za-z]:/.test(glob))).toBe(false);
    expect(await excludes(null)).toEqual(base);
    const inside=await excludes(join(process.cwd(),"rt-fixture"));expect(inside).toEqual([...base,"rt-fixture/data/**/*","rt-fixture/storage/**/*","rt-fixture/backups/**/*","rt-fixture/tmp/**/*","rt-fixture/.tools/**/*","rt-fixture/.env*"]);
  });
});

describe("도구 위치는 실행할 때 앱 폴더에서 찾는다",()=>{
  it("환경 변수 > 앱 .tools/ffmpeg 실제 파일 > PATH 이름 순서는 그대로",async()=>{
    const tools=await import("@/lib/media/tools");expect(tools.mediaToolsFolder(app)).toBe(join(app,".tools","ffmpeg"));
    vi.stubEnv("FFMPEG_PATH","configured-ffmpeg");expect(tools.mediaBinary("ffmpeg")).toBe("configured-ffmpeg");vi.unstubAllEnvs();vi.stubEnv("FFPROBE_PATH","");
    const cwd=process.cwd(),exe=process.platform==="win32"?".exe":"";
    try{process.chdir(app);expect(tools.mediaBinary("ffprobe")).toBe("ffprobe");const file=put(join(app,".tools/ffmpeg",`ffprobe${exe}`));expect(existsSync(file)).toBe(true);expect(tools.mediaBinary("ffprobe")).toBe(join(realpathSync(app),".tools","ffmpeg",`ffprobe${exe}`));}finally{process.chdir(cwd);}
  });
});
