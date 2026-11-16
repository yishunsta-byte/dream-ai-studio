// P2-4b fixes after the independent review (T-116 → T-120), without a browser:
// F116-1 bundle cache trusted only through the worker's own closed file list (changed chunk, changed page, extra or
//        missing file → rejected and nothing half-copied; a folder found on disk is never trusted by its name);
// F116-2 the job file server reads the handles it opened at start (same-size replacement, rename-over, delete of the
//        path afterwards do not change the served bytes);
// F116-3 one storage rule (ENOSPC → DISK_FULL final, EBUSY/EAGAIN/EMFILE/ENFILE retried, the rest permanent);
// F116-4 connect overloads normalized, missing host checked as localhost, names checked again after lookup, and props
//        limited to this attempt's file server. The real Node connections run in a separate process (the guard
//        changes net.Socket for the whole process) against this PC's own non-loopback address only.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { copyTrustedBundle, listFiles, manifestOf, storeBundle } from "@/render/bundle-cache";
import { assertOwnedProps, classify, connectTarget, loopbackAddress, ownedUrl, validFileBase } from "@/render/guard";
import { startFileServer } from "@/lib/render/file-server";
import { storageFailure } from "@/lib/render/errors";
import { forgetTrustedBundles, trustedBundle } from "@/lib/render/run";
import type { RenderProps } from "@/lib/render/props";

const sha=(bytes:Buffer|string)=>createHash("sha256").update(bytes).digest("hex");
let dir:string;
beforeAll(()=>{dir=mkdtempSync(join(tmpdir(),"dream-t120-"));});
afterAll(()=>{rmSync(dir,{recursive:true,force:true});});

describe("F116-1 번들 캐시: 작업자 기억의 닫힌 파일 목록으로만 믿는다",()=>{
  const build=(name:string)=>{const out=join(dir,name);mkdirSync(join(out,"static"),{recursive:true});
    writeFileSync(join(out,"index.html"),"<html>page</html>");writeFileSync(join(out,"bundle.js"),"console.log('blue')");writeFileSync(join(out,"static","chunk.js"),"var a=1;");return out;};
  it("정상 hit은 같은 바이트를 시도 폴더로 복사한다",async()=>{
    const source=build("b1"),files=(await manifestOf(source))!,cache=join(dir,"cache-1");
    expect(files.map(file=>file.path)).toEqual(["bundle.js","index.html","static/chunk.js"]);
    await storeBundle(source,files,cache);
    const target=join(dir,"work-1");expect(await copyTrustedBundle({dir:cache,files},target)).toBeNull();
    expect(listFiles(target)).toEqual(["bundle.js","index.html","static/chunk.js"]);
    expect(sha(readFileSync(join(target,"bundle.js")))).toBe(files.find(file=>file.path==="bundle.js")!.sha256);
  });
  it("실행 chunk·페이지(메타데이터) 같은 크기 변조, 파일 추가·누락은 거부하고 반쯤 복사한 것을 남기지 않는다",async()=>{
    const source=build("b2"),files=(await manifestOf(source))!;
    const cases:[string,(cache:string)=>void,RegExp][]=[
      ["chunk",cache=>writeFileSync(join(cache,"bundle.js"),"console.log('red!')"),/changed: bundle.js/],
      ["nested",cache=>writeFileSync(join(cache,"static","chunk.js"),"var a=2;"),/changed: static\/chunk.js/],
      ["page",cache=>writeFileSync(join(cache,"index.html"),"<html>evil</html>"),/changed: index.html/],
      ["extra",cache=>writeFileSync(join(cache,"static","more.js"),"x"),/file set differs/],
      ["marker",cache=>writeFileSync(join(cache,"render-source.json"),JSON.stringify({sourceSha256:"x"})),/file set differs/],
      ["missing",cache=>unlinkSync(join(cache,"static","chunk.js")),/file set differs/],
    ];
    for(const [name,tamper,reason] of cases){
      const cache=join(dir,`cache-2-${name}`),target=join(dir,`work-2-${name}`);await storeBundle(source,files,cache);tamper(cache);
      expect(await copyTrustedBundle({dir:cache,files},target),name).toMatch(reason);
      expect(listFiles(target),name).toBeNull();
    }
  });
  it("디스크에 있는 폴더는 이름이 맞아도 믿지 않는다: 이 작업자가 만든 기록이 없으면 새로 만든다",()=>{
    forgetTrustedBundles();const root=join(dir,"bundles"),key="a".repeat(64);
    mkdirSync(join(root,key),{recursive:true});writeFileSync(join(root,key,"index.html"),"<html>old</html>");
    expect(trustedBundle(root,key)).toBeNull();
  });
});

