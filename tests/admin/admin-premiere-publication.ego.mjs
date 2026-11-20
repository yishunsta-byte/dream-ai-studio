/* global taskSpace, window, document, location, innerHeight, getComputedStyle, history, DataTransfer, File, Event, console */
import assert from "node:assert/strict";
// Run against the loopback URL emitted by admin-premiere-publication-run.mjs.
import {mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
const proof=globalThis.FIXTURE_OUTPUT_DIR??join(tmpdir(),"dream-premiere-qa");
const base=globalThis.FIXTURE_ORIGIN;
assert.match(base??"",/^http:\/\/127\.0\.0\.1:\d+$/);
await mkdir(proof,{recursive:true});
const task=await taskSpace("Premiere keyboard and publication "+Date.now());
const page=task.page("p1");
const publicPage=await task.newPage();
const runCode=Math.random().toString(36).slice(2,7);
const listId="admin-analysis-results";
const apiId="admin-api-integrations";
const imageId="admin-style-dna";
const musicId="admin-music-analysis";
const shortsId="admin-shorts-analysis";
const publication="/api/admin/reference-publications";
const listForm="#"+listId+" form";
const results=[];
const inspect=()=>page.evaluate(()=>window.__premiere.requests());
const writes=async(method="POST")=>(await inspect()).filter(request=>request.path===publication&&request.method===method);
const listReads=async()=>(await inspect()).filter(request=>request.path===publication&&request.method==="GET");
const text=(id,needle)=>page.waitForFunction(({id,needle})=>document.getElementById(id)?.innerText.includes(needle),{id,needle},{timeout:6000});
const press=async selector=>{await page.focus(selector);await page.keyboard.press("Enter");};
const check=async selector=>{await page.focus(selector);await page.keyboard.press("Space");};
const tabTo=async selector=>{
  for(let remaining=0;remaining<85;remaining++){
    if(await page.evaluate(selector=>document.activeElement.matches(selector),selector))return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Tab could not reach "+selector);
};
const view=async (id,hash="#"+id)=>{
  await page.waitForFunction(({id,hash})=>location.hash===hash&&document.activeElement.tagName==="H2"&&document.getElementById(id)?.contains(document.activeElement),{id,hash},{timeout:5500});
  const state=await page.evaluate(id=>{
    const heading=document.activeElement;
    const rect=heading.getBoundingClientRect();
    const menu=document.querySelector('nav[aria-label="관리 메뉴"]');
    const bar=menu.getBoundingClientRect();
    const point=document.elementFromPoint((rect.left+rect.right)/2,(rect.top+rect.bottom)/2);
    return {id,heading:heading.innerText,active:document.querySelector('nav [aria-current="location"]')?.hash,
      clear:rect.top>=0&&rect.bottom<=innerHeight&&heading.contains(point)&&
        (getComputedStyle(menu).position!=="sticky"||bar.top>1||rect.top>=bar.bottom-1),
      overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth),
      position:getComputedStyle(menu).position, onlyPanel:[...document.querySelectorAll('[data-active-section="true"]')].map(p=>p.id)};
  },id);
  assert.equal(state.active,"#"+id);
  assert.equal(state.overflow,0,JSON.stringify(state));
  assert.equal(state.clear,true,JSON.stringify(state));
  assert.deepEqual(state.onlyPanel,[id]);
  return state;
};
const move=async id=>{
  await tabTo('nav[aria-label="관리 메뉴"] a[href="#'+id+'"]');
  await page.keyboard.press("Enter");
  return view(id);
};
const open=async(width,height,scale=1)=>{
  await page.cdp("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:width<600});
  await page.goto(base+"/admin?width="+width+"&height="+height+"&scale="+scale);
  await page.waitForFunction(()=>window.__premiere&&document.querySelector("[data-admin-ready]"));
  if(scale===2)await page.evaluate(()=>{
    const root=document.documentElement, style=getComputedStyle(root);
    for(const size of ["xs","sm","md","lg","xl","2xl","3xl","4xl"]){
      const key="--text-"+size, value=parseFloat(style.getPropertyValue(key));
      if(Number.isFinite(value))root.style.setProperty(key,(2*value)+"px");
    }
  });
};
const prepare=async()=>{
  await tabTo('section[data-program-active="true"] button'); // Tab traversal continues to the result action below.
  const button=await page.evaluate(()=>[...document.querySelectorAll('section[data-program-active="true"] button')].find(node=>node.textContent.trim()==="공개 준비").getAttribute("type"));
  assert.equal(button,"button");
  await press('loc=role:button[name="공개 준비"]');
  await view(listId);
  await page.waitForSelector(listForm);
};
const prompt=()=>page.evaluate(()=>document.querySelector('#admin-analysis-results form textarea[id$="-prompt"]').value);
const preview=()=>page.evaluate(()=>document.querySelector('article[aria-label="웹 공개 미리보기"]').innerText);
const fill=async (field,value)=>page.fill('loc=css:'+listForm+' [id$="-'+field+'"]',value);
const authorize=()=>check('loc=css:'+listForm+' input[type=checkbox]');
const submit=()=>press('loc=role:button[name="공개하기"]');
const awaitWrite=(method,count)=>page.waitForFunction(({method,count,publication})=>window.__premiere.requests().filter(r=>r.path===publication&&r.method===method).length===count,{method,count,publication},{timeout:5500});
const fault=value=>page.evaluate(value=>{window.__premiere.publicationFault=value;},value);
const hold=value=>page.evaluate(value=>{window.__premiere.hold=value;},value);
const release=()=>page.evaluate(()=>{window.__premiere.release();window.__premiere.hold="";});

const safeFields=["authorized","id","media","prompt","summary","title"];
function verifyPayload(body,media){
  assert.deepEqual(Object.keys(body).sort(),safeFields);
  assert.equal(body.media,media);
  assert.equal(body.authorized,true);
  assert.match(body.id,/^[0-9a-f-]{36}$/);
  assert.doesNotMatch(JSON.stringify(body),/private\.example|A1b2C3d4E5F|premiere-fixture\.wav|원본 확인용 근거/);
}

async function readPublic(title,present,promptText){
  await publicPage.goto(base+"/analysis-results?at="+Date.now()+Math.random());
  const card=await publicPage.evaluate(title=>{
    const found=[...document.querySelectorAll("article")].filter(card=>card.querySelector("h2")?.textContent===title);
    return {count:found.length,text:found[0]?.innerText??""};
  },title);
  assert.equal(card.count,present?1:0,JSON.stringify(card));
  if(present&&promptText)assert.ok(card.text.includes(promptText));
  assert.doesNotMatch(card.text,/private\.example|원본 확인용 근거|검수 영상 주소/);
}

try{
 for(const width of [390,1440]){
  await open(width,900);
  await move("admin-project-list");
  await page.evaluate(()=>history.back());
  await view("admin-project-list","");
  await page.goto(base+"/admin?legacy="+width+"#admin-reference-analysis");
  await view(imageId);
  await open(width,900);
  assert.equal((await listReads()).length,0);
  const focus=[];
  for(const id of [musicId,"admin-overview",apiId,"admin-account",imageId])focus.push(await move(id));
  await page.evaluate(()=>history.back());
  focus.push(await view("admin-account"));
  await page.evaluate(()=>history.forward());
  focus.push(await view(imageId));
  assert.equal((await listReads()).length,0);
  await text(imageId,"Style DNA로 분석");
  await page.fill('loc=css:#'+imageId+' input[type=url]',"https://mdn.github.io/fixture.png");
  await check('loc=css:#'+imageId+' input[type=checkbox]');
  await press('loc=role:button[name="Style DNA로 분석"]');
  await text(imageId,"공개 준비");
  await page.selectOption('#'+imageId+' select',"en");
  await prepare();
  assert.equal(await prompt(),"Premiere image suggestion");
  assert.match(await preview(),/추정 구도/);
  assert.doesNotMatch(await preview(),/private\.example|원본 확인용 근거/);
  assert.equal((await writes()).length,0);
  assert.equal(await page.evaluate(selector=>document.querySelector(selector+' button[type=submit]').disabled,listForm),true);
  await page.waitForFunction(()=>document.querySelector("#admin-analysis-results").innerText.includes("공개한 분석 결과"));
  const draftOpenReadCount=(await listReads()).length;
  assert.equal(draftOpenReadCount,1);
  const imageTitle="프리미어 이미지 "+width+" "+runCode;
  await fill("title",imageTitle);
  await fill("summary","https://private.example.invalid/model");
  await authorize();
  await submit();
  await text(listId,"공개 문구에서 주소, 계정 또는 키를 지워 주세요.");
  assert.equal((await writes()).length,0);
  assert.doesNotMatch(await preview(),/private\.example/);
  await fill("summary","야경 속 인물과 도시 구도의 추정 요약");
  assert.equal(await page.evaluate(selector=>document.querySelector(selector+' input[type=checkbox]').checked,listForm),false);
  await authorize();
  await fault("lost");
  await submit();
  await awaitWrite("POST",1);
  await text(listId,"같은 공개 요청을 다시 보내요");
  await submit();
  await awaitWrite("POST",2);
  await text(listId,"공개했어요.");
  const imagePosts=await writes();
  verifyPayload(imagePosts[0].body,"image");
  assert.deepEqual(imagePosts[0].body,imagePosts[1].body);
  await readPublic(imageTitle,true,"Premiere image suggestion");

  await move(musicId);
  await page.evaluate(id=>{
    const input=document.querySelector("#"+id+" input[type=file]");
    const files=new DataTransfer();
    files.items.add(new File([new Uint8Array(160)],"premiere-fixture.wav",{type:"audio/wav"}));
    input.files=files.files;
    input.dispatchEvent(new Event("change",{bubbles:true}));
  },musicId);
  await text(musicId,"Gemini에 원본 파일");
  await check('loc=css:#'+musicId+' input[type=checkbox]');
  await press('loc=role:button[name="음악 의미 분석 실행"]');
  await text(musicId,"공개 준비");
  await prepare();
  assert.equal(await prompt(),"Premiere fixture music");
  assert.match(await preview(),/추정 템포/);
  assert.equal((await writes()).length,2);
  const musicTitle="프리미어 음악 "+width+" "+runCode;
  await fill("title",musicTitle+" 초안");
  await authorize();
  await fault("lost");
  await submit();
  await awaitWrite("POST",3);
  await text(listId,"같은 공개 요청을 다시 보내요");
  await fill("title",musicTitle);
  assert.equal(await page.evaluate(selector=>document.querySelector(selector+' input[type=checkbox]').checked,listForm),false);
  await authorize();
  await fault("conflict");
  await submit();
  await awaitWrite("POST",4);
  await text(listId,"‘공개한 분석 결과’ 목록을 확인한 뒤 다시 동의하고 공개해 주세요");
  await authorize();
  await submit();
  await awaitWrite("POST",5);
  await text(listId,"공개했어요.");
  const musicPosts=(await writes()).slice(2,5);
  for(const post of musicPosts)verifyPayload(post.body,"music");
  assert.equal(new Set(musicPosts.map(p=>p.body.id)).size,3);
  await readPublic(musicTitle,true,"Premiere fixture music");

  await move(shortsId);
  await page.fill('loc=role:textbox[name="공개 YouTube 영상 주소"]',"https://www.youtube.com/shorts/A1b2C3d4E5F");
  await check('loc=css:#'+shortsId+' input[type=checkbox]');
  await press('loc=role:button[name="쇼츠 분석"]');
  await text(shortsId,"공개 준비");
  await prepare();
  assert.equal(await prompt(),"Premiere fixture Shorts");
  assert.equal((await writes()).length,5);
  const videoTitle="프리미어 쇼츠 "+width+" "+runCode;
  await fill("title",videoTitle);
  await authorize();
  await fault("invalid");
  await submit();
  await awaitWrite("POST",6);
  await text(listId,"링크, 파일 경로, 계정 정보, API 키를 지워 주세요");
  assert.deepEqual(await page.evaluate(selector=>{
    const form=document.querySelector(selector);
    return {
      focused:document.activeElement===form.querySelector('[role="alert"]'),
      checked:form.querySelector('input[type="checkbox"]').checked,
      title:form.querySelector('input[id$="-title"]').value,
    };
  },listForm),{focused:true,checked:false,title:videoTitle});
  await readPublic(videoTitle,false);
  await authorize();
  await hold("publication");
  await submit();
  await awaitWrite("POST",7);
  const videoPosts=(await writes()).slice(5);
  assert.notEqual(videoPosts[0].body.id,videoPosts[1].body.id);
  await move(apiId);
  await release();
  await page.waitForFunction(()=>document.querySelector("#admin-analysis-results form [role=status]")?.textContent.includes("공개했어요."));
  assert.equal(await page.evaluate(()=>document.activeElement.id),"admin-api-integrations-title");
  await readPublic(videoTitle,true,"Premiere fixture Shorts");
  await move(listId);
  await text(listId,videoTitle);
  verifyPayload((await writes()).at(-1).body,"video");

  const videoIndex=await page.evaluate(title=>[...document.querySelectorAll('#admin-analysis-results ul > li')].findIndex(li=>li.querySelector("h4")?.textContent===title),videoTitle);
  assert.ok(videoIndex>=0);
  await press('loc=css:#'+listId+' ul > li:nth-child('+(videoIndex+1)+') button');
  assert.equal((await writes("DELETE")).length,0);
  await press('loc=role:button[name="공개 철회 확인"]');
  await awaitWrite("DELETE",1);
  await text(listId,"철회했어요.");
  await readPublic(videoTitle,false);
  const removed=(await writes("DELETE"))[0].body;
  assert.deepEqual(Object.keys(removed),["id"]);
  assert.equal(removed.id,(await writes()).at(-1).body.id);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:proof+"/premiere-publication-"+width+".png",fullPage:width===390});
  await move(apiId);
  await fault("login");
  await move(listId);
  await text(listId,"로그인이 끝났어요");
  assert.equal(await page.evaluate(()=>document.querySelector("#admin-analysis-results form")),null);
  assert.equal((await writes()).length,7);
  results.push({width,focus,firstListReadCount:draftOpenReadCount,sameIdOnRetry:true,newIdAfterEditAndConflict:true,invalidPublicationRecovery:true,safeFields,publicCard:true,revokedAbsent:true,writeStatusAfterLeave:true,authFailureHide:true});
 }
 for(const [width,height,scale] of [[320,360,2],[1280,900,2]]){
  await open(width,height,scale);
  const focus=[];
  for(const id of [imageId,musicId,shortsId,"admin-overview","admin-project-list","admin-review","admin-render-queue",apiId,"admin-account"]){
    focus.push(await move(id));
  }
  await page.evaluate(()=>history.back());
  focus.push(await view(apiId));
  if(height===360)assert.ok(focus.every(row=>row.position==="static"));
  results.push({width,height,scale,focus});
 }
 await writeFile(proof+"/premiere-admin-publication-results.json",JSON.stringify(results,null,2)+"\n");
 console.log(JSON.stringify(results));
}finally{
 await task.finish({keep:[]});
}
