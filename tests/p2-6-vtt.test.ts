// T-155 P2-6 S1: WebVTT of the timeline's subtitle layers (pure). The bundle side (only timeline bundles with at least
// one subtitle; P1 r1, SRT and other files unchanged) is checked in tests/jobs.test.ts and tests/p2-3-text-editor.test.ts.
import { v7 } from "uuid";
import { describe, expect, it } from "vitest";
import { framesToMs, timelineSrt, timelineVtt, vttCueText, type TimelineText } from "@/lib/edit/timeline";

const layer=(over:{content?:string;kind?:TimelineText["kind"];start:number;end:number;id?:string}):TimelineText=>({
  id:over.id??v7(),kind:over.kind??"subtitle",content:over.content??"자막",speakerCharacterId:null,
  box:{x:0.1,y:0.8,width:0.8,height:0.1,anchor:"center"},
  style:{fontFamily:"Pretendard",fontWeight:700,fontSize:64,color:"#FFFFFF",strokeColor:null,strokeWidth:0,shadow:false,background:null,align:"center",lineHeight:1.2},
  timing:{startFrame:over.start,endFrame:over.end},animation:{in:"none",out:"none",emphasis:"none",durationFrames:0,easing:"ease-out"},locked:false,
} as unknown as TimelineText);

describe("timelineVtt (T-155)",()=>{
  it("형식: WEBVTT 머리, LF만, BOM 없음, cue id = layer id, HH:MM:SS.mmm, 끝에 줄바꿈 하나",()=>{
    const id="019b8b74-3f10-7137-8265-68b11d809f0c",vtt=timelineVtt([layer({id,start:4,end:75,content:"샘플 수동 자막"})])!;
    expect(vtt).toBe(`WEBVTT\n\n${id}\n00:00:00.133 --> 00:00:02.500\n샘플 수동 자막\n`);
    expect(vtt.includes("\r")).toBe(false);expect(Buffer.from(vtt,"utf8")[0]).toBe(0x57);
  });
  it("프레임 → 밀리초는 SRT와 같은 값이고 프레임 경계와 0.5 ms 이내",()=>{
    for(const frame of [0,1,2,29,30,31,899,900,1799,17999,18000,107999]){
      const ms=framesToMs(frame);expect(Math.abs(ms-frame*1000/30)).toBeLessThanOrEqual(0.5);
      const vtt=timelineVtt([layer({start:frame,end:frame+1})])!,srt=timelineSrt([layer({start:frame,end:frame+1})]);
      expect(vtt.split("\n")[3].split(" --> ")[0].replace(".",",")).toBe(srt.split("\n")[1].split(" --> ")[0]);
    }
    expect(timelineVtt([layer({start:1,end:2})])).toContain("00:00:00.033 --> 00:00:00.067");
    expect(timelineVtt([layer({start:107999,end:108000})])).toContain("00:59:59.967 --> 01:00:00.000");
  });
  it("본문: & < > escape(--> 포함), CRLF·CR → LF, 빈 줄 제거, 앞뒤 공백 trim, 한글·이모지 그대로",()=>{
    expect(vttCueText("  A & B <i>x</i> --> 끝 😀  ")).toBe("A &amp; B &lt;i&gt;x&lt;/i&gt; --&gt; 끝 😀");
    expect(vttCueText("첫 줄\r\n\r\n  \r둘째 줄\r셋째")).toBe("첫 줄\n둘째 줄\n셋째");
    const vtt=timelineVtt([layer({start:0,end:30,content:"a\r\n\r\nb --> c"})])!;
    expect(vtt.split("\n\n")).toHaveLength(2);expect(vtt).not.toMatch(/-->.*-->/);
    expect(Buffer.from(vtt,"utf8").toString("utf8")).toBe(vtt);
  });
  it("대상과 순서: subtitle만, 시작·끝·id 순, 겹침 유지, 같은 입력은 같은 바이트, 자막이 없으면 null",()=>{
    const a=layer({id:"019b8b74-3f10-7137-8265-000000000002",start:30,end:90,content:"둘"}),b=layer({id:"019b8b74-3f10-7137-8265-000000000001",start:30,end:90,content:"하나"});
    const c=layer({start:0,end:60,content:"먼저"}),d=layer({start:30,end:45,content:"짧은"}),hook=layer({kind:"hook",start:0,end:30,content:"후킹"}),note=layer({kind:"disclosure",start:0,end:90,content:"광고"});
    const vtt=timelineVtt([a,hook,b,d,note,c])!,texts=vtt.split("\n\n").slice(1).map(cue=>cue.split("\n")[2]);
    expect(texts).toEqual(["먼저","짧은","하나","둘"]);expect(vtt).not.toContain("후킹");expect(vtt).not.toContain("광고");
    expect(timelineVtt([c,b,a,d])).toBe(vtt);expect(timelineVtt([d,c,a,b])).toBe(timelineVtt([a,b,c,d]));
    expect(timelineVtt([])).toBeNull();expect(timelineVtt([hook,note])).toBeNull();
  });
});
