/* global URL, process, console, setTimeout */
// 작업실 기준 관리 화면(AdminHub) 대역: 실제 관리 부품을 esbuild로 묶고, 브라우저 안 fetch 대역(window.__premiere)으로 서버 응답을 만든다.
// 594dff8 admin-premiere-publication-run.mjs에서 이 기준에 있는 화면(이미지 분석·작업실 문맥·API 연동)만 남겼다. 키는 합성 값만 쓴다.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
const repo = fileURLToPath(new URL("../../", import.meta.url));
const port = Number(process.env.DREAM_ADMIN_HUB_FIXTURE_PORT ?? 0);
const require = createRequire(new URL("../../package.json", import.meta.url));
const app = `
import {AdminHub} from "@/components/admin/admin-hub";
import {AdminOperationsHome} from "@/components/admin/admin-operations-home";
import {PublicationHttpQueue} from "@/components/admin/publication-http-queue";
import styles from "@/components/admin/admin.module.css";
import "@/app/globals.css";
import {SessionBoundary} from "@/components/auth/session-boundary";
import {AdminStyleDnaWorkflow} from "@/components/admin/admin-style-dna-workflow";
const account = "hub-fixture@example.invalid";
// 실제 /admin 페이지처럼 .console(관리 화면 어두운 색 변수) 안에 그린다. ?theme=light면 감싸지 않아 앱 기본(밝은) 변수로 대조한다.
const light = typeof location !== "undefined" && new URLSearchParams(location.search).get("theme") === "light";
const hub=<AdminHub email={account} projects={{kind:"unlinked"}} home={<AdminOperationsHome publications={{kind:"closed"}}/>} review={<PublicationHttpQueue initial={{kind:"closed"}}/>}/>;
// P1-06 원본 Style DNA 전체 화면(/admin/style-dna 페이지 본문): ?page=style-dna. 실제 페이지처럼 공통 세션 경계 안에 그린다.
const pageName = () => typeof location !== "undefined" ? new URLSearchParams(location.search).get("page") : (globalThis as {__fixturePage?:string}).__fixturePage ?? null;
// ?page=style-dna-panel: 같은 작업 화면을 c7886a1 관리자 칸(#admin-style-dna) 모양으로 그린다(c7886a1 Style DNA 시험을 그대로 다시 쓰는 용도).
const makeApplication = () => pageName()==="style-dna"
  ? <SessionBoundary account={account}><AdminStyleDnaWorkflow layout="original" account={account}/></SessionBoundary>
  : pageName()==="style-dna-panel"
  ? <div className={styles.console}><main className="content"><section id="admin-style-dna" tabIndex={-1}><AdminStyleDnaWorkflow/></section></main></div>
  // P1-00 관리자 헤더 배정 2: ?page=hub-session은 실제 /admin처럼 공통 세션 경계 안에 관리 화면을 그린다(머리 메뉴 세션 가림 확인용).
  : pageName()==="hub-session"
  ? <SessionBoundary account={account}><div className={styles.console}>{hub}</div></SessionBoundary>
  : light ? hub : <div className={styles.console}>{hub}</div>;
const application=makeApplication();
`;
const transport = `
type RequestRow = { path:string; method:string; headers:Record<string,string>; body:unknown; aborted:boolean; resolve?:()=>void };
// 594dff8 대역의 이미지 분석 응답(제안 프롬프트는 fixture.prompts로 바꿀 수 있음).
const basicImage = {schemaVersion:1,status:"ready",media:"image",proposals:[{media:"image",selectionId:"fixture-image",observations:[{kind:"observation",findingId:"fixture-color",measure:"region_color_luminance",location:{kind:"region",x:0,y:0,width:1,height:1},alphaCoverage:1,palette:[{bucket:"#3366cc",visibleShare:0.6}],luminanceShares:[0.25,0.25,0.25,0.25],luminanceEdges:[0,0.25,0.5,0.75,1]}],draft:{kind:"creative_proposal",target:"image",prompt:"Image base prompt"}}]};
const findings=["people","objects","actions","context","composition","lighting"].map(category=>category==="composition"?{category,certainty:"estimated",description:"오른쪽 인물과 도심 배경",basis:"원본 확인용 근거"}:{category,certainty:"unconfirmed"});
type Draft = { id:string; version:number; text:string; suggested:string; language?:string; source:string; analysis:{program:string;proof:string}; savedAt:string };
type DraftSlot = { basis:{planId:string;contentRevision:number}; version:number; draft:Draft|null };
type UploadRow = { id:string; requestId:string; hash:string; version:number; filename:string; size:number; received:number; status:string;
  chunks:Record<number,string>; analysisId?:string; analysisHash?:string; report?:unknown; code?:string; cleanup:string; expiresAt:string };
const requests:RequestRow[]=[];
const studioProject="0190a0b0-0000-7000-8000-000000000001";
const fixture={
  statuses:{image:"configured"} as Record<string,string>,
  hold:"",
  credentials:{storage:"ready",groups:{reference:{version:0,updatedAt:null},music:{version:0,updatedAt:null}},
    programs:{image:{configured:false,source:"none",modelId:null,lastTest:null},shorts:{configured:false,source:"none",modelId:null,lastTest:null},music:{configured:false,source:"none",modelId:null,lastTest:null}}} as any,
  testOutcome:{status:"verified",code:null} as {status:string;code:string|null},
  credentialFaults:[] as {status:number;body:unknown}[],
  studioProject,
  studioScenes:[{id:"0190a0b0-0000-7000-8000-000000000011",position:1,title:"첫 장면"},{id:"0190a0b0-0000-7000-8000-000000000012",position:2,title:"둘째 장면"}],
  // P1-06 장면 이미지 초안(기존 GET·PUT …/prompts/image 계약 대역): 승인 계획의 장면만 있고, 버전·기준이 다르면 409.
  prompts:{ko:"따뜻한 오후 빛의 도심 인물 사진",en:"Warm afternoon city portrait"} as {ko?:string;en?:string},
  drafts:{
    "0190a0b0-0000-7000-8000-000000000011":{basis:{planId:"0190a0b0-0000-7000-8000-0000000000a1",contentRevision:3},version:0,draft:null},
    "0190a0b0-0000-7000-8000-000000000012":{basis:{planId:"0190a0b0-0000-7000-8000-0000000000a1",contentRevision:3},version:0,draft:null},
  } as Record<string,DraftSlot>,
  draftFaults:[] as ({status:number;body:unknown}|{lost:true})[],
  // P1-07 장면 음악 초안(기존 GET·PUT …/prompts/music 계약 대역, language 없음·program music). 실패·보류는 draftFaults·hold "draft"를 함께 쓴다.
  musicDrafts:{
    "0190a0b0-0000-7000-8000-000000000011":{basis:{planId:"0190a0b0-0000-7000-8000-0000000000a1",contentRevision:3},version:0,draft:null},
    "0190a0b0-0000-7000-8000-000000000012":{basis:{planId:"0190a0b0-0000-7000-8000-0000000000a1",contentRevision:3},version:0,draft:null},
  } as Record<string,DraftSlot>,
  // P1-07 관리자 음악 분석(Backend a849538 계약 대역): GET 설정 상태, POST 파일 본문·동의 머리글. faults는 POST마다 하나씩 꺼낸다.
  music:{status:"configured",report:{genre:"앰비언트",instruments:["피아노","신스 패드"],tempoBpm:96,
    structure:[{label:"도입",description:"피아노로 시작해 리듬이 천천히 들어와요."}],sunoPrompt:"Premiere fixture music"},
    faults:[] as ({status:number;body:unknown}|{semantic:unknown})[]} as {status:string;report:Record<string,unknown>;faults:({status:number;body:unknown}|{semantic:unknown})[]},
  // P1-07 자동·음성(Backend 0e511a0 계약 대역): 모드별 응답. faults는 POST마다 하나씩 꺼낸다({status,body}는 HTTP 오류, 그 밖은 200 본문).
  audio:{
    speech:{status:"ready",provider:"gemini",kind:"speech",report:{summary:"분기 회의에서 출시 일정과 담당을 정했어요.",
      topicsAndKeywords:[{topic:"출시 일정",keywords:["베타","12월"]},{topic:"예산",keywords:null}],
      actionItems:[{task:"베타 체크리스트 정리",assignee:"민지",dueDate:"2026-12-01"},{task:"예산표 갱신",assignee:null,dueDate:null}],
      fullTranscription:[{speaker:"화자 1",timestamp:"00:03",text:"베타는 12월 첫 주에 열어요."},{speaker:null,timestamp:null,text:"예산은 다음 회의에서 볼게요."}]}},
    auto:"music" as string,
    faults:[] as unknown[],
  } as {speech:Record<string,unknown>;auto:string;faults:unknown[]},
  // P1-07 상세 보고서(v2, d35eea5 DTO 대역): 바로 분석은 x-dream-audio-report-version: 2, 업로드 분석은 reportVersion: 2일 때만 쓴다.
  // probe "server"·"none", transcript "sampled"·"limit"(80구간)·"none", lyrics "heard"·"instrumental"·"undetermined". faults는 v2 바로 분석 POST마다 하나씩.
  detail:{probe:"server",transcript:"sampled",lyrics:"heard",faults:[] as unknown[],
    speech:{summary:"출시 일정과 담당을 정한 회의예요.",topicsAndKeywords:[{topic:"출시 일정",keywords:["베타","12월"]},{topic:"예산",keywords:null}],
      actionItems:[{task:"베타 체크리스트 정리",assignee:"민지",dueDate:"2026-12-01"},{task:"예산표 갱신",assignee:null,dueDate:null}],
      speakers:[{name:"민지",role:"진행자",manner:"짧게 정리하며 질문해요.",contribution:"일정과 담당을 정했어요."},{name:"도윤",role:null,manner:null,contribution:"예산 우려를 말했어요."}],
      questions:[{text:"베타는 언제 열까요?",speaker:"민지",context:"출시 일정 논의"},{text:"예산은 충분한가요?",speaker:null,context:null}],
      delivery:{tone:"차분해요.",pace:"보통 속도예요.",pauses:null,fillers:"‘음’이 자주 나와요."},
      acousticQuality:{clarity:"대체로 또렷해요.",background:"키보드 소리가 조금 들려요.",issues:null}},
    music:{mood:"잔잔하고 따뜻해요.",rhythm:{timeSignature:"4/4",feel:"느긋한 스윙"},harmony:{key:"C장조",scale:null,chordProgression:"C–Am–F–G 반복"},
      stems:{vocals:"부드러운 여성 보컬",bass:"낮게 깔리는 신스 베이스",drums:null,others:"피아노와 패드"},
      qualityEstimates:{suspectedUpscale:false,compression:"고음역이 약간 잘려 보여요.",editTraces:null,basis:"16 kHz 위 에너지가 적어요."}}},
  detailed(mode:string,kind:string){
    const head={schemaVersion:2,requestedMode:mode};
    if (kind==="undetermined") return {...head,kind:"undetermined",status:"unavailable",reason:"undetermined"};
    const detail=fixture.detail;
    const measurement=detail.probe==="server"?{source:"server_probe",durationSeconds:754.4,sampleRateHz:44100,channels:2}:{source:"unavailable",reason:"probe_unavailable"};
    const base={...head,provider:"gemini",evidence:"model_estimate",unknownValueReason:"not_established_from_audio",measurement};
    if (kind==="music") return {...base,status:"ready",kind:"music",report:{...fixture.music.report,...detail.music,
      lyrics:detail.lyrics==="heard"?{status:"heard",text:"작은 불빛 아래\\n다시 걸어가"}:{status:detail.lyrics,text:null}}};
    const lines=[{speaker:"민지",text:"베타는 12월 첫 주에 열어요.",startSec:3,endSec:7.5},{speaker:"도윤",text:"예산은 다음 회의에서 볼게요.",startSec:65,endSec:null},
      {speaker:null,text:"키보드 소리가 들려요.",startSec:null,endSec:null},{speaker:"민지",text:"체크리스트는 제가 정리할게요.",startSec:731,endSec:736}];
    const segments=detail.transcript==="limit"?Array.from({length:80},(_,index)=>({speaker:index%2?"도윤":"민지",text:"표본 문장 "+(index+1),startSec:index*9,endSec:index*9+4})):lines;
    const transcription=detail.transcript==="none"?{status:"unavailable",reason:"no_reported_segments"}
      :{status:"sampled",reason:detail.transcript==="limit"?"segment_limit":"model_sample",range:{fromSec:segments[0].startSec,throughSec:detail.transcript==="limit"?715:736},segments};
    return {...base,status:"partial",kind:"speech",report:{...detail.speech,transcription}};
  },
  // P1-08 쇼츠 단건 분석(Backend d7e4db8 계약 대역): GET 설정 상태, POST {url, authorized}. faults는 POST마다 하나씩 꺼낸다({status,body}).
  shorts:{status:"configured",findings:{summary:"프리미어 검수 영상",hook:null,composition:"세로 클로즈업으로 제품을 가운데 둬요.",sound:null,
    segments:[{timestamp:"00:01",evidence:"샘플 첫 장면"},{timestamp:"00:07",evidence:"제품 전체가 보여요"}],draftPrompt:"Premiere fixture Shorts"},
    faults:[] as {status:number;body:unknown}[]} as {status:string;findings:Record<string,unknown>;faults:{status:number;body:unknown}[]},
  // P1-08 YouTube 키(Backend a9582d5 계약 대역): GET {configured, version, updatedAt}, PUT {expectedVersion, apiKey}(버전이 다르면 409).
  // youtubeFaults는 키 요청마다, searchFaults는 검색 POST마다 하나씩 꺼낸다({status,body}). hold "youtube-key"·"search"로 붙잡는다.
  youtube:{configured:false,version:0,updatedAt:null} as {configured:boolean;version:number;updatedAt:string|null},
  youtubeFaults:[] as {status:number;body:unknown}[],
  searchFaults:[] as {status:number;body:unknown}[],
  // 검색 결과 수(최대 50). 지표는 0과 비공개(null)를 섞는다.
  searchCount:3,
  // P1-08 공개 메타데이터 보고서(Backend 75d5500 계약 대역): POST {videoId, authorized, youtubeCredentialVersion, geminiCredentialVersion}.
  // metadataFaults는 POST마다 하나씩 꺼내고({status,body}, 200이면 그 본문을 그대로), hold "metadata"로 붙잡는다. 댓글 표본 상태는 metadataComments.
  metadataFaults:[] as {status:number;body:unknown}[],
  metadataComments:"sampled" as "sampled"|"empty"|"unavailable",
  // P1-08 소재 제안(Backend 1c47cce 계약 대역): POST {keyword, context, authorized, geminiCredentialVersion}. ideaFaults는 POST마다 하나씩
  // 꺼내고({status,body}), hold "ideas"로 붙잡는다. ideaScores는 첫 세 제안의 [잠재 점수, 유지율](0·100·null), 넷째는 평가 없음.
  ideaFaults:[] as {status:number;body:unknown}[],
  // P1-08 대본(Backend 18c6bd6 계약 대역): POST {authorized, geminiCredentialVersion, source, selectedIdea, config}. scriptFaults는 POST마다 하나씩
  // 꺼내고, hold "script"로 붙잡는다. 장면 수는 계약 하한, 첫 장면 0→3초, 2번 자막·3번 효과음은 null.
  scriptFaults:[] as {status:number;body:unknown}[],
  // P1-08 선택 장면 프롬프트(Backend 0f49fa4 계약 대역): POST {authorized, geminiCredentialVersion, source, selectedIdea{title, openingHook}, durationSec, selectedScene}.
  // scenePromptFaults는 POST마다 하나씩 꺼내고, hold "scene-prompt"로 붙잡는다. 결과는 받은 장면 번호·계획 시간을 그대로 돌려준다.
  scenePromptFaults:[] as {status:number;body:unknown}[],
  // P1-08 전체 BGM 프롬프트(Backend 0f49fa4 계약 대역): POST {authorized, geminiCredentialVersion, source, selectedIdea{title, openingHook}, durationSec, direction?, cues[≤4]}.
  // bgmPromptFaults는 POST마다 하나씩 꺼내고, hold "bgm-prompt"로 붙잡는다. 방향에 "BPM 없음"이 있으면 recommendedBpmRange는 null.
  bgmPromptFaults:[] as {status:number;body:unknown}[],
  // P1-08 작업실 기획 초안 가져오기(Backend 4844f2c 계약 대역): GET /api/projects(소유자 목록)·GET·POST /api/projects/{id}/plan.
  // listFaults·planFaults(GET)·importFaults(POST, {lost:true}면 저장한 뒤 응답을 잃음)는 하나씩 꺼내고, hold "projects"·"plan-get"·"plan-import"로 붙잡는다.
  // 서버처럼 브리프 미승인·기획 잠김은 409, 쓰기 불가·revision/version 차이·목표 길이 차이는 409, 장면 합≠durationSec·키 차이는 400, 성공은 201로 새 버전을 더한다.
  // 부가 자료(a48dd51): 서버의 실제 검증(shortsPlanMaterialsInput·shortsPlanMaterialsConflict)으로 400·409 PLAN_MATERIALS_STALE을 내고, 이전 버전에 자료가 있는데
  // materials 없이 오면 409 PLAN_MATERIALS_REQUIRED. 저장은 sceneOrder·sceneKey를 붙이고 jsonb처럼 키 순서를 바꿔 같은 버전 GET·201에 돌려준다.
  workroom:{
    projects:[] as {id:string;title:string;menuId:string;menuLabel:string;lengthSec:number;stages:Record<string,string>}[],
    plans:{} as Record<string,{revision:number;version:number;planId:string|null;approved:boolean;drafts:{version:number;draft:{script:string;scenes:unknown[]};materials?:unknown}[]}>,
    listFaults:[] as {status:number;body:unknown}[],
    planFaults:[] as {status:number;body:unknown}[],
    importFaults:[] as ({status:number;body:unknown}|{lost:true})[],
    add(id:string,title:string,lengthSec:number,stages:Record<string,string>={},options:{menuId?:string;version?:number;approved?:boolean}={}){
      const project={id,title,menuId:options.menuId??"shopping-shorts",menuLabel:options.menuId?"다른 메뉴":"쇼핑쇼츠",lengthSec,
        stages:{intake:"approved",brief:"approved",plan:"todo",produce:"locked",edit:"locked",review:"locked",export:"locked",...stages}};
      fixture.workroom.projects.push(project);
      const drafts=Array.from({length:options.version??0},(_,index)=>({version:index+1,draft:{script:"기존 기획 "+(index+1),
        scenes:[{stepId:"custom",title:"기존 장면",description:"기존 화면",dialogue:"",durationSec:lengthSec,characterIds:[],assetIds:[]}]}}));
      fixture.workroom.plans[id]={revision:3,version:options.version??0,planId:options.version?"0190a0b0-0000-7000-8000-0000000000f"+(options.version):null,approved:!!options.approved,drafts};
      return project;
    },
  },
  ideaScores:[[0,100],[100,null],[null,0]] as [number|null,number|null][],
  // P1-07 100 MiB 업로드(Backend 298cc8f 계약 대역): 접수 POST·2 MiB 분할 PUT·상태 GET·analyze/cancel/cleanup POST를 서버 저장소 규칙대로 메모리에 흉내 낸다.
  // uploadFaults는 그 단계(at: start·chunk·get·analyze·cancel·cleanup) 요청마다 하나씩 꺼낸다. "after"는 서버가 처리한 뒤 응답을 잃고,
  // "before"는 서버에 닿기 전에 끊고, "drop"은 바로 끊지만 서버는 계속 처리하고, {status,body}는 그 응답을 준다. uploadOutcome은 분석 실패 코드(null이면 모드대로 v1 보고서),
  // uploadCleanup은 Gemini 사본 정리 상태, cleanupWorks가 false면 정리 재시도도 pending으로 남는다. hold "upload-analyze"·"upload-chunk"로 붙잡는다.
  uploads:{} as Record<string,UploadRow>,
  uploadFaults:[] as {at:string;kind:"after"|"before"|"drop"|{status:number;body:unknown}}[],
  uploadOutcome:null as null|string,
  uploadCleanup:"done",
  cleanupWorks:true,
  uploadLimit:20,
  expire(id:string){ const u=fixture.uploads[id]; u.status="expired"; u.code="expired"; u.chunks={}; },
  saveDraft(sceneId:string, value:{text:string;suggested:string;language?:string}, kind:"image"|"music"="image"){
    const slot=(kind==="music"?fixture.musicDrafts:fixture.drafts)[sceneId]; slot.version+=1;
    slot.draft={id:"fixture-draft-"+slot.version,version:slot.version,text:value.text,suggested:value.suggested,...(value.language&&{language:value.language}),
      source:value.text===value.suggested?"suggested":"edited",analysis:{program:kind,proof:"client_supplied"},savedAt:new Date().toISOString()};
    return slot;
  },
  requests:()=>requests.map(({path,method,headers,body,aborted})=>({path,method,headers,body,aborted})),
  release:()=>requests.forEach(row=>row.resolve?.()),
};
// 시험용: ?unapproved=<장면 ID>면 그 장면은 승인 계획에 없는 것으로 둔다(초안 GET·PUT 404).
for (const id of new URLSearchParams(location.search).getAll("unapproved")) { delete fixture.drafts[id]; delete fixture.musicDrafts[id]; }
// P1-08: ?youtubeStorage=1이면 첫 YouTube 키 GET이 저장소 준비 전(503), ?youtubeKey=N이면 키 버전 N이 저장된 상태로 시작한다.
if (new URLSearchParams(location.search).has("youtubeStorage")) fixture.youtubeFaults.push({status:503,body:{code:"storage_unavailable"}});
if (Number(new URLSearchParams(location.search).get("youtubeKey"))>0) fixture.youtube={configured:true,version:Number(new URLSearchParams(location.search).get("youtubeKey")),updatedAt:"2026-11-20T01:00:00.000Z"};
// P1-08: ?shortsModel=N이면 화면에 저장된 쇼츠 모델(reference 그룹 버전 N)로 시작한다. ?shortsModel=env면 환경 변수에만 있는 것으로 둔다.
{ const model=new URLSearchParams(location.search).get("shortsModel");
  if (model==="env") Object.assign(fixture.credentials.programs.shorts,{configured:true,source:"environment",modelId:"gemini-env-shorts"});
  else if (Number(model)>0) { fixture.credentials.groups.reference={version:Number(model),updatedAt:"2026-11-20T01:00:00.000Z"};
    Object.assign(fixture.credentials.programs.shorts,{configured:true,source:"stored",modelId:"gemini-fixture-shorts"}); } }
// P1-07: ?musicModel=N이면 화면에 저장된 음악 모델(music 그룹 버전 N)로 시작한다(큰 파일 업로드 접수·분석의 credentialVersion).
if (Number(new URLSearchParams(location.search).get("musicModel"))>0) { fixture.credentials.groups.music={version:Number(new URLSearchParams(location.search).get("musicModel")),updatedAt:"2026-11-20T01:00:00.000Z"};
  Object.assign(fixture.credentials.programs.music,{configured:true,source:"stored",modelId:"gemini-fixture-music"}); }
// P1-06 Style DNA 작업실(Backend ab798b1 계약 대역): ?styleDnaSeed=1이면 기록 하나(ID ...b001)로 시작, ?styleDnaModel=none이면 분석 모델 미등록.
// faults.<list|get|analyze|refine|test>는 하나씩 꺼낸다({status,body} 또는 {lost:true}=처리한 뒤 응답을 잃음). hold는 "analyze"·"refine"·"test"·"get".
// 같은 requestId·같은 내용은 저장된 결과(201이면 200)를, 다른 내용은 409 request_conflict. 버전이 다르면 409 stale_credential.
// ?styleDnaReport=1이면 새 분석 기록에 서버 1d7ee8d의 선택 보고서(record.styleDna)를 붙이고, 보정 1회차는 청사진만·2회차는 스타일만 revisions[].styleDna로 갱신한다.
// 미리 넣은 기록(?styleDnaSeed=1)은 언제나 확장 없는 이전 형태로 둔다(구기록 다시 열기 확인용).
// 엔진(서버 f2d7e63 계약 대역): ?styleDnaEngines=openai,anthropic이면 그 공급자를 등록 상태로(OpenAI gpt-fixture-vision 버전 2, Anthropic claude-fixture-vision 버전 5).
// GET /api/admin/style-dna/engine-credentials → {providers:{openai,anthropic}}. 분석·보정에 engine이 있으면 그 공급자의 등록·모델·버전을 확인(미등록 503, 다르면 409 stale_credential),
// 결과 record.engine·첫 리비전 engine·semantic.provider, 보정 리비전 engine에 {provider,modelId,credentialVersion}을 남긴다. 시험 생성은 언제나 Gemini 확인.
// styleDna.engines[provider]를 바꾸면 키 교체(버전 변경)를 흉내 낼 수 있다.
// 엔진 등록 조회(CMD-045): ?styleDnaHold=engines면 첫 조회를 붙잡고(window.__premiere.release()로 풀기), ?styleDnaEnginesFault=<상태>면 첫 조회 한 번 실패.
type SdRecord = Record<string,any>;
const sdCell=(description:string,basis:string)=>({certainty:"estimated",description,basis});
const sdRow=(label:string,description:string,basis:string)=>({label,description,basis});
const sdReport=()=>({schemaVersion:1,titles:{ko:"황혼의 도심 초상",en:"Dusk City Portrait"},
  camera:{angle:sdCell("눈높이 정면","수평선이 화면 가운데"),shotType:sdCell("미디엄 클로즈업","가슴 위로 잘림"),lens:sdCell("85mm 상당 망원","배경 압축이 큼"),
    // ?styleDnaFocus=estimated면 초점 거리도 추정값(렌즈·초점 거리 둘 다 '추정' 표시 확인용). 기본은 미확인.
    focusDistance:sdQuery.get("styleDnaFocus")==="estimated"?sdCell("약 1.5m(인물 근접)","얼굴 크기와 배경 흐림 정도"):{certainty:"unconfirmed"},depthOfField:sdCell("얕은 심도","배경 불빛이 둥글게 번짐")},
  lighting:{timeOfDay:sdCell("해 질 녘","주황빛 낮은 태양"),direction:sdCell("왼쪽 측면광","오른쪽 뺨 그림자"),altitude:sdCell("낮음","긴 그림자"),
    contrast:sdCell("중간","암부 디테일 유지"),shadows:{certainty:"unconfirmed"}},
  blueprint:[sdRow("구도","인물을 오른쪽 삼분할 선에 둔 세로 구도","얼굴이 오른쪽 1/3 지점"),sdRow("배경","흐릿한 도심 간판 불빛","둥근 빛 번짐")],
  style:[sdRow("색감","청록 그림자와 주황 하이라이트 대비","팔레트 상위 두 색"),sdRow("질감","부드러운 필름 입자","암부의 고른 노이즈")],
  tips:["원본을 함께 첨부하면 색 대비가 더 정확히 재현돼요.","피사체만 바꿔 같은 빛을 유지하세요."],
  keywords:["cinematic","teal-orange","golden hour","bokeh"],
  dna:[{label:"색 대비",score:82,source:"model_estimate"},{label:"빛 방향",score:74,source:"model_estimate"},{label:"질감",score:0,source:"model_estimate"}],
  matchRate:{score:87.5,source:"model_estimate"}});
const sdQuery=new URLSearchParams(location.search);
const styleDna={
  version:Number(sdQuery.get("styleDnaVersion")??3), model:sdQuery.get("styleDnaModel")==="none"?null:"gemini-fixture-image", report:sdQuery.get("styleDnaReport")==="1",
  engines:Object.fromEntries((["openai","anthropic"] as const).map(provider=>[provider,(sdQuery.get("styleDnaEngines")??"").split(",").includes(provider)
    ?{configured:true,modelId:provider==="openai"?"gpt-fixture-vision":"claude-fixture-vision",version:provider==="openai"?2:5,updatedAt:"2026-11-22T00:00:00.000Z"}
    :{configured:false,modelId:null,version:0,updatedAt:null}])) as Record<string,{configured:boolean;modelId:string|null;version:number;updatedAt:string|null}>,
  // ?styleDnaHold=list: 첫 목록을 붙잡는다(불러오는 중 확인), ?styleDnaListFault=<상태>: 첫 목록 한 번 실패(보관함 오류·다시 확인).
  records:[] as SdRecord[], hold:sdQuery.get("styleDnaHold")??"", seq:0, done:{} as Record<string,{hash:string;status:number;body:unknown}>,
  faults:{list:sdQuery.get("styleDnaListFault")?[{status:Number(sdQuery.get("styleDnaListFault")),body:{code:"failed"}}]:[],get:[],analyze:[],refine:[],test:[],engines:sdQuery.get("styleDnaEnginesFault")?[{status:Number(sdQuery.get("styleDnaEnginesFault")),body:{code:"failed"}}]:[],compare:[],delete:[]} as Record<string,({status:number;body:unknown}|{lost:true|"before"})[]>,
  media(id:string,name:string,width:number,height:number,palette:{hex:string;share:number}[]){
    // 비교 픽셀 준비(CMD-20261125-014): ?styleDnaResultMedia=delay:<ms>|fail이면 원본이 아닌(시험 결과) 이미지 주소에 ?m=을 붙여 서버가 늦추거나 실패한다.
    const late=name!=="original"?sdQuery.get("styleDnaResultMedia"):null;
    return {mime:"image/webp",width,height,sha256:(name+id).padEnd(64,"0").slice(0,64),palette,href:"/api/admin/style-dna/"+id+"/media/"+name+(late?"?m="+encodeURIComponent(late):"")}; },
  create(options:Record<string,unknown>, title:string){
    styleDna.seq+=1;
    const id="0190b0b0-0000-7000-8000-00000000b"+String(styleDna.seq).padStart(3,"0");
    const at="2026-11-21T0"+Math.min(styleDna.seq,9)+":00:00.000Z";
    const prompts={ko:"[피사체 입력]을 따뜻한 오후 빛의 도심 인물 사진으로, 분석 "+styleDna.seq,en:"A portrait of [INSERT SUBJECT HERE] in warm afternoon city light, analysis "+styleDna.seq};
    const record:SdRecord={id,title,revision:1,mode:options.mode,options,createdAt:at,updatedAt:at,
      original:styleDna.media(id,"original",640,400,[{hex:"#1f6f6a",share:0.4},{hex:"#e8d5b0",share:0.25},{hex:"#2a2a35",share:0.15},{hex:"#c96a3b",share:0.12},{hex:"#f4f1ea",share:0.08}]),
      result:basicImage,semantic:{status:"ready",provider:"gemini",findings,prompts},revisions:[{revision:1,prompts,createdAt:at}],tests:[]};
    if (styleDna.report&&title!=="보관된 도심 인물 사진") record.styleDna=sdReport();
    styleDna.records.unshift(record);
    return record; },
};
if (sdQuery.get("styleDnaSeed")==="1") styleDna.create({mode:"replicate",guidance:"",mutationLevel:30,includeImageTag:true,targetModel:"gemini-nano-banana-2.1"},"보관된 도심 인물 사진");
(fixture as Record<string,unknown>).styleDna=styleDna;
(window as unknown as {__premiere:unknown}).__premiere=fixture;
window.fetch=async(raw,init)=>{
  const path=String(raw);
  const method=init?.method??"GET";
  const formFile=init?.body instanceof FormData ? (init.body.get("file")??init.body.get("customReference")) as File|null : null;
  const body=init?.body instanceof FormData ? {form:[...init.body.keys()],options:JSON.parse(String(init.body.get("options"))),file:formFile?.name??null,size:formFile?.size??null}
    : init?.body instanceof Blob ? {size:init.body.size} : init?.body ? JSON.parse(String(init.body)) : null;
  const row:RequestRow={path,method,headers:Object.fromEntries(new Headers(init?.headers)),body,aborted:false};
  init?.signal?.addEventListener("abort",()=>{row.aborted=true;});
  requests.push(row);
  const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
  // 공통 세션 감시(POST /api/auth/session)·로그아웃 대역: fixture.session으로 같은 계정(same)·바뀜(changed)·401 등을 흉내 낸다.
  if(path==="/api/auth/session"&&method==="POST"){
    const session=(fixture as {session?:string|number}).session??"same";
    return typeof session==="number"?response({code:session===403?"AUTH_FORBIDDEN":"AUTH_REQUIRED"},session):response({state:session});
  }
  if(path==="/api/auth/logout"&&method==="POST") return response({state:"ended"});
  if(path==="/api/admin/style-dna/engine-credentials"&&method==="GET"){
    if (styleDna.hold==="engines") { styleDna.hold=""; await new Promise<void>(resolve=>{row.resolve=resolve;}); }
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=styleDna.faults.engines?.shift();
    if (fault&&"status" in fault) return response(fault.body,fault.status);
    return response({providers:{openai:styleDna.engines.openai,anthropic:styleDna.engines.anthropic}});
  }
  if(path==="/api/admin/style-dna"||path.startsWith("/api/admin/style-dna/")){
    const parts=path.split("/"), id=parts[4], action=parts[5];
    const op=!id?(method==="POST"?"analyze":"list"):!action?(method==="PATCH"?"compare":method==="DELETE"?"delete":"get"):action==="test-image"?"test":action;
    if (styleDna.hold===op) await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=styleDna.faults[op]?.shift();
    if (fault&&"status" in fault) return response(fault.body,fault.status);
    const summary=(record:SdRecord)=>({id:record.id,title:record.title,revision:record.revision,mode:record.mode,original:record.original,createdAt:record.createdAt,updatedAt:record.updatedAt});
    if (op==="list") return response({items:styleDna.records.map(summary),settings:{storage:"ready",credentialVersion:styleDna.model?styleDna.version:0,analysisModel:styleDna.model,
      testModels:[{id:"gemini-nano-banana-2.1",size:"2K",label:"Nano Banana 2.1"},{id:"gemini-3.1-flash-lite-image",size:"1K",label:"Nano Banana 2 Lite"}]}});
    // 보관함 삭제(Backend 0727932 계약 대역): UUID 아님 400, 없음·다시 삭제 404, 성공은 본문 없는 204. faults.delete {lost:true}는 서버가 지운 뒤 응답만 끊기고, {lost:"before"}는 지우기 전에 끊긴다(삭제 안 됨).
    if (op==="delete") {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) return response({code:"invalid_input"},400);
      const at=styleDna.records.findIndex(record=>record.id===id);
      if (at<0) return response({code:"not_found"},404);
      if (fault&&"lost" in fault&&fault.lost==="before") throw new TypeError("Failed to fetch");
      styleDna.records.splice(at,1);
      if (fault) throw new TypeError("Failed to fetch");
      return new Response(null,{status:204});
    }
    const found=styleDna.records.find(record=>record.id===id);
    if (op==="get") return found?response({record:found}):response({code:"not_found"},404);
    if (op==="compare") {
      // 서버 store.saveComparison 흉내(e440d72·3fae275): 색 차이는 서버가 재고, 지점 버전이 다르면 409, 지점 없이 추세는 422, 같은 시험 추세는 한 번만.
      const cmd=body as Record<string,any>;
      const test=found?.tests.find((item:SdRecord)=>item.id===cmd?.testId);
      if (!found||!test) return response({code:"not_found"},404);
      if (cmd.originalSha256!==found.original.sha256||cmd.resultSha256!==test.image.sha256) return response({code:"comparison_media_mismatch"},409);
      const prior=found.comparison;
      if ((prior?.spotVersion??0)!==cmd.spotVersion) return response({code:"stale_spot_version"},409);
      const at="2026-11-22T0"+Math.min(styleDna.seq,9)+":30:00.000Z";
      const seed=Number(String(test.id).slice(-3));
      const diff=(x:number,y:number)=>Math.round(((x*7+y*3+seed*9)%40+5)*10)/10;
      if (cmd.action==="save-spots") {
        const spots=cmd.spots.map((s:{x:number;y:number})=>({x:s.x,y:s.y,diff:diff(s.x,s.y)}));
        found.comparison={source:"stored_webp_rgb_5x5",spotVersion:(prior?.spotVersion??0)+1,frame:cmd.frame,baseline:{testId:test.id,originalSha256:cmd.originalSha256,resultSha256:cmd.resultSha256,at},
          spots,updatedAt:at,trends:prior?.trends??[],recordedTestIds:[]};
        return response({comparison:found.comparison});
      }
      if (!prior?.spots.length) return response({code:"comparison_unmeasured"},422);
      if (prior.recordedTestIds.includes(test.id)) return response({comparison:prior});
      const spots=prior.spots.map((s:{x:number;y:number})=>({x:s.x,y:s.y,diff:diff(s.x,s.y)}));
      const avg=Math.round(spots.reduce((sum:number,s:{diff:number})=>sum+s.diff,0)/spots.length*10)/10;
      const trend={testId:test.id,originalSha256:cmd.originalSha256,resultSha256:cmd.resultSha256,at,avg,n:spots.length,spotVersion:prior.spotVersion,revision:test.revision,frame:prior.frame,spots,
        ...(cmd.prompt&&{prompt:String(cmd.prompt).slice(0,2000)})};
      found.comparison={...prior,updatedAt:at,trends:[...prior.trends,trend].slice(-20),recordedTestIds:[...prior.recordedTestIds,test.id]};
      return response({comparison:found.comparison});
    }
    const ask=((body as {options?:Record<string,unknown>})?.options??body) as Record<string,any>;
    const requestId=String(ask?.requestId??"");
    const hash=JSON.stringify([op,id??null,body]);
    const seen=styleDna.done[requestId];
    if (seen) return seen.hash===hash?response(seen.body,seen.status===201?200:seen.status):response({code:"request_conflict"},409);
    const finish=(value:unknown,status:number)=>{ styleDna.done[requestId]={hash,status,body:value}; if (fault) throw new TypeError("Failed to fetch"); return response(value,status); };
    if (ask?.authorized!==true||typeof ask?.credentialVersion!=="number") return response({code:"invalid_input"},400);
    const engine=op!=="test"&&ask.engine?ask.engine as {provider:string;modelId:string}:null;
    if (engine) {
      const setting=styleDna.engines[engine.provider];
      if (!setting) return finish({code:"invalid_input"},400);
      if (!setting.configured) return finish({code:"not_configured"},503);
      if (ask.credentialVersion!==setting.version||engine.modelId!==setting.modelId) return finish({code:"stale_credential"},409);
    } else {
      if (!styleDna.model) return finish({code:"not_configured"},503);
      if (ask.credentialVersion!==styleDna.version) return finish({code:"stale_credential"},409);
    }
    const basis=engine?{provider:engine.provider,modelId:engine.modelId,credentialVersion:ask.credentialVersion}:null;
    if (op==="analyze") {
      const {requestId:_r,authorized:_a,credentialVersion:_c,engine:_e,source,...options}=ask; void _r; void _a; void _c; void _e;
      const src=source as {kind:string;id?:string;url?:string}|undefined;
      if (src?.kind==="record"&&!styleDna.records.some(record=>record.id===src.id)) return finish({code:"not_found"},404);
      const fileName=(body as {file?:string}).file;
      const title=fileName?"파일 "+fileName:src?.kind==="url"?"주소 분석":"다시 분석";
      const made=styleDna.create(options,title);
      if (basis) { made.engine=basis; made.revisions[0].engine=basis; made.semantic={...made.semantic,provider:basis.provider}; }
      return finish({record:made},201);
    }
    if (!found) return finish({code:"not_found"},404);
    if (op==="refine") {
      const prior=found.revisions.at(-1);
      if (ask.revision!==prior.revision) return finish({code:"stale_revision"},409);
      const next={revision:prior.revision+1,prompts:{ko:prior.prompts.ko+" · "+ask.feedback,en:prior.prompts.en+", refined "+(prior.revision+1)},
        feedback:ask.feedback,note:"피드백을 반영해 조명과 색을 조정했어요.",createdAt:"2026-11-21T10:0"+Math.min(prior.revision,9)+":00.000Z"} as SdRecord;
      if (basis) next.engine=basis;
      if (found.styleDna) next.styleDna=prior.revision===1?{blueprint:[sdRow("구도","보정 "+next.revision+": 배경을 단순하게 비운 세로 구도","피드백 반영")]}
        :{style:[sdRow("색감","보정 "+next.revision+": 더 따뜻한 주황 하이라이트","피드백 반영")]};
      found.revisions.push(next); found.revision=next.revision; found.updatedAt=next.createdAt;
      return finish({record:found},201);
    }
    if (op==="test") {
      const prior=found.revisions.find((item:SdRecord)=>item.revision===ask.revision);
      if (!prior) return finish({code:"stale_revision"},409);
      // 서버 styleDnaTest/WithReference: 직접 편집(customPrompt)은 피사체를 쓰지 않고 자리가 남으면 거절, 참조 업로드는 원본 첨부 끔·sha256 필요.
      const edited=typeof ask.customPrompt==="string";
      const upload=(body as {form?:string[]}).form?.includes("customReference");
      if (upload&&(ask.attachImage!==false||!/^[a-f0-9]{64}$/.test(String(ask.customReferenceSha256??"")))) return finish({code:"invalid_input"},400);
      if (upload&&!/\\.(png|jpe?g|webp)$/i.test(String((body as {file?:string}).file))) return finish({code:"unsupported_format"},400);
      if (edited&&(!ask.customPrompt.trim()||[...ask.customPrompt].length>2400)) return finish({code:"invalid_input"},400);
      const text=edited?ask.customPrompt:prior.prompts.en+prior.prompts.ko;
      if (/INSERT SUBJECT HERE|피사체 입력/.test(text)&&(edited||!String(ask.subject??"").trim())) return finish({code:"subject_required"},400);
      styleDna.seq+=1;
      const testId="0190b0b0-0000-7000-8000-00000000c"+String(styleDna.seq).padStart(3,"0");
      const test={id:testId,revision:prior.revision,model:ask.model,createdAt:"2026-11-21T11:00:00.000Z",original:found.original,
        image:styleDna.media(found.id,testId,ask.aspectRatio==="9:16"?360:640,ask.aspectRatio==="9:16"?640:400,
          [{hex:"#23716b",share:0.38},{hex:"#e0cfae",share:0.27},{hex:"#30303a",share:0.15},{hex:"#d0703f",share:0.12},{hex:"#ffffff",share:0.08}])};
      if (edited||upload) test.basis={promptMode:edited?"edited":"revision",promptSha256:"f".repeat(64),aspectRatio:ask.aspectRatio??"16:9",credentialVersion:ask.credentialVersion,
        reference:upload?{kind:"upload",sha256:"e".repeat(64),sourceSha256:ask.customReferenceSha256}:ask.attachImage?{kind:"original",sha256:found.original.sha256}:{kind:"none"}};
      found.tests.push(test);
      return finish({test},201);
    }
  }
  if(path==="/api/admin/reference-analysis"){
    if (method==="GET" && fixture.statuses.image==="login") return response({},401);
    if (method==="GET") return response({semantic:{image:fixture.statuses.image}});
    if (method==="POST" && fixture.hold==="image") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    if (method==="POST") return response({result:basicImage,semantic:{status:"partial",provider:"gemini",findings,prompts:fixture.prompts}});
    return response({code:"fixture_no_analysis",error:"x"},503);
  }
  if(path==="/api/admin/music-semantic"){
    if (method==="GET" && fixture.music.status==="login") return response({},401);
    if (method==="GET" && fixture.music.status==="failed") return response({},503);
    if (method==="GET") return response({semantic:{music:fixture.music.status}});
    if (fixture.hold==="music") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=fixture.music.faults.shift();
    if (fault && "status" in fault) return response(fault.body,fault.status);
    if (fault) return response(fault);
    if (fixture.music.status!=="configured") return response({semantic:{status:"unavailable",reason:"not_configured"}});
    return response({semantic:{status:"ready",provider:"gemini",report:fixture.music.report}});
  }
  if(path==="/api/admin/shorts-analysis"){
    if (method==="GET" && fixture.shorts.status==="login") return response({},401);
    if (method==="GET" && fixture.shorts.status==="failed") return response({error:"unavailable"},503);
    if (method==="GET") return response({semantic:{shorts:fixture.shorts.status}});
    if (fixture.hold==="shorts") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=fixture.shorts.faults.shift();
    if (fault) return response(fault.body,fault.status);
    const request=body as {url?:unknown;authorized?:unknown};
    if (typeof request.url!=="string"||request.authorized!==true) return response({error:"invalid_input"},400);
    if (fixture.shorts.status!=="configured") return response({error:"not_configured"},503);
    return response({result:{evidence:"youtube_video",findings:fixture.shorts.findings}});
  }
  if(path==="/api/admin/audio-analysis"){
    const mode=new Headers(init?.headers).get("x-dream-audio-mode");
    if (fixture.hold==="audio") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    if (new Headers(init?.headers).get("x-dream-audio-report-version")==="2") {
      const fault=fixture.detail.faults.shift() as {status?:number;body?:unknown}|undefined;
      if (fault && typeof fault.status==="number" && "body" in fault) return response(fault.body,fault.status);
      if (fault) return response(fault);
      return response(fixture.detailed(String(mode),mode==="auto"?fixture.audio.auto:String(mode)));
    }
    const fault=fixture.audio.faults.shift() as {status?:number;body?:unknown}|undefined;
    if (fault && typeof fault.status==="number" && "body" in fault) return response(fault.body,fault.status);
    if (fault) return response(fault);
    const music={status:"ready",provider:"gemini",kind:"music",report:fixture.music.report};
    const kind=mode==="auto"?fixture.audio.auto:"speech";
    if (kind==="undetermined") return response({schemaVersion:1,requestedMode:mode,status:"unavailable",kind:"undetermined",reason:"undetermined"});
    return response({schemaVersion:1,requestedMode:mode,...(kind==="music"?music:fixture.audio.speech)});
  }
  const prompt=/^[/]api[/]projects[/]([^/]+)[/]scenes[/]([^/]+)[/]prompts[/](image|music)$/.exec(path);
  if(prompt){
    const [,projectId,sceneId,kind]=prompt as unknown as [string,string,string,"image"|"music"];
    const slot=projectId===fixture.studioProject?(kind==="music"?fixture.musicDrafts:fixture.drafts)[sceneId]:undefined;
    const state=()=>({projectId,sceneId,kind,basis:slot!.basis,version:slot!.version,draft:slot!.draft});
    if (method==="PUT" && fixture.hold==="draft") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    if (!slot) return response({code:"SCENE_PROMPT_TARGET_NOT_FOUND"},404);
    if (method==="GET") return response(state());
    const save=body as {expectedVersion:number;expectedBasis:{planId:string;contentRevision:number};text:string;suggested:string;language?:string;analysis:{program:string}};
    const keys=kind==="music"?"analysis,expectedBasis,expectedVersion,suggested,text":"analysis,expectedBasis,expectedVersion,language,suggested,text";
    if (Object.keys(save).sort().join(",")!==keys||save.analysis?.program!==kind) return response({code:"INVALID_SCENE_PROMPT"},400);
    const fault=fixture.draftFaults.shift();
    if (fault && !("lost" in fault)) return response(fault.body,fault.status);
    if (save.expectedVersion!==slot.version||save.expectedBasis.planId!==slot.basis.planId||save.expectedBasis.contentRevision!==slot.basis.contentRevision) return response({code:"SCENE_PROMPT_CONFLICT"},409);
    fixture.saveDraft(sceneId,save,kind);
    if (fault) throw new TypeError("Fixture lost a completed draft response");
    return response(state(),201);
  }
  const production=/^[/]api[/]projects[/]([^/]+)[/]production$/.exec(path);
  if(production&&method==="GET"){
    if (production[1]!==fixture.studioProject) return response({error:"not_found"},404);
    return response({projectId:fixture.studioProject,scenes:fixture.studioScenes});
  }
  if(path==="/api/admin/youtube-credentials"){
    if (fixture.hold==="youtube-key" && method==="PUT") await new Promise<void>(resolve=>{row.resolve=resolve;});
    // 409 뒤 최신 키 GET이 늦게 오는 구간을 재현한다(hold "youtube-key-get").
    if (fixture.hold==="youtube-key-get" && method==="GET") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=fixture.youtubeFaults.shift();
    if (fault) return response(fault.body,fault.status);
    if (method==="PUT") {
      const save=body as {expectedVersion:number;apiKey:string};
      if (Object.keys(save).sort().join(",")!=="apiKey,expectedVersion"||!/^[a-zA-Z0-9_-]{16,256}$/.test(save.apiKey)) return response({code:"invalid_input"},400);
      if (save.expectedVersion!==fixture.youtube.version) return response({code:"stale"},409);
      fixture.youtube={configured:true,version:fixture.youtube.version+1,updatedAt:new Date().toISOString()};
    }
    return response(fixture.youtube);
  }
  if(path==="/api/admin/shorts-search"&&method==="POST"){
    if (fixture.hold==="search") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=fixture.searchFaults.shift();
    if (fault) return response(fault.body,fault.status);
    const ask=body as {query:string;order:string;credentialVersion:number;dateFrom?:string;dateTo?:string};
    if (!fixture.youtube.configured) return response({code:"not_configured"},503);
    if (ask.credentialVersion!==fixture.youtube.version) return response({code:"stale"},409);
    const items=Array.from({length:fixture.searchCount},(_,index)=>({id:("Fx"+String(index).padStart(2,"0")+"abcdefgh").slice(0,11),
      url:"https://www.youtube.com/watch?v="+("Fx"+String(index).padStart(2,"0")+"abcdefgh").slice(0,11),
      title:ask.query+" 후보 "+(index+1),channelId:"UC"+"a".repeat(21)+String(index%10),channelTitle:"대역 채널 "+(index+1),
      thumbnailUrl:index===1?null:"https://i.ytimg.com/vi/Fx"+index+"/mqdefault.jpg",publishedAt:"2026-11-0"+(1+index%9)+"T03:00:00Z",
      durationSeconds:index===2?null:30+index,views:index===0?0:12345*(index+1),likes:index===1?null:index*7,comments:index===2?null:0,subscribers:index===0?null:1000+index}));
    return response({schemaVersion:1,evidence:"youtube_metadata",credentialVersion:fixture.youtube.version,items});
  }
  if(path==="/api/admin/shorts-metadata-analysis"&&method==="POST"){
    if (fixture.hold==="metadata") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=fixture.metadataFaults.shift();
    if (fault) return response(fault.body,fault.status);
    const ask=body as {videoId:string;authorized:boolean;youtubeCredentialVersion:number;geminiCredentialVersion:number};
    if (Object.keys(ask).sort().join(",")!=="authorized,geminiCredentialVersion,videoId,youtubeCredentialVersion"||ask.authorized!==true) return response({code:"invalid_input"},400);
    const shorts=fixture.credentials.programs.shorts;
    if (!fixture.youtube.configured||shorts.source!=="stored") return response({code:"not_configured"},503);
    if (ask.youtubeCredentialVersion!==fixture.youtube.version||ask.geminiCredentialVersion!==fixture.credentials.groups.reference.version) return response({code:"stale"},409);
    const sample={sampled:{status:"sampled",count:3},empty:{status:"empty",count:0},unavailable:{status:"unavailable",count:null}}[fixture.metadataComments];
    return response({schemaVersion:1,evidence:"youtube_metadata",youtubeCredentialVersion:ask.youtubeCredentialVersion,geminiCredentialVersion:ask.geminiCredentialVersion,
      publicData:{videoId:ask.videoId,title:"대역 공개 쇼츠 "+ask.videoId,channelTitle:"대역 채널",publishedAt:"2026-11-02T03:00:00Z",descriptionAvailable:true,durationSeconds:31,
        metrics:{views:0,likes:null,comments:fixture.metadataComments==="unavailable"?null:3},commentSample:sample},
      inference:{kind:"model_inference",summary:{text:"캠핑 요리를 짧게 보여 주는 영상으로 추정돼요.",basedOn:["title","public_metrics"]},
        topics:[{text:"야외 조리",basedOn:["title","description"]},{text:"간단한 재료",basedOn:["description"]}],
        productionHypotheses:fixture.metadataComments==="sampled"?[{text:"완성 장면을 먼저 보여 주는 구성일 수 있어요.",basedOn:["comment_sample","title"]}]:[]}});
  }
  if(path==="/api/admin/shorts-ideas"&&method==="POST"){
    if (fixture.hold==="ideas") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=fixture.ideaFaults.shift();
    if (fault) return response(fault.body,fault.status);
    const ask=body as {keyword:string;authorized:boolean;geminiCredentialVersion:number;context:{evidence:string;videoId:string}};
    if (Object.keys(ask).sort().join(",")!=="authorized,context,geminiCredentialVersion,keyword"||ask.authorized!==true) return response({code:"invalid_input"},400);
    if (fixture.credentials.programs.shorts.source!=="stored") return response({code:"not_configured"},503);
    if (ask.geminiCredentialVersion!==fixture.credentials.groups.reference.version) return response({code:"stale"},409);
    const ideas=Array.from({length:6},(_,index)=>({title:ask.keyword+" 소재 "+(index+1),openingHook:"첫 문장 "+(index+1)+" "+ask.context.evidence,hookStrategy:"질문으로 시작해요 "+(index+1),
      beats:["opening","setup","development","payoff"].map(phase=>({phase,action:phase+" 전개 "+(index+1)})),selectionReason:"선택 이유 "+(index+1),
      assessment:index===3?null:{kind:"model_estimate",rationale:"추정 근거 "+(index+1),potentialScore:(fixture.ideaScores[index]??[70,55])[0],expectedRetentionPercent:(fixture.ideaScores[index]??[70,55])[1]}}));
    return response({schemaVersion:1,geminiCredentialVersion:ask.geminiCredentialVersion,source:{evidence:ask.context.evidence,videoId:ask.context.videoId,provenance:"client_supplied"},
      generation:{kind:"creative_suggestions",ideas}});
  }
  if(path==="/api/admin/shorts-script"&&method==="POST"){
    if (fixture.hold==="script") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=fixture.scriptFaults.shift();
    if (fault) return response(fault.body,fault.status);
    if (new TextEncoder().encode(String(init?.body)).length>8192) return response({code:"too_large"},413);
    const ask=body as {authorized:boolean;geminiCredentialVersion:number;source:{evidence:string;videoId:string;provenance:string};selectedIdea:Record<string,unknown>;config:{durationSec:number;tone:string}};
    if (Object.keys(ask).sort().join(",")!=="authorized,config,geminiCredentialVersion,selectedIdea,source"||ask.authorized!==true
      ||Object.keys(ask.selectedIdea).sort().join(",")!=="beats,hookStrategy,openingHook,title") return response({code:"invalid_input"},400);
    if (fixture.credentials.programs.shorts.source!=="stored") return response({code:"not_configured"},503);
    if (ask.geminiCredentialVersion!==fixture.credentials.groups.reference.version) return response({code:"stale"},409);
    const d=ask.config.durationSec;
    const count=Math.max(3,Math.floor(d/6));
    const ends=[3,...Array.from({length:count-1},(_,index)=>3+Math.round((d-3)*(index+1)/(count-1)))];
    const scenes=ends.map((end,index)=>({sceneNumber:index+1,startSec:index?ends[index-1]:0,endSec:end,narration:"장면 "+(index+1)+" 내레이션 "+ask.config.tone,
      visual:"장면 "+(index+1)+" 화면",caption:index===1?null:"자막 "+(index+1),sfx:index===2?null:"효과음 "+(index+1)}));
    return response({schemaVersion:1,geminiCredentialVersion:ask.geminiCredentialVersion,source:ask.source,generation:{kind:"creative_script_draft",durationSec:d,scenes}});
  }
  if(path==="/api/admin/shorts-scene-prompt"&&method==="POST"){
    if (fixture.hold==="scene-prompt") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=fixture.scenePromptFaults.shift();
    if (fault) return response(fault.body,fault.status);
    if (new TextEncoder().encode(String(init?.body)).length>8192) return response({code:"too_large"},413);
    const ask=body as {authorized:boolean;geminiCredentialVersion:number;source:unknown;selectedIdea:Record<string,unknown>;durationSec:number;
      selectedScene:{sceneNumber:number;startSec:number;endSec:number;narration:string}};
    if (Object.keys(ask).sort().join(",")!=="authorized,durationSec,geminiCredentialVersion,selectedIdea,selectedScene,source"||ask.authorized!==true
      ||Object.keys(ask.selectedIdea).sort().join(",")!=="openingHook,title"
      ||Object.keys(ask.selectedScene).sort().join(",")!=="caption,endSec,narration,sceneNumber,sfx,startSec,visual") return response({code:"invalid_input"},400);
    if (fixture.credentials.programs.shorts.source!=="stored") return response({code:"not_configured"},503);
    if (ask.geminiCredentialVersion!==fixture.credentials.groups.reference.version) return response({code:"stale"},409);
    const scene=ask.selectedScene;
    return response({schemaVersion:1,geminiCredentialVersion:ask.geminiCredentialVersion,source:ask.source,generation:{kind:"creative_scene_prompt_draft",
      durationSec:ask.durationSec,sceneNumber:scene.sceneNumber,startSec:scene.startSec,endSec:scene.endSec,sceneSummary:"장면 "+scene.sceneNumber+" 요약: "+scene.narration,
      imagePrompt:"Vertical 9:16 frame for scene "+scene.sceneNumber+", soft daylight, close-up of the subject",
      videoPrompt:"Slow push-in camera for scene "+scene.sceneNumber+", vertical 9:16, gentle motion"}});
  }
  if(path==="/api/admin/shorts-bgm-prompt"&&method==="POST"){
    if (fixture.hold==="bgm-prompt") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=fixture.bgmPromptFaults.shift();
    if (fault) return response(fault.body,fault.status);
    if (new TextEncoder().encode(String(init?.body)).length>8192) return response({code:"too_large"},413);
    const ask=body as {authorized:boolean;geminiCredentialVersion:number;source:unknown;selectedIdea:Record<string,unknown>;durationSec:number;direction?:string;
      cues:{sceneNumber:number;startSec:number;endSec:number;note:string}[]};
    const keys=Object.keys(ask).sort().join(",");
    if ((keys!=="authorized,cues,durationSec,geminiCredentialVersion,selectedIdea,source"&&keys!=="authorized,cues,direction,durationSec,geminiCredentialVersion,selectedIdea,source")
      ||ask.authorized!==true||Object.keys(ask.selectedIdea).sort().join(",")!=="openingHook,title"||!Array.isArray(ask.cues)||ask.cues.length>4
      ||ask.cues.some(cue=>Object.keys(cue).sort().join(",")!=="endSec,note,sceneNumber,startSec")) return response({code:"invalid_input"},400);
    if (fixture.credentials.programs.shorts.source!=="stored") return response({code:"not_configured"},503);
    if (ask.geminiCredentialVersion!==fixture.credentials.groups.reference.version) return response({code:"stale"},409);
    const marks=ask.cues.map(cue=>cue.sceneNumber+"@"+cue.startSec+"-"+cue.endSec).join(" ")||"none";
    return response({schemaVersion:1,geminiCredentialVersion:ask.geminiCredentialVersion,source:ask.source,generation:{kind:"creative_bgm_prompt_draft",
      durationSec:ask.durationSec,title:"BGM "+ask.durationSec+"초 · 구간 "+ask.cues.length+"개",genreAndMood:"잔잔한 로파이 · 따뜻함"+(ask.direction?" · 방향 "+[...ask.direction].length+"자":""),
      recommendedBpmRange:ask.direction?.includes("BPM 없음")?null:{min:84,max:96},instrumentation:"피아노, 부드러운 신스 패드",
      dynamicStructure:"구간 "+marks+"에서 강약을 바꾼다",audioMixingNotes:"내레이션 아래 -18 LUFS로 깐다",
      sunoPrompt:"Calm lo-fi piano with soft pads, "+ask.durationSec+" seconds, cues "+marks+", no vocals"}});
  }
  if(path==="/api/projects"&&method==="GET"){
    if (fixture.hold==="projects") await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const fault=fixture.workroom.listFaults.shift();
    if (fault) return response(fault.body,fault.status);
    return response({projects:fixture.workroom.projects.map(project=>({id:project.id,title:project.title,menuId:project.menuId,menuLabel:project.menuLabel,aspect:"9:16",
      lengthSec:project.lengthSec,updatedAt:"2026-11-21T01:00:00.000Z",status:"in_progress",
      states:Object.entries(project.stages).map(([stage,status])=>({stage,status})),nextStage:"plan"}))});
  }
  { const match=path.startsWith("/api/projects/")&&path.endsWith("/plan")&&path.split("/").length===5?[path,path.split("/")[3]]:null;
    if (match) {
      const id=decodeURIComponent(match[1]);
      const project=fixture.workroom.projects.find(item=>item.id===id&&item.menuId==="shopping-shorts");
      const plan=fixture.workroom.plans[id];
      const view=()=>{ const latest=plan.drafts.at(-1);
        const writable=!plan.approved&&project!.stages.produce==="locked"&&["todo","in_progress","needs_approval"].includes(project!.stages.plan);
        return {revision:plan.revision,version:plan.version,writable,lengthSec:project!.lengthSec,steps:[{id:"hook",label:"훅"}],draft:latest?.draft??null,
          planId:plan.planId,canApprove:writable&&!!latest,approved:plan.approved,produceOpen:project!.stages.produce!=="locked",
          ...(latest?.materials ? {materials:latest.materials} : {})}; };
      const gate=()=>!project?response({error:"프로젝트를 찾을 수 없어요."},404)
        :project.stages.brief!=="approved"||project.stages.plan==="locked"?response({error:"브리프를 먼저 승인해 주세요."},409):null;
      if (method==="GET") {
        if (fixture.hold==="plan-get") await new Promise<void>(resolve=>{row.resolve=resolve;});
        if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
        const fault=fixture.workroom.planFaults.shift();
        if (fault) return response(fault.body,fault.status);
        return gate()??response(view());
      }
      if (method==="POST") {
        if (fixture.hold==="plan-import") await new Promise<void>(resolve=>{row.resolve=resolve;});
        if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
        const fault=fixture.workroom.importFaults.shift();
        if (fault&&"status" in fault) return response(fault.body,fault.status);
        if (new TextEncoder().encode(String(init?.body)).length>5*1024*1024) return response({error:"too large"},413);
        const ask=body as {action:string;revision:number;version:number;durationSec:number;draft:{script:string;scenes:Record<string,unknown>[]};materials?:unknown};
        const sceneKeys="assetIds,characterIds,description,dialogue,durationSec,stepId,title";
        const parsedMaterials="materials" in ask?shortsPlanMaterialsInput.safeParse(ask.materials):null;
        if (parsedMaterials&&(!parsedMaterials.success||parsedMaterials.data.scenes.length!==ask.draft?.scenes?.length)) return response({error:"초안의 내용이나 승인 확인을 다시 확인해 주세요."},400);
        if (Object.keys(ask).filter(key=>key!=="materials").sort().join(",")!=="action,draft,durationSec,revision,version"||ask.action!=="import-shorts-draft"
          ||Object.keys(ask.draft).sort().join(",")!=="scenes,script"||ask.draft.scenes.some(scene=>Object.keys(scene).sort().join(",")!==sceneKeys)
          ||ask.draft.scenes.reduce((total,scene)=>total+Number(scene.durationSec),0)!==ask.durationSec) return response({error:"초안의 내용이나 승인 확인을 다시 확인해 주세요."},400);
        const blocked=gate(); if (blocked) return blocked;
        if (!view().writable||ask.revision!==plan.revision||ask.version!==plan.version) return response({error:"현재 기획 상태가 바뀌었어요. 저장된 초안을 확인해 주세요."},409);
        if (ask.durationSec!==project!.lengthSec) return response({error:"프로젝트 목표 길이와 기획 초안 길이가 달라요. 대상 프로젝트를 다시 확인해 주세요."},409);
        let materials:unknown;
        if (parsedMaterials?.success) {
          const mismatch=shortsPlanMaterialsConflict(parsedMaterials.data,ask.draft.scenes as never,ask.durationSec);
          if (mismatch) return response({code:"PLAN_MATERIALS_STALE",error:"대본과 부가 자료의 생성 조건을 다시 확인해 주세요.",...mismatch},409);
          const sceneOrder=parsedMaterials.data.scenes.map((_,index)=>"0190a0b0-0000-7000-8000-"+String(plan.version+1).padStart(4,"0")+String(index+1).padStart(8,"0"));
          const flip=(value:unknown):unknown=>Array.isArray(value)?value.map(flip):value&&typeof value==="object"
            ?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,flip(item)])):value;
          materials=flip({...parsedMaterials.data,sceneOrder,scenes:parsedMaterials.data.scenes.map((scene,index)=>({...scene,sceneKey:sceneOrder[index]}))});
        } else if (plan.drafts.at(-1)?.materials) return response({code:"PLAN_MATERIALS_REQUIRED",error:"저장된 장면의 부가 자료를 함께 확인해 주세요."},409);
        plan.version+=1; plan.planId="0190a0b0-0000-7000-8000-0000000001"+String(plan.version).padStart(2,"0");
        plan.drafts.push({version:plan.version,draft:ask.draft,...(materials?{materials}:{})});
        if (project!.stages.plan==="todo") project!.stages.plan="in_progress";
        if (fault) throw new TypeError("Failed to fetch");
        return response({revision:plan.revision,version:plan.version,planId:plan.planId,draft:ask.draft,...(materials?{materials}:{})},201);
      }
    } }
  const uploadPath=/^[/]api[/]admin[/]audio-uploads(?:[/]([^/]+)([/]chunks)?)?$/.exec(path);
  if(uploadPath){
    const [,uploadId,chunked]=uploadPath;
    const at=!uploadId?"start":chunked?"chunk":method==="GET"?"get":String((body as {action?:unknown}|null)?.action);
    const faultAt=fixture.uploadFaults.findIndex(item=>item.at===at);
    const fault=faultAt<0?undefined:fixture.uploadFaults.splice(faultAt,1)[0];
    if (fault?.kind==="before") throw new TypeError("Failed to fetch");
    if (fault && typeof fault.kind==="object") return response(fault.kind.body,fault.kind.status);
    if (at!=="analyze" && fixture.hold==="upload-"+at) await new Promise<void>(resolve=>{row.resolve=resolve;});
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    const dto=(u:UploadRow)=>({id:u.id,status:u.status,sizeBytes:u.size,receivedBytes:u.received,chunkBytes:2097152,expiresAt:u.expiresAt,cleanup:u.cleanup,
      ...(u.report?{report:u.report}:{}),...(u.code?{code:u.code}:{})});
    const music=fixture.credentials.programs.music;
    const version=music.source==="stored"?fixture.credentials.groups.music.version:0;
    const pending=(async()=>{
      const ask=(body??{}) as Record<string,unknown>;
      if (at==="start") {
        if (typeof ask.sizeBytes==="number"&&ask.sizeBytes>104857600) return response({code:"too_large"},413);
        const name=typeof ask.filename==="string"?ask.filename:"";
        if (Object.keys(ask).sort().join(",")!=="authorized,credentialVersion,filename,requestId,sizeBytes"||ask.authorized!==true||typeof ask.requestId!=="string"
          ||name.length<5||name.length>255||name.includes("/")||!/[.](mp3|wav|m4a)$/i.test(name)||typeof ask.sizeBytes!=="number"||ask.sizeBytes<1) return response({code:"invalid_input"},400);
        if (!version) return response({code:"not_configured"},503);
        if (ask.credentialVersion!==version) return response({code:"stale_credential"},409);
        const hash=JSON.stringify([ask.credentialVersion,name,ask.sizeBytes]);
        const existing=Object.values(fixture.uploads).find(u=>u.requestId===ask.requestId);
        if (existing) return existing.hash===hash?response({upload:dto(existing)},200):response({code:"request_conflict"},409);
        if (Object.values(fixture.uploads).filter(u=>["uploading","uploaded","analyzing"].includes(u.status)).length>=fixture.uploadLimit) return response({code:"upload_limit"},429);
        const id="0190a0b0-0000-7000-8000-"+String(900000000001+Object.keys(fixture.uploads).length);
        fixture.uploads[id]={id,requestId:ask.requestId,hash,version,filename:name,size:ask.sizeBytes,received:0,status:"uploading",chunks:{},cleanup:"none",expiresAt:"2026-11-22T03:00:00.000Z"};
        return response({upload:dto(fixture.uploads[id])},201);
      }
      const u=fixture.uploads[uploadId];
      if (!u) return response({code:"not_found"},404);
      if (at==="get") return response({upload:dto(u)});
      if (at==="chunk") {
        if (u.status==="expired") return response({code:"expired",upload:dto(u)},410);
        if (u.status!=="uploading"&&u.status!=="uploaded") return response({code:"upload_closed",upload:dto(u)},409);
        if (u.version!==version) return response({code:"stale_credential",upload:dto(u)},409);
        const headers=new Headers(init?.headers);
        if (headers.get("content-type")!=="application/octet-stream") return response({code:"UNSUPPORTED_MEDIA_TYPE"},415);
        const offset=Number(headers.get("x-dream-upload-offset"));
        const bytes=new Uint8Array(await (init!.body as Blob).arrayBuffer());
        if (offset%2097152||offset>u.received) return response({code:"offset_conflict",upload:dto(u)},409);
        if (offset>=u.size||bytes.length!==Math.min(2097152,u.size-offset)) return response({code:"chunk_size",upload:dto(u)},400);
        let hash=2166136261;
        for (let index=0;index<bytes.length;index+=1) hash=Math.imul(hash^bytes[index],16777619);
        const sign=bytes.length+":"+hash;
        if (offset<u.received) return u.chunks[offset]===sign?response({upload:dto(u)}):response({code:"chunk_conflict",upload:dto(u)},409);
        u.chunks[offset]=sign; u.received+=bytes.length; u.status=u.received===u.size?"uploaded":"uploading";
        return response({upload:dto(u)});
      }
      if (at==="cancel"||at==="cleanup") {
        if (Object.keys(ask).join(",")!=="action") return response({code:"invalid_input"},400);
        if (at==="cancel"&&["uploading","uploaded","analyzing"].includes(u.status)) {
          u.status="cancelled"; u.code="cancelled"; u.chunks={}; if (u.analysisId) u.cleanup=fixture.uploadCleanup;
        }
        if (at==="cleanup"&&u.cleanup==="pending"&&["completed","failed","cancelled","expired"].includes(u.status)&&fixture.cleanupWorks) u.cleanup="done";
        return response({upload:dto(u)});
      }
      if (at!=="analyze") return response({code:"invalid_input"},400);
      const allowed=["action","authorized","context","credentialVersion","mode","reportVersion","requestId","specialRequest"];
      if (!Object.keys(ask).every(key=>allowed.includes(key))||ask.authorized!==true||typeof ask.requestId!=="string"||!["auto","speech","music"].includes(String(ask.mode))
        ||[ask.context,ask.specialRequest].some(value=>value!==undefined&&(typeof value!=="string"||[...value.trim()].length>2000))
        ||(ask.reportVersion!==undefined&&ask.reportVersion!==2)) return response({code:"invalid_input"},400);
      if (u.status==="expired") return response({code:"expired",upload:dto(u)},410);
      const hash=JSON.stringify(Object.keys(ask).sort().map(key=>[key,ask[key]]));
      if (u.analysisId===ask.requestId&&u.analysisHash===hash) return response({upload:dto(u)},u.status==="analyzing"?202:200);
      if (!u.analysisId&&!version) return response({code:"not_configured"},503);
      if (version!==ask.credentialVersion||u.version!==ask.credentialVersion) return response({code:"stale_credential",upload:dto(u)},409);
      if (u.status!=="uploaded") return response({code:"analysis_conflict",upload:dto(u)},409);
      u.status="analyzing"; u.analysisId=ask.requestId; u.analysisHash=hash;
      // 서버는 요청 연결이 끊겨도 분석을 끝까지 처리한다(붙잡힌 동안 GET은 analyzing, 같은 요청은 202).
      if (fixture.hold==="upload-analyze") await new Promise<void>(resolve=>{row.resolve=resolve;});
      if (u.status==="cancelled") return response({code:"cancelled",upload:dto(u)},409);
      u.chunks={};
      const outcome=fixture.uploadOutcome;
      if (outcome) {
        u.status="failed"; u.code=outcome; u.cleanup=outcome==="invalid_file"?"none":fixture.uploadCleanup;
        return response({code:outcome,upload:dto(u)},outcome==="invalid_file"?422:outcome==="timed_out"?504:outcome==="media_unavailable"?503:502);
      }
      const mode=String(ask.mode);
      const kind=mode==="auto"?fixture.audio.auto:mode;
      u.report=ask.reportVersion===2?fixture.detailed(mode,kind):kind==="undetermined"?{schemaVersion:1,requestedMode:mode,status:"unavailable",kind:"undetermined",reason:"undetermined"}
        :{schemaVersion:1,requestedMode:mode,...(kind==="music"?{status:"ready",provider:"gemini",kind:"music",report:fixture.music.report}:fixture.audio.speech)};
      u.status="completed"; u.cleanup=fixture.uploadCleanup;
      return response({upload:dto(u)});
    })();
    if (fault?.kind==="drop") { void pending.catch(()=>{}); throw new TypeError("Failed to fetch"); }
    const reply=await pending;
    if (fault?.kind==="after") throw new TypeError("Failed to fetch");
    if (init?.signal?.aborted) throw new DOMException("aborted","AbortError");
    return reply;
  }
  if(path==="/api/admin/analysis-credentials/test"&&method==="POST"){
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
    if (fixture.hold==="credentials" && method==="PUT") await new Promise<void>(resolve=>{row.resolve=resolve;});
    // 409 뒤 최신 설정 GET이 늦게 오는 구간을 재현한다(hold "credentials-get").
    if (fixture.hold==="credentials-get" && method==="GET") await new Promise<void>(resolve=>{row.resolve=resolve;});
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
  return response({},404);
};
`;
const plugins = [{ name: "fixture-server-boundaries", setup(builder) {
  builder.onResolve({ filter: /^(next\/link|next\/image|@\/lib\/cloud\/project-read-page|server-only)$/ }, args => ({ path: args.path, namespace: "fixture" }));
  // 관리자 홈 2안 배너: next/image는 Next 밖에서 묶으면 컴포넌트가 아니므로 같은 속성의 <img>로 대신한다.
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: repo, contents: args.path === "next/image"
    ? "import { createElement } from 'react'; export default function Image({ src, alt, fill, sizes, priority, loading, fetchPriority, ...rest }) { void priority; void fetchPriority; return createElement('img', { src, alt, sizes, loading: loading ?? 'lazy', decoding: 'async', style: fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : undefined, ...rest }); }"
    : args.path === "next/link"
    ? "import { createElement } from 'react'; export default function Link({ href, prefetch, ...rest }) { void prefetch; return createElement('a', { href, ...rest }); }"
    : args.path === "server-only" ? "export {};"
    : "export async function readCloudProjects() { throw new Error('Storage is outside this UI fixture'); }" }));
} }];
const common = { absWorkingDir: repo, bundle: true, jsx: "automatic", write: false, define: { "process.env.NODE_ENV": '"production"' }, external: ["/showcase/*"], plugins };
const browser = await build({ ...common, outfile: "fixture.js", stdin: { loader: "tsx", resolveDir: repo, contents:
  'import {hydrateRoot} from "react-dom/client";' +
  // 62acea6 운영 기준에는 쇼츠 부가 자료 검증 모듈이 없어 그 대역만 통과시킨다(Style DNA 원본 화면 대역용).
  'const shortsPlanMaterialsInput={safeParse:(value:unknown)=>({success:true as const,data:value})};const shortsPlanMaterialsConflict=(..._args:unknown[])=>null;' + app + transport + 'hydrateRoot(document.getElementById("root")!,application);' } });
