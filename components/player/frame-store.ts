"use client";
// The Player's current frame for the timeline row (P2-3b): the Player writes, the row reads with
// useSyncExternalStore, so the editor is not drawn again on every frame while playing.
export type FrameStore={get:()=>number;set:(frame:number)=>void;subscribe:(listener:()=>void)=>()=>void};
export function createFrameStore():FrameStore{
  let frame=0;const listeners=new Set<()=>void>();
  return {get:()=>frame,set:next=>{if(next===frame)return;frame=next;for(const listener of listeners)listener();},subscribe:listener=>{listeners.add(listener);return ()=>{listeners.delete(listener);};}};
}
