export function shrinkTimeline(stages:{after_seconds:number|null}[],elapsed:number,stageIndex:number,running:boolean) {
 const markers=stages.flatMap((stage,index)=>stage.after_seconds===null?[]:[{seconds:stage.after_seconds,index}]);
 const duration=Math.max(0,...markers.map(marker=>marker.seconds));
 const next=markers.find(marker=>marker.index>stageIndex&&marker.seconds>elapsed);
 const previous=markers.filter(marker=>marker.seconds<=elapsed).slice(-1)[0]?.seconds??0;
 const remaining=running&&next?Math.max(0,Math.ceil(next.seconds-elapsed)):null;
 return {markers,duration,nextStage:next?.index??null,remaining,
  remainingPercent:remaining!==null&&next?Math.min(100,100*remaining/Math.max(1,next.seconds-previous)):0,
  warning:remaining!==null&&remaining<=60};
}
export const clockText=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
