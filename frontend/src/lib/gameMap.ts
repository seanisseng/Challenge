export interface MapPoint { lat:number; lng:number }
export interface MapStage extends MapPoint { radius_m:number; after_seconds:number|null }
export interface DeviceLocation extends MapPoint {team_id:string;team_name:string;device_id:string;accuracy_m:number;updated_at:string;revision:number}
export interface TeamLocation extends MapPoint {team_id:string;team_name:string;accuracy_m:number;updated_at:string;device_count:number;device_ids:string[]}

/** Accuracy-weighted spherical center; radius includes device spread, not just GPS precision. */
export function aggregateTeamLocations(locations:DeviceLocation[],now?:number):TeamLocation[] {
  const devices=new Map<string,DeviceLocation>();
  for(const fix of locations) {
    if(now!==undefined&&now-Date.parse(fix.updated_at)>=120000)continue;
    if(!Number.isFinite(fix.lat)||!Number.isFinite(fix.lng)||!Number.isFinite(fix.accuracy_m))continue;
    const id=fix.team_id+':'+fix.device_id;
    if(!devices.has(id)||devices.get(id)!.revision<fix.revision)devices.set(id,fix);
  }
  const groups=new Map<string,DeviceLocation[]>();
  for(const fix of devices.values())groups.set(fix.team_id,[...(groups.get(fix.team_id)??[]),fix]);
  return [...groups].map(([team_id,fixes])=>{
    let x=0,y=0,z=0;
    for(const fix of fixes){const lat=fix.lat*Math.PI/180,lng=fix.lng*Math.PI/180,w=1/Math.max(10,fix.accuracy_m)**2;x+=w*Math.cos(lat)*Math.cos(lng);y+=w*Math.cos(lat)*Math.sin(lng);z+=w*Math.sin(lat);}
    const point=fixes.length===1?{lat:fixes[0].lat,lng:fixes[0].lng}:{lat:Math.atan2(z,Math.hypot(x,y))*180/Math.PI,lng:Math.atan2(y,x)*180/Math.PI};
    const latest=fixes.reduce((a,b)=>Date.parse(a.updated_at)>Date.parse(b.updated_at)?a:b);
    return {...point,team_id,team_name:latest.team_name,device_count:fixes.length,device_ids:fixes.map(f=>f.device_id).sort(),updated_at:latest.updated_at,
      accuracy_m:Math.max(...fixes.map(fix=>mapDistance(point,fix)+fix.accuracy_m))};
  });
}
export interface GameMapState {
  can_track_teams?:boolean;
  configured:boolean; initial_area:MapStage|null; area:MapStage|null;
  stage_index:number;stage_count:number;started_at:string|null;next_shrink_at:string|null;
  paused_at?:string|null;
  server_time:string;locations:DeviceLocation[];
  /** Host-only fields; excluded by the player snapshot builder. */
  plan?:{stages:MapStage[]}|null;finish?:MapPoint|null;
  revisions?:Record<string,number>;
}
export type MapEvent = {session_id:string} & ({kind:'map_access';can_track_teams:boolean}|{kind:'location';location:DeviceLocation}|{kind:'location_removed';team_id:string;device_id:string;revision:number});
const key=(team:string,device:string)=>team+':'+device;
export function applyMapEvent(map:GameMapState|undefined,event:MapEvent,viewerTeamId?:string):GameMapState|undefined {
  if(!map) return map;
  if(event.kind==='map_access')return {...map,can_track_teams:event.can_track_teams,locations:event.can_track_teams?map.locations:map.locations.filter(point=>point.team_id===viewerTeamId)};
  const point=event.kind==='location'?event.location:event;
  if(event.kind==='location'&&map.can_track_teams===false&&point.team_id!==viewerTeamId)return map;
  const id=key(point.team_id,point.device_id);
  const versions={...Object.fromEntries(map.locations.map(p=>[key(p.team_id,p.device_id),p.revision])),...map.revisions};
  if((versions[id]??-1)>=point.revision) return map;
  versions[id]=point.revision;
  const locations=map.locations.filter(p=>key(p.team_id,p.device_id)!==id);
  if(event.kind==='location') locations.push(event.location);
  return {...map,locations,revisions:versions};
}
export function mergeMapSnapshot(previous:GameMapState|undefined,next:GameMapState|undefined):GameMapState|undefined {
  if(!next || !previous) return next;
  if(next.can_track_teams===false)return next;
  const locations=next.locations.filter(p=>{const known=previous.revisions?.[key(p.team_id,p.device_id)]??-1;return p.revision>known || (p.revision===known && previous.locations.some(old=>old.team_id===p.team_id&&old.device_id===p.device_id&&old.revision===known));});
  for(const p of previous.locations) {
    const incoming=next.locations.find(n=>key(n.team_id,n.device_id)===key(p.team_id,p.device_id));
    if((incoming && incoming.revision<p.revision)||(!incoming && Date.parse(p.updated_at)>Date.parse(next.server_time))) {
      const index=locations.findIndex(n=>key(n.team_id,n.device_id)===key(p.team_id,p.device_id));
      if(index>=0) locations.splice(index,1);
      locations.push(p);
    }
  }
  return {...next,locations,revisions:previous.revisions};
}
export function mapDistance(a:MapPoint,b:MapPoint):number {
  const rad=(n:number)=>n*Math.PI/180;
  const dlat=rad(b.lat-a.lat),dlng=rad(b.lng-a.lng);
  return 6371000*2*Math.asin(Math.sqrt(Math.min(1,Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlng/2)**2)));
}
