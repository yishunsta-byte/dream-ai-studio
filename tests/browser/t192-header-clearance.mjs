/* global document, innerHeight, innerWidth, getComputedStyle, requestAnimationFrame */
// Run with an Ego Page showing the isolated Next settings page. No API or auth changes here.
export async function headerAnchorClearance(page,{measured=true}={}) {
 if(measured)await page.waitForFunction(()=>{
  const header=document.querySelector('header'),height=parseFloat(getComputedStyle(header.parentElement).getPropertyValue('--studio-header-height'));
  return Math.abs(height-header.getBoundingClientRect().height)<0.1;
 });
 await page.focus('nav[aria-label="개인 관리 안에서 이동"] a[href="#backup"]');
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.activeElement.id==='backup');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 return page.evaluate(()=>{
  const header=document.querySelector('header'),bar=header.getBoundingClientRect(),target=document.querySelector('#backup'),heading=document.querySelector('#backup-title'),title=document.querySelector('header strong'),range=document.createRange();range.selectNodeContents(title);
  const occupiedBottom=Math.max(bar.bottom,...[...header.querySelectorAll('[role="alert"]')].map(el=>el.getBoundingClientRect().bottom));
  const rect=heading.getBoundingClientRect(),logout=header.querySelector('button[aria-label^="로그아웃"]');
  return {width:innerWidth,headerHeight:bar.height,headerBottom:bar.bottom,occupiedBottom,targetTop:target.getBoundingClientRect().top,headingTop:rect.top,headingBottom:rect.bottom,headingFullyVisible:rect.top>=occupiedBottom&&rect.bottom<=innerHeight,focusId:document.activeElement.id,scrollMarginTop:parseFloat(getComputedStyle(target).scrollMarginTop),measuredHeight:parseFloat(getComputedStyle(header.parentElement).getPropertyValue('--studio-header-height'))||null,crumbWidth:title.parentElement.getBoundingClientRect().width,titleWidth:range.getBoundingClientRect().width,logoutHeight:logout?.getBoundingClientRect().height??null,overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth)};
 });
}