const ssr = await build({ ...common, outfile: "fixture.cjs", platform: "node", format: "cjs", stdin: { loader: "tsx", resolveDir: repo, contents:
  'import {renderToString} from "react-dom/server";' + app + "export const markup=renderToString(application);" +
  "export const markupFor=(page:string)=>{(globalThis as {__fixturePage?:string}).__fixturePage=page; return renderToString(makeApplication());};" } });
const js = browser.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = browser.outputFiles.find(file => file.path.endsWith(".css")).text;
const evaluated = { exports: {} };
new Function("require", "module", "exports", ssr.outputFiles.find(file => file.path.endsWith(".cjs")).text)(require, evaluated, evaluated.exports);
const markup = evaluated.exports.markup;
const pageMarkups = { "style-dna": evaluated.exports.markupFor("style-dna"), "style-dna-panel": evaluated.exports.markupFor("style-dna-panel") };
const server = createServer((request, response) => {
  const parsed = new URL(request.url, "http://127.0.0.1"), path = parsed.pathname;
  const pageMarkup = pageMarkups[parsed.searchParams.get("page")] ?? markup;
  if (path === "/admin" || path === "/") return response.writeHead(200, { "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; media-src blob: 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'" }).end(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>관리 화면 대역 검수</title><link rel="stylesheet" href="/fixture.css"><body><div id="root">' + pageMarkup + '</div><script src="/fixture.js"></script></body></html>');
  if (path === "/fixture.js") return response.writeHead(200, { "content-type": "application/javascript" }).end(js);
  if (path === "/fixture.css") return response.writeHead(200, { "content-type": "text/css" }).end(css);
  if (/^\/[a-z0-9/_-]+\.(svg|webp|png|jpg)$/i.test(path)) {
    const file = new URL("../../public" + path, import.meta.url);
    const types = { svg: "image/svg+xml", webp: "image/webp", png: "image/png", jpg: "image/jpeg" };
    if (existsSync(file)) return response.writeHead(200, { "content-type": types[path.split(".").at(-1)] }).end(readFileSync(file));
  }
  // P1-06 Style DNA 원본·시험 이미지 대역(실제 바이트 대신 크기를 맞춘 SVG). 원본은 청록, 시험 결과는 주황 계열.
  const sdMedia = /^[/]api[/]admin[/]style-dna[/][^/]+[/]media[/]([^/]+)$/.exec(path);
  if (sdMedia) {
    const original = sdMedia[1] === "original";
    const [w, h] = original ? [640, 400] : [400, 640];
    // ?m=fail: 이미지 읽기 실패, ?m=delay:<ms>: 그만큼 늦게 보낸다(원본은 언제나 바로).
    const late = original ? "" : parsed.searchParams.get("m") ?? "";
    if (late === "fail") return response.writeHead(500, { "cache-control": "no-store" }).end();
    const send = () => response.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" }).end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><rect width="100%" height="100%" fill="' + (original ? "#1f6f6a" : "#c96a3b") + '"/>' +
      '<circle cx="50%" cy="50%" r="30%" fill="' + (original ? "#e8d5b0" : "#f4f1ea") + '"/></svg>');
    const delay = /^delay:(\d{1,5})$/.exec(late);
    if (delay) { setTimeout(send, Number(delay[1])); return; }
    return send();
  }
  response.writeHead(404).end();
});
server.listen(port, "127.0.0.1", () => console.log("ADMIN-HUB-READY http://127.0.0.1:" + server.address().port));
