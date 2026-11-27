import { lazy,Suspense,useEffect,useMemo,useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { mapDistance } from '../lib/gameMap';
import type { GameMapState } from '../lib/gameMap';
import type { useLocationSharing } from '../lib/useLocationSharing';
const MapCanvas=lazy(()=>import('./MapCanvas'));

export function PlayingArea({data,status,sharing,teamId,teamNames}:{
 data?:GameMapState;status:string;sharing:ReturnType<typeof useLocationSharing>;teamId:string;teamNames:Record<string,string>;
}) {
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const offset=useMemo(()=>data?Date.parse(data.server_time)-Date.now():0,[data?.server_time]);
 const serverNow=now+offset;
 const locations=(data?.locations??[]).filter(p=>serverNow-Date.parse(p.updated_at)<120000);
 const own=locations.find(p=>p.team_id===teamId&&p.device_id===sharing.deviceId);
 const canTrack=sharing.status==='sharing'&&Boolean(own)&&data?.can_track_teams!==false;
 const visibleLocations=canTrack?locations:locations.filter(point=>point.team_id===teamId);
 const outside=own&&data?.area&&mapDistance(own,data.area)>data.area.radius_m;
 return <section className="playing-area" aria-label="Playing area">
  <div className="map-location-controls">
   <button type="button" className="btn-primary" aria-pressed={sharing.status!=='off'} disabled={sharing.status==='off'&&(!data?.configured||status!=='active')}
    onClick={()=>sharing.status==='off'?sharing.start():void sharing.stop()}>
    <LocateFixed size={18} aria-hidden="true"/>{sharing.status==='off'?'Share my location':sharing.status==='locating'?'Stop locating':'Stop sharing'}
   </button>
   {status!=='active'?<p>Location sharing is available while the game is active.</p>:!data?.configured?<p>Waiting for the host to set the playing area.</p>:null}
   {sharing.error?<p role="alert">{sharing.error}</p>:null}
  </div>
  {outside?<p className="map-outside" role="status">You are outside the current playing area. The final location is within the playing area.</p>:null}
  <Suspense fallback={<p role="status">Loading map...</p>}><MapCanvas data={data?{...data,locations:visibleLocations}:undefined} teamNames={teamNames}/></Suspense>
 </section>;
}
