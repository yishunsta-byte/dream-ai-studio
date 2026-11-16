// P2-4b render file name (T-101 2.6, T-102 13장 final/ rule, Master D-6). One function for the shown name, the
// download name and a later ZIP final/ entry: {slug}_{aspect}_r{timeline revision}[_SAMPLE][-N].mp4.
// The slug keeps Korean; only characters Windows forbids (and control characters) become "_", a Windows reserved
// device name gets a leading "_", and the slug is cut to 80 characters (by code point). Pure: client and server.
// eslint-disable-next-line no-control-regex -- control characters are exactly what a file name must not hold
const FORBIDDEN=/[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const RESERVED=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
export const SLUG_MAX=80;
export function renderSlug(title:string){
  let slug=title.normalize("NFC").replace(FORBIDDEN,"_").replace(/\s+/g," ").trim().replace(/[. ]+$/,"").replace(/^[. ]+/,"");
  if(!slug)slug="영상";
  if(RESERVED.test(slug))slug=`_${slug}`;
  const chars=[...slug];return chars.length>SLUG_MAX?chars.slice(0,SLUG_MAX).join("").replace(/[. ]+$/,"")||"영상":slug;
}
export const aspectLabel=(aspect:"9:16"|"16:9"|"1:1")=>aspect.replace(":","x");
export function renderFileName(input:{title:string;aspect:"9:16"|"16:9"|"1:1";timelineRevision:number;isSample:boolean;seq:number}){
  if(!Number.isSafeInteger(input.timelineRevision)||input.timelineRevision<1||!Number.isSafeInteger(input.seq)||input.seq<1)throw new Error("render name numbers");
  return `${renderSlug(input.title)}_${aspectLabel(input.aspect)}_r${input.timelineRevision}${input.isSample?"_SAMPLE":""}${input.seq>1?`-${input.seq}`:""}.mp4`;
}