describe("F116-2 작업 파일 서버는 시작할 때 연 핸들만 읽는다",()=>{
  it("같은 크기 교체·이름 바꿔 덮기·삭제 뒤에도 처음 바이트를 준다",async()=>{
    const original=Buffer.from(Array.from({length:2048},(_,index)=>index%251)),other=Buffer.alloc(2048,7);
    const paths=["a","b","c"].map(name=>{const path=join(dir,`served-${name}.bin`);writeFileSync(path,original);return path;});
    const server=await startFileServer(paths.map(path=>({absolute:path,mime:"video/mp4",sizeBytes:original.length})),[]);
    try{
      writeFileSync(paths[0],other);// same size, written in place
      const swap=join(dir,"swap.bin");writeFileSync(swap,other);let renamed=true;try{renameSync(swap,paths[1]);}catch{renamed=false;}
      let removed=true;try{unlinkSync(paths[2]);}catch{removed=false;}
      for(const index of [1,2]){const body=Buffer.from(await (await fetch(server.mediaUrl(index))).arrayBuffer());expect(sha(body),String(index)).toBe(sha(original));}
      expect(renamed||removed).toBe(true);
      // in-place writes reach the same file; the worker never serves the source path, only its own read-only copy,
      // and checks that copy again before publishing (verifyStaged in lib/jobs/render.ts)
      const range=await fetch(server.mediaUrl(1),{headers:{range:"bytes=10-19"}});expect(range.status).toBe(206);
      expect(Buffer.from(await range.arrayBuffer()).equals(original.subarray(10,20))).toBe(true);
    }finally{await server.close();}
  });
  it("시작할 때 없거나 크기가 다르면 404·409",async()=>{
    const path=join(dir,"sized.bin");writeFileSync(path,"1234");
    const server=await startFileServer([{absolute:path,mime:"video/mp4",sizeBytes:5},{absolute:join(dir,"none.bin"),mime:"video/mp4",sizeBytes:1}],[]);
    try{expect((await fetch(server.mediaUrl(0))).status).toBe(409);expect((await fetch(server.mediaUrl(1))).status).toBe(404);}finally{await server.close();}
  });
});

describe("F116-3 저장 오류 공통 분류",()=>{
  it("ENOSPC는 종결 DISK_FULL, 잠김·일시 한도만 재시도, 권한·경로 오류는 영구",()=>{
    expect(storageFailure("ENOSPC")).toEqual({code:"DISK_FULL",retryable:false});expect(storageFailure("EDQUOT")).toEqual({code:"DISK_FULL",retryable:false});
    for(const code of ["EBUSY","EAGAIN","EMFILE","ENFILE"])expect(storageFailure(code),code).toEqual({code:"STORAGE_FAILED",retryable:true});
    for(const code of ["EACCES","EPERM","ENOENT","ENOTDIR","EINVAL","EROFS","EXDEV",null,undefined])expect(storageFailure(code),String(code)).toEqual({code:"STORAGE_FAILED",retryable:false});
  });
  it("자식이 보낸 시스템 오류도 같은 규칙이다",()=>{
    const err=(code:string)=>Object.assign(new Error(`${code}: write`),{code});
    expect(classify(err("ENOSPC")).code).toBe("DISK_FULL");expect(classify(err("EBUSY")).code).toBe("STORAGE_FAILED");expect(classify(err("EMFILE")).code).toBe("STORAGE_FAILED");
    expect(classify(err("EACCES")).code).toBe("RENDER_FAILED");expect(classify(err("ECONNRESET")).code).toBe("RENDER_BROWSER_CRASHED");
  });
});

