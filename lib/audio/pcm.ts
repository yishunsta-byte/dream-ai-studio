import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

// Streaming reads of interleaved stereo f32le PCM (the mix and decoded results). Nothing here loads a whole file.
export type PcmScan={sha256:string;bytes:number;frames:number;peak:number;nonFinite:number;firstAbove:number|null};
// `firstAbove`: first sample frame whose absolute value is above `onset` in any channel (used to compare offsets).
export function scanner(channels=2,onset=1e-3){
  const hash=createHash("sha256");let bytes=0,peak=0,nonFinite=0,firstAbove:number|null=null,carry:Buffer=Buffer.alloc(0);
  return {
    push(chunk:Buffer){hash.update(chunk);const data=carry.length?Buffer.concat([carry,chunk]):chunk,whole=data.length-(data.length%4);
      for(let at=0;at<whole;at+=4){const value=data.readFloatLE(at);if(!Number.isFinite(value)){nonFinite++;continue;}const abs=Math.abs(value);if(abs>peak)peak=abs;if(firstAbove===null&&abs>onset)firstAbove=Math.floor((bytes+at-carry.length)/(4*channels));}
      bytes+=chunk.length;carry=data.subarray(whole);},
    done():PcmScan{return {sha256:hash.digest("hex"),bytes,frames:Math.floor(bytes/(4*channels)),peak,nonFinite,firstAbove};},
  };
}
export async function scanFile(path:string,channels=2){const scan=scanner(channels);for await(const chunk of createReadStream(path))scan.push(chunk as Buffer);return scan.done();}
export async function sha256File(path:string){const hash=createHash("sha256");let size=0;for await(const chunk of createReadStream(path)){hash.update(chunk as Buffer);size+=(chunk as Buffer).length;}return {sha256:hash.digest("hex"),sizeBytes:size};}
