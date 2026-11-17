import { lazy,Suspense,useEffect,useMemo,useState } from 'react';
import { MapPin,LocateFixed } from 'lucide-react';
import { mapDistance,aggregateTeamLocations } from '../lib/gameMap';
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
 const trackers=aggregateTeamLocations(visibleLocations,serverNow);
 const outside=own&&data?.area&&mapDistance(own,data.area)>data.area.radius_m;
 return <section className="playing-area"><div className="map-heading"><MapPin aria-hidden="true"/><div><p className="race-eyebrow">RACE CONTROL / THE PLAYING FIELD</p><h2>Playing area</h2></div></div>
  <div className="map-status-strip"><span>{data?.configured?`Area ${(data.stage_index??0)+1} of ${data.stage_count}`:'Waiting for the host to set the area'}</span></div>
  {outside?<p className="map-outside" role="status">You are outside the current playing area. The final location is within the playing area.</p>:null}
  <Suspense fallback={<p role="status">Loading map...</p>}><MapCanvas data={data?{...data,locations:visibleLocations}:undefined} teamNames={teamNames}/></Suspense>
  <div className="map-legend"><span className="map-legend-initial">Starting area</span><span className="map-legend-current">Current area</span><span>The final location is within the playing area.</span></div>
  <section className="map-sharing"><h3><LocateFixed size={18} aria-hidden="true"/>Your device location</h3>
   <p>Share from this device to see your position and other teams inside the game radius. Your team’s devices combine into one tracker. Stale fixes disappear within two minutes.</p>
   <button type="button" className="btn-primary" disabled={!data?.configured||status!=='active'} onClick={()=>sharing.status==='off'?sharing.start():void sharing.stop()}>
    {sharing.status==='off'?'Share my location':sharing.status==='locating'?'Stop locating':'Stop sharing'}</button>
   {status!=='active'?<p>Location sharing is available while the game is active.</p>:null}
   {sharing.error?<p role="alert">{sharing.error}</p>:null}
  </section>
  <section className="map-roster"><h3>Shared team locations <span>({trackers.length} team{trackers.length===1?'':'s'})</span></h3>
   {!canTrack?<p>Share your location to see other teams. The game radius and your own team remain visible.</p>:null}
   {!locations.length?<p>No recent shared locations yet. Each device can choose Share my location.</p>:<ul>{trackers.map(point=><li key={point.team_id}><strong>{teamNames[point.team_id]??point.team_name}{point.team_id===teamId&&point.device_ids.includes(sharing.deviceId)?point.device_count===1?' (your device)':' (includes your device)':''}</strong><span>{point.device_count} device{point.device_count===1?'':'s'} &middot; Estimated area {Math.round(point.accuracy_m)} m &middot; {Math.max(0,Math.floor((serverNow-Date.parse(point.updated_at))/1000))}s ago</span></li>)}</ul>}
  </section>
  <a className="map-report" href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Report a map issue</a>
 </section>;
}
