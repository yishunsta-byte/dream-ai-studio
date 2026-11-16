import specPresets from "@/docs/spec/text-presets.json";
import { TEXT_KINDS, timelineTextSchema, type TimelineText } from "./timeline";

// P2-3 default text looks (spec text-presets.json, planner owned). Read from the file as they are, never copied into
// the database (U-5 "my looks" is later). Checked against the timeline schema when this module loads, so a spec
// value the timeline cannot store fails loudly instead of being bent quietly.
export type TextKind=TimelineText["kind"];
type RawPreset={kind:TextKind;label:string;description:string;style:TimelineText["style"];box:TimelineText["box"];animation:TimelineText["animation"];locked:boolean;recommendedCharsPerLine:number;fixedTexts?:Record<string,string[]>};
export type TextPreset=RawPreset;
const raw=(specPresets as unknown as {presets:RawPreset[];animationLabels:Record<string,string>}).presets;
const probeId="0190a000-0000-7000-8000-000000000001";
export const PRESETS:Readonly<Record<TextKind,TextPreset>>=Object.fromEntries(TEXT_KINDS.map(kind=>{
  const preset=raw.find(item=>item.kind===kind);if(!preset)throw new Error(`text-presets.json has no preset for ${kind}`);
  timelineTextSchema.parse({id:probeId,kind,content:"가",speakerCharacterId:null,style:preset.style,box:preset.box,timing:{startFrame:0,endFrame:1},animation:preset.animation,locked:preset.locked});
  return [kind,preset];
})) as Record<TextKind,TextPreset>;
export const ANIMATION_LABELS:Readonly<Record<string,string>>=(specPresets as unknown as {animationLabels:Record<string,string>}).animationLabels;
// T-080 5.3 / R-1: quick looks are the seven kinds without the disclosure look.
export const QUICK_LOOK_KINDS=TEXT_KINDS.filter(kind=>kind!=="disclosure");
export const presetFor=(kind:TextKind)=>PRESETS[kind];
export const kindLabel=(kind:TextKind)=>PRESETS[kind].label;
