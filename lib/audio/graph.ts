import { CHANNELS, DUCK, FADE_CURVE, JOIN_CURVE, SAMPLE_RATE, SAMPLES_PER_FRAME } from "./profile";

// The FFmpeg filter graph for one mix, built only from checked integers and fixed profile words (no caller text).
// Each clip is input i (its pinned copy), decoded to 48 kHz stereo f32, cut by samples, given its gain and fades,
// placed by a sample delay and padded to the exact output length. Buses: voice, ducked music (compressed by the voice
// bus signal when there is voice), other music, effects; then summed without normalization (the loudness step
// follows on the whole mix).
export type GraphClip={input:number;channels:1|2;role:"voice"|"music"|"effect";startFrame:number;sourceInFrame:number;durationFrames:number;gainDb:number;
  fadeIn:{frames:number;curve:"tri"|"qsin"};fadeOut:{frames:number;curve:"tri"|"qsin"};duck:boolean};
const int=(value:number)=>{if(!Number.isSafeInteger(value)||value<0)throw new Error(`graph value ${value}`);return String(value);};
// gain in dB as plain decimal text (the schema bounds it to -60..12)
const db=(value:number)=>{if(!Number.isFinite(value)||value<-60||value>12)throw new Error(`graph gain ${value}`);return `${Number(value.toFixed(6))}dB`;};
export function mixGraph(clips:readonly GraphClip[],outputFrames:number){
  const total=outputFrames*SAMPLES_PER_FRAME,parts:string[]=[],labels={voice:[] as string[],duck:[] as string[],music:[] as string[],effect:[] as string[]};
  int(outputFrames);
  clips.forEach((clip,index)=>{
    // frames are checked before they are turned into samples (1.5 frames × 1600 would look like a whole number)
    for(const value of [clip.input,clip.startFrame,clip.sourceInFrame,clip.durationFrames,clip.fadeIn.frames,clip.fadeOut.frames])int(value);
    if(clip.durationFrames<1||clip.fadeIn.frames+clip.fadeOut.frames>clip.durationFrames||clip.startFrame+clip.durationFrames>outputFrames)throw new Error("graph clip range");
    const start=clip.sourceInFrame*SAMPLES_PER_FRAME,length=clip.durationFrames*SAMPLES_PER_FRAME,chain=[`aresample=${SAMPLE_RATE}`,clip.channels===1?"pan=stereo|c0=c0|c1=c0":"aformat=channel_layouts=stereo",
      `atrim=start_sample=${int(start)}:end_sample=${int(start+length)}`,"asetpts=N/SR/TB",`volume=${db(clip.gainDb)}`];
    if(clip.fadeIn.frames)chain.push(`afade=t=in:ss=0:ns=${int(clip.fadeIn.frames*SAMPLES_PER_FRAME)}:curve=${clip.fadeIn.curve===JOIN_CURVE?JOIN_CURVE:FADE_CURVE}`);
    if(clip.fadeOut.frames){const n=clip.fadeOut.frames*SAMPLES_PER_FRAME;chain.push(`afade=t=out:ss=${int(length-n)}:ns=${int(n)}:curve=${clip.fadeOut.curve===JOIN_CURVE?JOIN_CURVE:FADE_CURVE}`);}
    if(clip.startFrame)chain.push(`adelay=delays=${int(clip.startFrame*SAMPLES_PER_FRAME)}S:all=1`);
    chain.push(`apad=whole_len=${int(total)}`,`atrim=end_sample=${int(total)}`);
    const label=`c${index}`;parts.push(`[${int(clip.input)}:a:0]${chain.join(",")}[${label}]`);
    (clip.role==="voice"?labels.voice:clip.role==="effect"?labels.effect:clip.duck?labels.duck:labels.music).push(label);
  });
  const bus=(list:string[],name:string)=>{if(!list.length)return null;parts.push(list.length===1?`[${list[0]}]anull[${name}]`:`${list.map(item=>`[${item}]`).join("")}amix=inputs=${list.length}:normalize=0:duration=longest[${name}]`);return name;};
  const finals:string[]=[],voice=bus(labels.voice,"voice"),duck=bus(labels.duck,"duck");
  if(voice&&duck){parts.push("[voice]asplit=2[voicel][voicec]",`[duck][voicec]sidechaincompress=threshold=${DUCK.threshold}:ratio=${DUCK.ratio}:attack=${DUCK.attack}:release=${DUCK.release}:makeup=${DUCK.makeup}:link=${DUCK.link}:detection=${DUCK.detection}[ducked]`);finals.push("voicel","ducked");}
  else{if(voice)finals.push(voice);if(duck)finals.push(duck);}// no voice: ducked music is left as it is
  for(const name of [bus(labels.music,"music"),bus(labels.effect,"effect")])if(name)finals.push(name);
  if(!finals.length)throw new Error("graph without clips");
  const tail=`atrim=end_sample=${int(total)},aformat=sample_fmts=flt:sample_rates=${SAMPLE_RATE}:channel_layouts=${CHANNELS===2?"stereo":"mono"}`;
  parts.push(finals.length===1?`[${finals[0]}]${tail}[out]`:`${finals.map(item=>`[${item}]`).join("")}amix=inputs=${finals.length}:normalize=0:duration=longest,${tail}[out]`);
  return parts.join(";");
}
