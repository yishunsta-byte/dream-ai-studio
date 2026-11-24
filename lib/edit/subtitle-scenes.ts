export type SceneInterval = {startFrame:number; endFrame:number; label:string; description:string};

export function sceneIntervals(video:readonly {sceneId:string;durationFrames:number}[], titles:ReadonlyMap<string,string>):SceneInterval[] {
  let endFrame=0;
  return video.map((clip,index)=>{
    const startFrame=endFrame;
    endFrame+=clip.durationFrames;
    const label=`장면 ${index+1}`;
    const title=titles.get(clip.sceneId)?.trim();
    return {startFrame,endFrame,label,description:title && title!==label?`${label} · ${title}`:label};
  });
}

export function subtitleSceneLabel(scenes:readonly SceneInterval[], timing:{startFrame:number;endFrame:number}) {
  const covered=scenes.filter(scene=>scene.startFrame<timing.endFrame && timing.startFrame<scene.endFrame);
  const first=covered[0],last=covered.at(-1);
  if(!first||!last)return "장면 밖";
  const range=first===last?first.description:`${first.description} ~ ${last.description}`;
  return timing.endFrame>last.endFrame?`${range} ~ 장면 밖`:range;
}
