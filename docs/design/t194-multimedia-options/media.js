'use strict';
const theme=document.documentElement.dataset.theme;
const assets=['neon-rooftop.png','desert-motion.png','wild-coast.png'];
const scenes=[
 {title:'NEON AFTER HOURS',kind:'뮤직',image:0,caption:'도시의 밤, 새로운 리듬',position:'70% center'},
 {title:'DESERT MOTION',kind:'광고',image:1,caption:'속도보다 강렬한 한 장면',position:'60% center'},
 {title:'THE WILD COAST',kind:'여행',image:2,caption:'일상을 벗어나는 시선',position:'65% center'},
 {title:'ELECTRIC PORTRAIT',kind:'뮤직',image:0,caption:'네온 공연 이미지의 세로 구도',position:'85% center'},
 {title:'ORANGE / BLUE',kind:'광고',image:1,caption:'자동차 이미지의 컬러 디테일',position:'80% center'},
 {title:'EDGE OF THE OCEAN',kind:'여행',image:2,caption:'해안 이미지의 풍경 디테일',position:'95% center'}
];
const titles={neon:'NEON PLAY',wave:'COLOR WAVE',cinema:'CINEMA STAGE'};
const states={normal:'기본',loading:'불러오는 중',empty:'프로젝트 없음',error:'불러오기 오류',offline:'오프라인',guest:'로그인 전',cloud:'클라우드'};
let state=new URLSearchParams(location.search).get('state')||'normal';if(!states[state])state='normal';
let filter='전체',query='',hero=theme==='cinema'?2:0,lastTrigger;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const image=(i,cls='',alt='')=>`<img class="${cls}" src="assets/${assets[i]}" alt="${alt}" decoding="async">`;
const search=()=>'<div class="search-field"><label class="sr-only" for="scene-search">장면 이름 또는 장르 검색</label><span aria-hidden="true">⌕</span><input id="scene-search" type="search" placeholder="어떤 장면을 찾고 있나요?" autocomplete="off"></div>';
const primary=()=>`<button class="btn primary" data-action="new" ${state==='loading'?'disabled aria-describedby="loading-reason"':''}>${state==='guest'?'로그인 안내':state==='cloud'?'제작 흐름 살펴보기':'새 프로젝트 시작'} <span aria-hidden="true">↗</span></button>`;
const footer=()=>'<footer class="footer"><p>DREAM AI STUDIO · 디자인 검토용 시안<br>생성한 정지 이미지 · 가상 프로젝트 · 실제 재생·제작·저장 없음</p><a href="index.html">다른 디자인 비교하기 ↗</a></footer>';
function notice(){
 const data={loading:['프로젝트를 불러오고 있어요','목록 확인 전에는 새 프로젝트를 시작할 수 없습니다.'],empty:['첫 번째 이야기를 시작해 보세요','프로젝트가 없는 상태입니다. 아래 이미지는 디자인용 영감 예시입니다.'],error:['프로젝트 목록을 불러오지 못했어요','작업이 삭제된 것은 아닙니다. 연결 상태를 확인한 뒤 다시 시도하세요.'],offline:['오프라인 · 제작 요청 대기','시안 이미지와 가상 작업은 살펴볼 수 있습니다. 실제 제작에는 연결이 필요합니다.'],guest:['나만의 스튜디오를 시작하세요','이 화면은 로그인 전 시안입니다. 로그인과 계정 연결은 실행하지 않습니다.'],cloud:['클라우드 제작 흐름 미리보기','클라우드에서는 제작 과정을 둘러봅니다. 실제 작업 요청이나 파일 저장은 하지 않습니다.']}[state];
 return data?`<aside class="notice ${['error','offline'].includes(state)?'warning':''}" aria-label="현재 상태"><div><h2>${data[0]}</h2><p ${state==='loading'?'id="loading-reason"':''}>${data[1]}</p></div>${state==='error'?'<button class="btn" data-action="retry">다시 시도</button>':''}</aside>`:'';
}
function project(){
 if(state==='loading')return '<section id="projects" tabindex="-1" class="empty" aria-busy="true"><h2>프로젝트 확인 중</h2><p>목록과 작업 환경을 불러오고 있어요.</p></section>';
 if(['empty','error','guest'].includes(state))return `<section id="projects" tabindex="-1" class="empty"><h2>${state==='empty'?'아직 프로젝트가 없어요':state==='error'?'연결을 확인해 주세요':'나만의 작업 공간'}</h2><p>${state==='empty'?'쇼핑숏츠 샘플로 첫 기획을 살펴보세요.':state==='error'?'위의 다시 시도로 목록 복구 화면을 확인할 수 있습니다.':'로그인 안내에서 계정 연결 흐름을 확인할 수 있습니다.'}</p>${primary()}</section>`;
 return `<section class="studio-strip" id="projects" tabindex="-1" aria-label="내 작업과 제작 환경"><article class="continue-card">${image(1,'','주황색 자동차 프로젝트 예시')}<div class="continue-copy"><div class="eyebrow">CONTINUE CREATING</div><h2>DESERT MOTION</h2><p>쇼핑숏츠 샘플 · 수정·조립 예시</p></div><button class="text-link" data-action="continue">작업 살펴보기 ↗</button></article><aside class="environment"><div class="env-head"><h2>제작 환경</h2><span class="chip ${state==='offline'?'warning':''}">${state==='cloud'?'클라우드 안내':state==='offline'?'연결 대기':'상태 예시'}</span></div><p>${state==='cloud'?'제작 흐름과 필요한 연결 조건을 확인하세요.':'최근 응답은 작업 성공이나 프로세스 종료를 뜻하지 않습니다.'}</p><button class="text-link" data-action="environment">${state==='cloud'?'제작 흐름 안내':'상태 읽는 법'} ↗</button></aside></section>`;
}
function library(){return `<section id="inspiration" tabindex="-1" class="${theme==='cinema'?'cinema-library':''}" aria-labelledby="library-title"><div class="section-head"><div><div class="eyebrow muted">CURATED VISUALS</div><h2 id="library-title">${theme==='wave'?'취향을 깨우는 영감 보드':theme==='cinema'?'장면이 이야기가 되는 순간':'다음 아이디어를 발견하세요'}</h2><p>광고·뮤직·여행의 이미지 예시입니다. 제작 템플릿이 아닙니다.</p></div><button class="text-link" data-action="about">이미지 안내 ↗</button></div><div class="library-tools"><div class="filters" role="group" aria-label="이미지 장르">${['전체','광고','뮤직','여행'].map(k=>`<button data-filter="${k}" aria-pressed="${filter===k}">${k}</button>`).join('')}</div>${theme!=='wave'?search():''}</div><div id="results-note" class="sr-only" role="status" aria-live="polite"></div><div id="scene-cards" class="${theme==='wave'?'masonry':'media-grid'}"></div></section>`;}
function cards(){
 const found=scenes.map((s,i)=>({...s,i})).filter(s=>(filter==='전체'||s.kind===filter)&&`${s.title} ${s.kind} ${s.caption}`.toLowerCase().includes(query.toLowerCase()));
 document.querySelector('#results-note').textContent=`이미지 ${found.length}개`;
 document.querySelector('#scene-cards').innerHTML=found.length?found.map(s=>`<article class="media-card"><button class="scene-button" data-scene="${s.i}" aria-label="${s.title} 장면 이미지 살펴보기"><img src="assets/${assets[s.image]}" alt="${s.caption}" style="object-position:${s.position}"><span class="image-label">AI IMAGE · ${s.kind}</span><span class="scene-play" aria-hidden="true">↗</span></button><div class="scene-info"><div><h3>${s.title}</h3><p>${s.caption}</p></div><span class="scene-index">0${s.i+1}</span></div></article>`).join(''):'<div class="empty" style="grid-column:1/-1"><h3>일치하는 장면이 없어요</h3><p>다른 검색어를 입력하거나 필터를 초기화하세요.</p><button class="btn" data-action="reset">검색 초기화</button></div>';
}
function heroSection(cinema=false){return `<section class="spotlight ${cinema?'cinema-hero':''}" aria-label="대표 장면">${image(hero,'hero-image','디자인용 AI 생성 장면')}<span class="pulse-label">${cinema?'VISUAL STORIES / 01':'DREAM ORIGINAL VISUAL'}</span><div class="hero-copy"><div class="eyebrow">${cinema?'A NEW WAY TO CREATE':'YOUR IDEAS. IN FULL COLOR.'}</div><h1>${cinema?'당신의 상상에<br>장면을 입히다.':'상상이 시작되는<br><span class="gradient-type">가장 빛나는 순간.</span>'}</h1><p>${cinema?'한 장면에서 시작해 하나의 이야기로.<br>새로운 시선으로 당신만의 영상을 기획하세요.':'영감을 발견하고, 아이디어를 장면으로.<br>당신의 첫 이야기를 지금 시작해 보세요.'}</p><div class="actions">${primary()}<button class="btn ghost" data-action="hero">장면 이미지 살펴보기</button></div><span class="chip">현재 제작 예시: 쇼핑숏츠 샘플</span></div><div class="hero-bottom">${cinema?'<button class="circle" data-action="prev" aria-label="이전 대표 이미지">←</button>':''}<span id="hero-caption">0${hero+1} / 03 · ${scenes[hero].title}</span><button class="circle" data-action="next" aria-label="다음 대표 이미지">→</button></div></section>`;}
function render(){
 let content=theme==='wave'?`<div class="wave-intro"><div><div class="eyebrow">CREATE SOMETHING UNEXPECTED</div><h1>아이디어는 자유롭게.<br><span>결과는 놀랍게.</span></h1></div><div class="right"><p>눈길을 사로잡는 장면, 새로운 색의 조합.<br>오늘의 영감에서 나만의 이야기를 찾아보세요.</p>${search()}</div></div><section class="wave-feature" aria-label="대표 영감"><div class="feature-image">${image(1,'','푸른 하늘 아래 주황색 자동차')}<span class="chip">AI IMAGE · ADVERTISING</span></div><div class="feature-copy"><div class="eyebrow">SPOTLIGHT / DESERT MOTION</div><h2>평범한 아이디어에<br>과감한 한 끗.</h2><p>강렬한 색과 낯선 풍경이 만나면<br>새로운 이야기가 시작됩니다.</p><button class="btn" data-scene="1">이미지 크게 보기 ↗</button></div></section>${notice()}${library()}<section class="wave-callout"><div><h2>이제, 당신의 차례.</h2><p>쇼핑숏츠 샘플로 제작 기획을 살펴보세요.</p></div>${primary()}</section>${project()}${footer()}`:theme==='cinema'?`${heroSection(true)}<div class="cinema-content"><div class="cinema-ribbon"><strong>MAKE EVERY FRAME MATTER.</strong><span>IDEA → STORY → SCENE</span><span>DREAM AI STUDIO</span></div>${notice()}${library()}${project()}${footer()}</div>`:`${heroSection()}<div class="ribbon"><strong>CREATE YOUR NEXT.</strong><i aria-hidden="true">✦</i><span>IMAGINE / CREATE / EXPLORE</span><span>ONE IDEA. ENDLESS POSSIBILITIES.</span></div>${notice()}${library()}${project()}${footer()}`;
 document.querySelector('#workspace').innerHTML=content;document.documentElement.dataset.state=state;cards();
 const headButton=document.querySelector('.header-actions .btn');headButton.disabled=state==='loading';headButton.textContent=state==='cloud'?'제작 흐름 안내 ↗':state==='guest'?'로그인 안내 ↗':'프로젝트 시작 ↗';if(state==='loading')headButton.setAttribute('aria-describedby','loading-reason');else headButton.removeAttribute('aria-describedby');
 const input=document.querySelector('#scene-search');input.value=query;input.addEventListener('input',e=>{query=e.target.value;cards();});
}
document.querySelector('#app').innerHTML=`<header class="site-header"><a class="brand" href="${location.pathname.split('/').pop()}" aria-label="Dream AI Studio 홈"><span class="brand-mark" aria-hidden="true">✦</span>DREAM AI STUDIO</a><nav class="primary-nav" aria-label="주 메뉴"><a href="#main" aria-current="page">홈</a><a href="#inspiration">영감 보드</a><a href="#projects">내 프로젝트</a></nav><div class="header-actions"><button class="btn primary" data-action="new">프로젝트 시작 ↗</button><span class="avatar" aria-label="예시 프로필">JD</span></div></header><div class="design-bar"><span>${titles[theme]} · 디자인 시안 · AI 정지 이미지 / 실제 재생·저장 없음</span><label for="state">상태 보기 <select id="state">${Object.entries(states).map(([k,v])=>`<option value="${k}" ${state===k?'selected':''}>${v}</option>`).join('')}</select></label><a href="index.html">3안 비교 ↗</a></div><main id="main" tabindex="-1" class="page"><div id="workspace"></div></main>`;
render();
document.querySelector('#state').addEventListener('change',e=>{state=e.target.value;const url=new URL(location.href);url.searchParams.set('state',state);history.replaceState(null,'',url);render();document.querySelector('.header-actions .btn').disabled=state==='loading';});
document.querySelector('.header-actions .btn').disabled=state==='loading';
const modal=document.querySelector('#modal');
function openModal(title,body,trigger){lastTrigger=trigger;modal.innerHTML=`<h2 id="modal-title">${title}</h2>${body}<div class="close-row"><button class="btn" data-action="close" autofocus>닫기</button></div>`;modal.showModal();}
modal.addEventListener('close',()=>{if(lastTrigger?.isConnected)lastTrigger.focus();});
modal.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const items=[...modal.querySelectorAll('button:not(:disabled),input,a[href],select')].filter(x=>x.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
function preview(i,trigger){const s=scenes[i];openModal(s.title,`${image(s.image,'modal-image',s.caption)}<p>${s.caption}</p><div class="note">AI로 생성한 정지 이미지입니다. 이 시안에서는 영상·음성 재생, 제작 요청, 다운로드를 실행하지 않습니다.${i>2?' 원본 이미지의 구도를 달리한 예시입니다.':''}</div>`,trigger);}
function notify(message){const t=document.querySelector('#toast');t.textContent=message;t.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>t.classList.remove('show'),4500);}
document.addEventListener('click',e=>{
 const el=e.target.closest('button,a');if(!el)return;
 if(el.dataset.filter){filter=el.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',b===el));cards();return;}
 if(el.dataset.scene!==undefined){preview(Number(el.dataset.scene),el);return;}
 if(el.matches('a[href^="#"]')){const target=document.querySelector(el.getAttribute('href'));if(target){e.preventDefault();target.focus();target.scrollIntoView({block:'start'});}return;}
 switch(el.dataset.action){
 case 'close':modal.close();break;
 case 'hero':preview(hero,el);break;
 case 'next':case 'prev':hero=(hero+(el.dataset.action==='next'?1:2))%3;document.querySelector('.hero-image').src=`assets/${assets[hero]}`;document.querySelector('#hero-caption').textContent=`0${hero+1} / 03 · ${scenes[hero].title}`;break;
 case 'reset':filter='전체';query='';document.querySelector('#scene-search').value='';document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.filter==='전체'));cards();document.querySelector('#scene-search').focus();break;
 case 'retry':state='normal';document.querySelector('#state').value=state;{const u=new URL(location.href);u.searchParams.set('state',state);history.replaceState(null,'',u);}render();document.querySelector('#projects').focus();notify('목록 복구 화면 예시입니다. 실제 연결 요청은 하지 않았습니다.');break;
 case 'about':openModal('영감 이미지 안내','<p>광고·뮤직·여행 장르의 AI 생성 정지 이미지 3장을 구도별로 배치했습니다. 영상이나 이용 가능한 제작 템플릿을 뜻하지 않습니다.</p><div class="note">현재 제작 흐름 예시는 쇼핑숏츠 샘플입니다. 다른 장르의 제작 기능과는 구분됩니다.</div>',el);break;
 case 'environment':openModal('제작 환경 읽는 법','<p>최근 응답은 워커의 연락 시점을 뜻합니다. 실제 작업의 성공, 프로세스 종료, 영상 완성은 별도로 확인해야 합니다.</p><div class="note">표시된 상태는 디자인 검토용입니다. 실제 워커나 클라우드에 연결하지 않았습니다.</div>',el);break;
 case 'continue':openModal('DESERT MOTION · 작업 예시',`${image(1,'modal-image','주황색 자동차 예시')}<p>쇼핑숏츠 샘플의 수정·조립 단계 예시입니다. 가상 프로젝트이며 실제 저장된 작업은 없습니다.</p>`,el);break;
 case 'new':
  if(state==='guest'){openModal('로그인 안내','<p>계정을 연결하면 나만의 프로젝트를 관리할 수 있습니다. 이 디자인 시안에서는 로그인이나 계정 정보를 요청하지 않습니다.</p>',el);break;}
  if(state==='cloud'){openModal('클라우드 제작 흐름','<p>아이디어 기획 → 장면 구성 → 제작 환경 확인 → 결과 검토</p><div class="note">실제 제작에는 연결된 환경과 작업 상태 확인이 필요합니다. 이 시안에서는 제작을 요청하지 않습니다.</div>',el);break;}
  if(state==='offline'){openModal('연결 후 제작할 수 있어요','<p>오프라인에서는 이미지와 가상 작업을 살펴볼 수 있습니다. 새 제작 요청은 네트워크 연결 뒤에 진행합니다.</p>',el);break;}
  openModal('첫 이야기를 시작해 보세요','<p>사용 가능한 흐름 예시: <strong>쇼핑숏츠 샘플</strong></p><div class="field"><label for="project-name">프로젝트 이름</label><input id="project-name" maxlength="80" placeholder="나의 첫 쇼핑숏츠"></div><button class="btn primary" data-action="plan">기획 흐름 미리보기</button><p class="small">뮤직·여행 제작은 준비 중입니다. 입력한 이름은 저장하거나 전송하지 않습니다.</p>',el);break;
 case 'plan':{const name=document.querySelector('#project-name').value.trim()||'나의 첫 쇼핑숏츠';modal.querySelector('#modal-title').textContent=name;modal.querySelector('.field').outerHTML='<div class="note">상품 아이디어 → 장면 구성 → 제작 준비 → 결과 검토<br>기획 흐름 예시입니다. 실제 프로젝트는 생성되지 않았습니다.</div>';el.remove();break;}
 }
});
