import "server-only";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { READABLE_FONT_FAMILIES, SPEC_FONTS, type FontFamily, type FontRef } from "@/lib/edit/fonts";

// P2-3 font registry (spec fonts.json installRule, T-082 file contract msg_7cdbc56d1a83). A font is selectable only
// when its folder under public/fonts holds exactly one font file (.ttf/.otf/.woff2) and an OFL.txt whose whole text
// names "SIL Open Font License" and "Version 1.1". Pretendard keeps its P1 place (public/fonts itself).
export type FontStatus={family:string;folder:string;role:string;weights:number[];installed:boolean;reason:string|null;file:string|null;license:string|null;url:string|null};
const FONT_FILE=/\.(ttf|otf|woff2)$/i;
export const FONT_MIME:Record<string,string>={ttf:"font/ttf",otf:"font/otf",woff2:"font/woff2"};
const normalize=(text:string)=>text.replace(/\s+/g," ").toLowerCase();
export function licenseOk(text:string){const value=normalize(text);return value.includes("sil open font license")&&value.includes("version 1.1");}
export function fontStatuses(root=process.cwd()):FontStatus[]{
  return SPEC_FONTS.map(font=>{
    const dir=join(root,"public","fonts",...(font.folder?[font.folder]:[])),base={family:font.family,folder:font.folder,role:font.role,weights:[...font.weights]};
    const fail=(reason:string):FontStatus=>({...base,installed:false,reason,file:null,license:null,url:null});
    if(!(READABLE_FONT_FAMILIES as readonly string[]).includes(font.family))return fail("읽기 목록에 없는 글꼴이에요.");
    if(font.license!=="OFL-1.1")return fail("OFL 1.1 글꼴이 아니에요.");
    let names:string[];try{names=readdirSync(dir).filter(name=>{try{return statSync(join(dir,name)).isFile();}catch{return false;}});}catch{return fail("글꼴 폴더가 없어요.");}
    const files=names.filter(name=>FONT_FILE.test(name));if(files.length!==1)return fail(files.length?"글꼴 파일이 두 개 이상이에요.":"글꼴 파일이 없어요.");
    let license:string;try{license=readFileSync(join(dir,"OFL.txt"),"utf8");}catch{return fail("라이선스 파일(OFL.txt)이 없어요.");}
    if(!licenseOk(license))return fail("라이선스 파일에 OFL 1.1 본문이 없어요.");
    const url=`/fonts/${font.folder?`${font.folder}/`:""}${encodeURIComponent(files[0])}`;
    return {...base,installed:true,reason:null,file:join(dir,files[0]),license:join(dir,"OFL.txt"),url};
  });
}
// The fonts the editor may offer and the server accepts for new or changed text (spec ∩ installed ∩ license).
export function selectableFonts(root=process.cwd()):FontRef[]{
  return fontStatuses(root).filter(font=>font.installed).map(font=>({family:font.family as FontFamily,role:font.role,weights:font.weights,url:font.url!}));
}