describe("F116-4 연결·주소 검사",()=>{
  it("connect 오버로드를 모두 같은 대상으로 읽는다",()=>{
    expect(connectTarget([{host:"10.0.0.5",port:80}])).toEqual({host:"10.0.0.5",port:80});
    expect(connectTarget([[{host:"10.0.0.5",port:80},null]])).toEqual({host:"10.0.0.5",port:80});// net.connect() normalized form
    expect(connectTarget([80,"10.0.0.5"])).toEqual({port:80,host:"10.0.0.5"});expect(connectTarget([80])).toEqual({port:80,host:undefined});
    expect(connectTarget(["8080","10.0.0.5"])).toEqual({port:"8080",host:"10.0.0.5"});expect(connectTarget(["\\\\.\\pipe\\x"])).toEqual({path:"\\\\.\\pipe\\x"});
  });
  it("loopback 주소만 통과한다",()=>{
    for(const ok of ["127.0.0.1","127.5.6.7","::1","[::1]","::ffff:127.0.0.1"])expect(loopbackAddress(ok),ok).toBe(true);
    for(const no of ["10.0.0.1","192.168.0.2","0.0.0.0","::","::ffff:10.0.0.1","127.0.0.1.nip.io","localhost.example","fe80::1"])expect(loopbackAddress(no),no).toBe(false);
  });
  it("props의 영상·글꼴 주소는 이 시도의 파일 서버(origin·token·/m|f/번호)만 허용한다",()=>{
    const base=`http://127.0.0.1:40123/${"a".repeat(64)}`,other=`http://127.0.0.1:40123/${"b".repeat(64)}`;
    expect(validFileBase(base)).toBe(true);expect(validFileBase("http://localhost:1/"+"a".repeat(64))).toBe(false);
    expect(ownedUrl(base,`${base}/m/0`,"m")).toBe(true);expect(ownedUrl(base,`${base}/f/3`,"f")).toBe(true);
    for(const url of [`${base}/f/0`,`${other}/m/0`,`${base}/m/0?x=1`,`${base}/m/0/../1`,`${base}/m/`,"http://127.0.0.1:40124/"+"a".repeat(64)+"/m/0","http://192.168.0.2:40123/"+"a".repeat(64)+"/m/0","https://example.com/a.mp4","file:///C:/a.mp4","data:video/mp4;base64,AA"])
      expect(ownedUrl(base,url,"m"),url).toBe(false);
    const props=(src:string,font=`${base}/f/0`)=>({clips:[{sceneId:"s",src}],fonts:[{family:"P",url:font}]}) as unknown as RenderProps;
    expect(()=>assertOwnedProps(props(`${base}/m/0`),base)).not.toThrow();
    expect(()=>assertOwnedProps(props("http://192.168.0.2:8080/x.mp4"),base)).toThrow(/RENDER_NETWORK_REFUSED/);
    expect(()=>assertOwnedProps(props(`${base}/m/0`,"https://fonts.example/x.woff2"),base)).toThrow(/RENDER_NETWORK_REFUSED/);
  });

  // This PC's own non-loopback IPv4 (no outside endpoint is used).
  const lan=Object.values(networkInterfaces()).flat().find(item=>item&&item.family==="IPv4"&&!item.internal)?.address;
  let server:Server|null=null,hits=0;
  afterAll(async()=>{if(server)await new Promise<void>(done=>server!.close(()=>done()));});
  it.skipIf(!lan)("별도 프로세스에서 모든 연결 방식이 자기 PC non-loopback 서버에 닿지 못하고 loopback은 된다",async()=>{
    server=createServer((_request,response)=>{hits++;response.end("reached");});
    await new Promise<void>(done=>server!.listen(0,"0.0.0.0",()=>done()));const port=(server.address() as {port:number}).port;
    const guard=pathToFileURL(resolve("render/guard.ts")).href,script=join(dir,"net-probe.mjs");
    writeFileSync(script,`import net from "node:net";import http from "node:http";import os from "node:os";
const {installNetGuard}=await import(${JSON.stringify(guard)});installNetGuard();
const lan=${JSON.stringify(lan)},port=${port},out={};
const tryConnect=(name,make)=>new Promise(done=>{let socket;try{socket=make();}catch(error){out[name]="refused:"+String(error.message).slice(0,40);return done();}
  socket.once("connect",()=>{out[name]="connected";socket.destroy();done();});socket.once("error",error=>{out[name]="refused:"+String(error.message).slice(0,40);done();});});
await tryConnect("net.connect(options)",()=>net.connect({host:lan,port}));
await tryConnect("net.connect(port,host)",()=>net.connect(port,lan));
await tryConnect("net.createConnection(options)",()=>net.createConnection({host:lan,port}));
await tryConnect("new Socket().connect(port,host)",()=>new net.Socket().connect(port,lan));
await tryConnect("hostname lookup",()=>net.connect({host:os.hostname(),port,family:4}));
await new Promise(done=>{try{const req=http.get({host:lan,port,path:"/"},res=>{out["http.get"]="connected";res.resume();done();});req.on("error",error=>{out["http.get"]="refused:"+String(error.message).slice(0,40);done();});}catch(error){out["http.get"]="refused:"+String(error.message).slice(0,40);done();}});
try{await fetch("http://"+lan+":"+port+"/");out.fetch="connected";}catch(error){out.fetch="refused:"+String(error.cause?.message??error.message).slice(0,40);}
await tryConnect("loopback",()=>net.connect({host:"127.0.0.1",port}));
await tryConnect("missing host (localhost)",()=>net.connect({port}));
console.log(JSON.stringify(out));`);
    const {stdout}=await promisify(execFile)(process.execPath,["--import","tsx",script],{cwd:resolve("."),timeout:60000,windowsHide:true});
    const out=JSON.parse(stdout.trim().split(/\r?\n/).at(-1)!) as Record<string,string>;
    for(const name of ["net.connect(options)","net.connect(port,host)","net.createConnection(options)","new Socket().connect(port,host)","hostname lookup","http.get","fetch"])expect(out[name],name).toMatch(/^refused:.*RENDER_NETWORK_REFUSED/);
    expect(out.loopback).toBe("connected");expect(out["missing host (localhost)"]).toBe("connected");
    expect(hits).toBe(0);// no HTTP request reached the server (the loopback probes only open a socket)
  },60000);
});
