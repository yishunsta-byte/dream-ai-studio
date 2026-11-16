// T-115 시안 공통 동작: 화면 전환(#home/#project/#render), 서랍 메뉴. 실제 앱 동작 아님.
(function(){
  var screens=["home","project","render"];
  function show(){
    var h=(location.hash||"#home").slice(1);if(screens.indexOf(h)<0)h="home";
    document.querySelectorAll("[data-screen]").forEach(function(s){s.classList.toggle("on",s.dataset.screen===h);});
    document.querySelectorAll("[data-go]").forEach(function(a){
      var cur=a.dataset.go===h;
      if(a.closest(".proto-bar"))a.setAttribute("aria-current",cur?"true":"false");
      else if(cur)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");
    });
    var crumb=document.getElementById("crumb"),on=document.querySelector("[data-screen].on h1");if(crumb&&on)crumb.textContent=on.textContent;
    var drawer=document.querySelector("[data-drawer]");if(drawer)setDrawer(false);
    var main=document.getElementById("main");if(main&&document.readyState==="complete")main.focus({preventScroll:false});
  }
  function setDrawer(open){
    var d=document.querySelector("[data-drawer]"),b=document.querySelector("[data-drawer-btn]");if(!d||!b)return;
    d.classList.toggle("open",open);b.setAttribute("aria-expanded",open?"true":"false");
    var bg=document.querySelector("[data-drawer-bg]");if(bg)bg.hidden=!open;
    if(open){var f=d.querySelector("a,button");if(f)f.focus();}
  }
  document.addEventListener("click",function(e){
    var b=e.target.closest("[data-drawer-btn]");if(b){setDrawer(b.getAttribute("aria-expanded")!=="true");return;}
    if(e.target.closest("[data-drawer-bg]")){setDrawer(false);var t=document.querySelector("[data-drawer-btn]");if(t)t.focus();}
    var d=e.target.closest("[data-demo]");if(d){e.preventDefault();var live=document.getElementById("live");if(live)live.textContent="시안이라 실제로 동작하지 않아요: "+d.dataset.demo;}
  });
  document.addEventListener("keydown",function(e){if(e.key==="Escape"){var b=document.querySelector("[data-drawer-btn][aria-expanded=true]");if(b){setDrawer(false);b.focus();}}});
  window.addEventListener("hashchange",show);
  show();
})();
