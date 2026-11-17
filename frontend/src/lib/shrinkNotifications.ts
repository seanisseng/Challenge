type Snapshot={session:{id:string;status:string};team:{id:string};map?:{area:{radius_m:number}|null;stage_index:number;server_time:string}};
export interface ShrinkNotice {stage:number;radius_m:number}
export function createShrinkCursor(snapshot:Snapshot) {
 return {sessionId:snapshot.session.id,teamId:snapshot.team.id,active:snapshot.session.status==='active',
  radius:snapshot.map?.area?.radius_m??null,time:snapshot.map?.server_time?Date.parse(snapshot.map.server_time):0};
}
export function readShrinkUpdate(previous:ReturnType<typeof createShrinkCursor>,snapshot:Snapshot):{cursor:ReturnType<typeof createShrinkCursor>;notice:ShrinkNotice|null} {
 const cursor=createShrinkCursor(snapshot);
 if(previous.sessionId!==cursor.sessionId||previous.teamId!==cursor.teamId)return {cursor,notice:null};
 if(cursor.time<previous.time)return {cursor:previous,notice:null};
 const shrunk=previous.active&&cursor.active&&previous.radius!==null&&cursor.radius!==null&&cursor.radius<previous.radius;
 return {cursor,notice:shrunk?{stage:(snapshot.map?.stage_index??0)+1,radius_m:cursor.radius!}:null};
}
