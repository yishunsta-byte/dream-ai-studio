/* global URL, process, console */
// Synthetic same-origin store and real admin/public view components.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import {createServer} from "node:http";
import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";
const repo=fileURLToPath(new URL("../../",import.meta.url));
const port=Number(process.env.DREAM_PREMIERE_FIXTURE_PORT ?? 0);
const require=createRequire(new URL("../../package.json",import.meta.url));
const app=`
import {AdminHub} from "@/components/admin/admin-hub";
import {PublicationHttpQueue} from "@/components/admin/publication-http-queue";
import {PublishedAnalysisResults, type PublishedAnalysisItem} from "@/components/reference-analysis/published-analysis-results";
import styles from "@/components/admin/admin.module.css";
import "@/app/globals.css";
const account = "premiere-fixture@example.invalid";
const application=<div className={styles.console}>
  <header className={styles.header}><a className={styles.brand} href="/admin">DREAM <em>SCREEN</em></a><span>분석 결과 공개 검수 · 예시 저장</span></header>
  <main className="content"><AdminHub email={account} projects={{kind:"unlinked"}} review={<PublicationHttpQueue initial={{kind:"closed"}}/>}/></main>
</div>;
`;
const transport=`
const basicImage = {schemaVersion:1,status:"ready",media:"image",proposals:[{media:"image",selectionId:"fixture-image",observations:[{kind:"observation",findingId:"fixture-color",measure:"region_color_luminance",location:{kind:"region",x:0,y:0,width:1,height:1},alphaCoverage:1,palette:[{bucket:"#3366cc",visibleShare:0.6}],luminanceShares:[0.25,0.25,0.25,0.25],luminanceEdges:[0,0.25,0.5,0.75,1]}],draft:{kind:"creative_proposal",target:"image",prompt:"Image base prompt"}}]};
const imageMeaning={status:"partial",provider:"gemini",findings:["people","objects","actions","context","composition","lighting"].map(category=>category==="composition"?{category,certainty:"estimated",description:"오른쪽 인물과 도심 배경",basis:"원본 확인용 근거"}:category==="lighting"?{category,certainty:"estimated",description:"https://private.example.invalid/raw",basis:"사적 근거"}:{category,certainty:"unconfirmed"}),prompts:{ko:"프리미어 이미지 제안",en:"Premiere image suggestion"}};
const musicMeaning={semantic:{status:"ready",provider:"gemini",report:{genre:"앰비언트",instruments:["피아노"],tempoBpm:96,structure:[{label:"도입",description:"피아노로 시작"}],sunoPrompt:"Premiere fixture music"}}};
const shortsMeaning={result:{evidence:"youtube_video",findings:{summary:"프리미어 검수 영상",hook:null,composition:null,sound:null,segments:[{timestamp:"00:01",evidence:"샘플 첫 장면"}],draftPrompt:"Premiere fixture Shorts"}}};
type RequestRow = { path:string; method:string; headers:Record<string,string>; body:unknown; aborted:boolean; resolve?:()=>void };
const realFetch=window.fetch.bind(window);
const requests:RequestRow[]=[];
const fixture={
  // ?analysisStatus=music:not_configured,shorts:not_configured 처럼 주소로 분석기 설정 상태를 바꿔 시작할 수 있다.
  statuses:{image:"configured",music:"configured",shorts:"configured",...Object.fromEntries((new URLSearchParams(location.search).get("analysisStatus")??"")
    .split(",").map(pair=>pair.split(":")).filter(([program,status])=>["image","music","shorts"].includes(program)&&["configured","not_configured","login"].includes(status)))} as Record<string,string>,
  hold:"", publicationFault:"",
  // 이미지 분석 응답의 선택 형제 필드(예: Backend 제안 styleDna). 비워 두면 지금 응답 그대로.
  imageExtra:undefined as Record<string,unknown>|undefined,
  credentials:{storage:"ready",groups:{reference:{version:0,updatedAt:null},music:{version:0,updatedAt:null}},
    programs:{image:{configured:false,source:"none",modelId:null,lastTest:null},shorts:{configured:false,source:"none",modelId:null,lastTest:null},music:{configured:false,source:"none",modelId:null,lastTest:null}}} as {storage:string;groups:Record<string,{version:number;updatedAt:string|null}>;programs:Record<string,{configured:boolean;source:string;modelId:string|null;lastTest:unknown}>},
  testOutcome:{status:"verified",code:null} as {status:string;code:string|null},
  credentialFaults:[] as {status:number;body:unknown}[],
  requests:()=>requests.map(({path,method,headers,body,aborted})=>({path,method,headers,body,aborted})),
  release:()=>requests.forEach(row=>row.resolve?.()),
};
(window as unknown as {__premiere:unknown}).__premiere=fixture;
window.fetch=async(raw,init)=>{
  const path=String(raw);
  const method=init?.method??"GET";
  const body=init?.body instanceof File ? {name:init.body.name,size:init.body.size} : init?.body ? JSON.parse(String(init.body)) : null;
  const row:RequestRow={path,method,headers:Object.fromEntries(new Headers(init?.headers)),body,aborted:false};
  init?.signal?.addEventListener("abort",()=>{row.aborted=true;});
  requests.push(row);
  const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
  if(path==="/api/admin/reference-publications") {
    const fault=fixture.publicationFault;
    if (fault && (method==="POST" || fault==="login")) fixture.publicationFault="";
    if (fault==="login") return response({},401);
    if (fault==="conflict" && method==="POST") return response({error:"publication_conflict"},409);
    if (fault==="invalid" && method==="POST") return response({error:"invalid_publication"},400);
    if (fixture.hold==="publication" && method==="POST") await new Promise<void>(resolve=>{row.resolve=resolve;});
    const reply=await realFetch(path,init);
    if(fault==="lost"&&method==="POST") throw new TypeError("Fixture lost a completed publication response");
    return reply;
  }
  const key:Record<string,string>={"/api/admin/reference-analysis":"image","/api/admin/music-semantic":"music","/api/admin/shorts-analysis":"shorts"};
  const program=key[path];
  if(program){
    if (method==="GET" && fixture.statuses[program]==="login") return response({},401);
    if (method==="GET") return response({semantic:{[program]:fixture.statuses[program]}});
    if (method==="POST" && fixture.hold===program) await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (method==="POST" && program==="image") return response({result:basicImage,semantic:imageMeaning,...fixture.imageExtra});
    if (method==="POST" && program==="music") return response(musicMeaning);
    if (method==="POST" && program==="shorts") return response(shortsMeaning);
  }
  if(path==="/api/admin/analysis-credentials/test"&&method==="POST"){
    // 합성 연결 시험(Backend 계약 msg_cb4ee4e63485): 저장된 버전만, 버전이 다르면 409.
    if (fixture.hold==="credential-test") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=fixture.credentialFaults.shift();
    if (fault) return response(fault.body,fault.status);
    const test=body as {program:string;group:string;version:number};
    const group=fixture.credentials.groups[test.group];
    if (!group || test.version<1) return response({code:"invalid_input",error:"invalid"},400);
    if (test.version!==group.version) return response({code:"stale",error:"stale"},409);
    const result={version:test.version,status:fixture.testOutcome.status,code:fixture.testOutcome.code,checkedAt:new Date().toISOString()};
    fixture.credentials.programs[test.program].lastTest=result;
    return response({program:test.program,...result});
  }
  if(path==="/api/admin/analysis-credentials"){
    // 합성 키 저장 경로(Backend 계약 msg_bb18c2ae5fd0): 다음 응답 오류를 credentialFaults로 주입하고, PUT은 버전·출처를 갱신한다.
    if (fixture.hold==="credentials" && method==="PUT") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=fixture.credentialFaults.shift();
    if (fault) return response(fault.body,fault.status);
    if (method==="PUT") {
      const save=body as {group:string;expectedVersion:number;apiKey?:string;models:Record<string,string>};
      const group=fixture.credentials.groups[save.group];
      if (save.expectedVersion!==group.version) return response({code:"stale",error:"stale"},409);
      group.version+=1; group.updatedAt=new Date().toISOString();
      for (const [program,modelId] of Object.entries(save.models)) {
        const item=fixture.credentials.programs[program];
        item.modelId=modelId; item.lastTest=null; if (save.apiKey) item.source="stored"; item.configured=item.source!=="none";
      }
    }
    return response(fixture.credentials);
  }
  if(path==="/api/admin/render-queue"&&method==="GET") return response({jobs:[]});
  return response({},404);
};
`;
const plugins=[{name:"fixture-server-boundaries",setup(builder){
  builder.onResolve({filter:/^(next\/link|@\/lib\/cloud\/project-read-page)$/},args=>({path:args.path,namespace:"fixture"}));
  builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({loader:"tsx",resolveDir:repo,contents:args.path==="next/link"
    ?"import { createElement } from 'react'; export default function Link({ href, ...rest }) { return createElement('a', { href, ...rest }); }"
    :"export async function readCloudProjects() { throw new Error('Storage is outside this UI fixture'); }"}));
}}];
const common={absWorkingDir:repo, bundle:true,jsx:"automatic",write:false,define:{"process.env.NODE_ENV":'"production"'},external:["/showcase/*"],plugins};
const browser=await build({...common,outfile:"fixture.js",stdin:{loader:"tsx",resolveDir:repo,contents:
  'import {hydrateRoot} from "react-dom/client";'+app+transport+'hydrateRoot(document.getElementById("root")!,application);'}});
