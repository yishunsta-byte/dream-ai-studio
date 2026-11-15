export function parseByteRange(range:string|null,size:number):{ok:true;start:number;end:number;partial:boolean}|{ok:false} {
 if(!range)return {ok:true,start:0,end:Math.max(0,size-1),partial:false};
 const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||(!match[1]&&!match[2])||size<=0)return {ok:false};
 let start:number,end:number;
 if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return {ok:false};start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return {ok:false};
 return {ok:true,start,end,partial:true};
}
