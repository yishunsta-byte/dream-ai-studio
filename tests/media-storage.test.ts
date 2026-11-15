import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { receiveUpload } from "@/lib/storage/upload";
import { resolveStoredFile } from "@/lib/storage/paths";
import { inspectMedia } from "@/lib/media/inspect";
import { mediaBinary, runMedia } from "@/lib/media/tools";
import { parseByteRange } from "@/lib/media/range";

const ffmpeg=mediaBinary("ffmpeg"),ffprobe=mediaBinary("ffprobe");
const hasMedia=existsSync(ffmpeg)&&existsSync(ffprobe);
let root:string,fixtures:string,png:Buffer;
function clean(path:string){if(!resolve(path).startsWith(resolve(tmpdir())+sep))throw new Error("임시 경로 밖 정리 금지");rmSync(path,{recursive:true,force:true});}
function body(bytes:Uint8Array){return new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes);controller.close();}});}
beforeAll(async()=>{
 fixtures=mkdtempSync(join(tmpdir(),"dream-ai-media-fixtures-"));
 png=await sharp({create:{width:16,height:24,channels:3,background:{r:20,g:100,b:80}}}).png().toBuffer();
 writeFileSync(join(fixtures,"image.png"),png);
 if(hasMedia){
  await runMedia(ffmpeg,["-v","error","-n","-f","lavfi","-i","anullsrc=r=22050:cl=mono","-t","0.4","-c:a","libmp3lame",join(fixtures,"sound.mp3")],{timeout:30000,windowsHide:true});
  await runMedia(ffmpeg,["-v","error","-n","-f","lavfi","-i","color=c=black:s=160x284:r=10","-t","0.5","-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart",join(fixtures,"clip.mp4")],{timeout:30000,windowsHide:true});
 }
});
afterAll(()=>clean(fixtures));
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),"dream-ai-media-"));mkdirSync(join(root,"storage"));vi.spyOn(process,"cwd").mockReturnValue(root);vi.stubEnv("FFPROBE_PATH",ffprobe);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();clean(root);});
describe("원본 저장과 실제 형식 검사",()=>{
 it("PNG를 스트리밍 저장하고 실제 크기·해상도·해시를 기록한다",async()=>{
   const saved=vi.fn();const id=await receiveUpload(body(png),"샘플.png",saved);
   expect(saved).toHaveBeenCalledOnce();const data=saved.mock.calls[0][0];
   expect(data).toMatchObject({id,title:"샘플.png",kind:"image",mime:"image/png",width:16,height:24,sizeBytes:png.length,sha256:createHash("sha256").update(png).digest("hex")});
   expect(readFileSync(resolveStoredFile(data.filePath)!)).toEqual(png);expect(readdirSync(join(root,"storage/tmp"))).toEqual([]);
 });
 it("같은 파일 이름을 다시 올려도 원본을 덮어쓰지 않는다",async()=>{
   const first=await receiveUpload(body(png),"../same.png",()=>{});const second=await receiveUpload(body(png),"same.png",()=>{});
   expect(first).not.toBe(second);expect(readdirSync(join(root,"storage/library"))).toHaveLength(2);
 });
 it("실제 PNG의 가짜 확장자와 실행 파일을 거부하고 잔여 파일을 지운다",async()=>{
   const save=vi.fn();await expect(receiveUpload(body(png),"false.jpg",save)).rejects.toMatchObject({code:"EXTENSION_MISMATCH"});
   const executable=Buffer.alloc(512);executable.write("MZ");await expect(receiveUpload(body(executable),"false.png",save)).rejects.toMatchObject({code:"UNSUPPORTED_FORMAT"});
   expect(save).not.toHaveBeenCalled();expect(readdirSync(join(root,"storage/tmp"))).toEqual([]);expect(readdirSync(join(root,"storage/library"))).toEqual([]);
 });
 it("크기 한도 초과와 DB 저장 실패는 성공으로 남기지 않는다",async()=>{
   vi.stubEnv("MAX_UPLOAD_BYTES","10");const save=vi.fn();await expect(receiveUpload(body(png),"sample.png",save)).rejects.toMatchObject({status:413});expect(save).not.toHaveBeenCalled();
   vi.stubEnv("MAX_UPLOAD_BYTES",String(2*1024**3));await expect(receiveUpload(body(png),"sample.png",()=>{throw new Error("DB failed");})).rejects.toMatchObject({code:"STORAGE_FAILED"});
   expect(readdirSync(join(root,"storage/tmp"))).toEqual([]);expect(readdirSync(join(root,"storage/library"))).toEqual([]);
 });
 it("취소된 업로드는 DB에 저장하지 않고 임시 파일을 정리한다",async()=>{
   const controller=new AbortController();controller.abort();const save=vi.fn();
   await expect(receiveUpload(body(png),"canceled.png",save,controller.signal)).rejects.toMatchObject({code:"UPLOAD_CANCELED"});expect(save).not.toHaveBeenCalled();expect(readdirSync(join(root,"storage/tmp"))).toEqual([]);expect(readdirSync(join(root,"storage/library"))).toEqual([]);
 });
 it("UTF-8 글자 파일을 허용하고 이진 내용은 거부한다",async()=>{
   const save=vi.fn();await receiveUpload(body(Buffer.from("샘플 글자\n둘째 줄","utf8")),"sample.txt",save);expect(save.mock.calls[0][0].mime).toBe("text/plain");
   await expect(receiveUpload(body(Buffer.from([0,1,255,0])),"fake.txt",()=>{})).rejects.toThrow();
 });
 it("경로 조작과 storage 밖을 가리키는 junction을 차단한다",async()=>{
   mkdirSync(join(root,"outside"));writeFileSync(join(root,"outside/test.txt"),"preserve");symlinkSync(join(root,"outside"),join(root,"storage/escape"),"junction");
   expect(resolveStoredFile("escape/test.txt")).toBeNull();for(const path of ["../outside/test.txt","/outside.txt","C:/outside.txt","library\\test.txt"])expect(resolveStoredFile(path)).toBeNull();
   symlinkSync(join(root,"outside"),join(root,"storage/library"),"junction");await expect(receiveUpload(body(png),"test.png",()=>{})).rejects.toMatchObject({code:"STORAGE_FAILED"});expect(readdirSync(join(root,"outside"))).toEqual(["test.txt"]);
 });
 it.skipIf(!hasMedia)("ffprobe로 MP3·MP4의 실제 길이와 해상도를 검사한다",async()=>{
   expect(await inspectMedia(join(fixtures,"sound.mp3"),"sound.mp3")).toMatchObject({kind:"audio",mime:"audio/mpeg"});
   const video=await inspectMedia(join(fixtures,"clip.mp4"),"clip.mp4");expect(video).toMatchObject({kind:"video",width:160,height:284});expect(video.durationMs).toBeGreaterThan(0);
 });
 it("표준·접미·열린 범위와 잘못된 Range를 처리한다",()=>{
   expect(parseByteRange("bytes=0-9",100)).toEqual({ok:true,start:0,end:9,partial:true});expect(parseByteRange("bytes=-10",100)).toMatchObject({start:90,end:99});expect(parseByteRange("bytes=90-",100)).toMatchObject({start:90,end:99});
   for(const range of ["bytes=100-","bytes=3-2","bytes=-0","bytes=0-1,3-4","not-bytes","bytes=-"])expect(parseByteRange(range,100)).toEqual({ok:false});
 });
});