const ssr=await build({...common,outfile:"fixture.cjs",platform:"node",format:"cjs",stdin:{loader:"tsx",resolveDir:repo,contents:
  'import {renderToString} from "react-dom/server";'+app+'export const markup=renderToString(application);export function publicPage(items:readonly PublishedAnalysisItem[]){return renderToString(<PublishedAnalysisResults feed={{kind:"ok",items}}/>);}'}});
const js=browser.outputFiles.find(file=>file.path.endsWith(".js")).text;
const css=browser.outputFiles.find(file=>file.path.endsWith(".css")).text;
const evaluated={exports:{}};
new Function("require","module","exports",ssr.outputFiles.find(file=>file.path.endsWith(".cjs")).text)(require,evaluated,evaluated.exports);
const markup=evaluated.exports.markup;
const saved = new Map();
const previews = new Set(["/showcase/t240/orchid.png","/showcase/t240/celestial.png","/showcase/t240/desert-motion.png"]);
const server=createServer(async (request,response)=>{
  const path=new URL(request.url,"http://127.0.0.1").pathname;
  if(path==="/analysis-results") {
    const items=[...saved.values()].reverse().filter(item=>item.status==="published")
      .map(({id,title,summary,prompt,media,publishedAt})=>({id,title,summary,prompt,media,publishedAt}));
    return response.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}).end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/fixture.css">'+evaluated.exports.publicPage(items));
  }
  if(path==="/api/admin/reference-publications") {
    const send=(value,status=200)=>response.writeHead(status,{"content-type":"application/json","cache-control":"no-store"}).end(JSON.stringify(value));
    if (request.method==="GET") return send({items:[...saved.values()].reverse()});
    let data="";
    for await(const part of request){data+=part;if(data.length>9000)return send({},413);}
    try {
      const body=JSON.parse(data);
      if(request.method==="POST"){
        if (Object.keys(body).sort().join(",")!=="authorized,id,media,prompt,summary,title"||body.authorized!==true) return send({error:"invalid_publication"},400);
        const existing=saved.get(body.id);
        if(existing && ["title","summary","prompt","media"].some(key=>existing[key]!==body[key])) return send({error:"publication_conflict"},409);
        const {id,title,summary,prompt,media}=body;
        const item=existing??{id,title,summary,prompt,media,publishedAt:"2026-11-20T11:00:00.000Z",status:"published"};
        saved.set(id,item);
        return send({item});
      }
      if(request.method==="DELETE"&&Object.keys(body).join(",")==="id"&&saved.has(body.id)){
        saved.set(body.id,{...saved.get(body.id),status:"revoked"});
        return send({ok:true});
      }
    } catch { return send({},400); }
    return send({},404);
  }
  if(path==="/admin"||path==="/") return response.writeHead(200,{"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; media-src blob: 'self'; style-src 'self' 'unsafe-inline'"}).end(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>프리미어 스튜디오 관리자 검수</title><link rel="stylesheet" href="/fixture.css"><div id="root">'+markup+'</div><script src="/fixture.js" defer></script>');
  if(path==="/fixture.js") return response.writeHead(200,{"content-type":"application/javascript"}).end(js);
  if(path==="/fixture.css") return response.writeHead(200,{"content-type":"text/css"}).end(css);
  if(previews.has(path)) {
    try { return response.writeHead(200,{"content-type":"image/png"}).end(await readFile(repo+"/public"+path)); }
    catch { return response.end(); }
  }
  response.writeHead(404).end();
});
server.listen(port,"127.0.0.1",()=>console.log("PREMIERE-READY http://127.0.0.1:"+server.address().port));
