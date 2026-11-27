import { lazy,Suspense,useEffect,useMemo,useState } from 'react';
import type { GameMapState,MapPoint,MapStage } from '../lib/gameMap';
import { configureMap,startMapTimer,pauseMapTimer,resumeMapTimer,resetMapTimer,shrinkMapArea,seekMapTimer,setTeamLocationVisibility,ApiError } from '../lib/api';
import {MapPin,Trash2,Plus,RotateCcw,Save,Minimize2,Play,Pause} from 'lucide-react';
import {ShrinkTimeline} from './ShrinkTimeline';
import {aggregateTeamLocations} from '../lib/gameMap';
import {clockText,shrinkTimeline} from '../lib/shrinkTimeline';
import '../game-map.css';
const MapCanvas=lazy(()=>import('./MapCanvas'));
export function HostMap({sessionId,status,data,onReload,teamNames}:{sessionId:string;status:string;data?:GameMapState;onReload:()=>Promise<void>;teamNames:Record<string,string>}) {
 const [stages,setStages]=useState<MapStage[]>(data?.plan?.stages??[]);
 const [finish,setFinish]=useState<MapPoint|null>(data?.finish??null);
 const [selection,setSelection]=useState<number|'finish'>('finish');
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const offset=useMemo(()=>data?Date.parse(data.server_time)-Date.now():0,[data?.server_time]);
 const serverNow=Math.max(now,Date.now())+offset;
 const clockNow=data?.paused_at?Date.parse(data.paused_at):serverNow;
 const clock=shrinkTimeline(data?.plan?.stages??[],data?.started_at?Math.max(0,(clockNow-Date.parse(data.started_at))/1000):0,data?.stage_index??0,Boolean(data?.started_at)&&status==='active');
 const finalZone=Boolean(data?.configured&&(data.stage_index>=data.stage_count-1));
 const locations=(data?.locations??[]).filter(point=>now+offset-Date.parse(point.updated_at)<120000);
 const trackers=aggregateTeamLocations(locations,serverNow);
 const signature=JSON.stringify([data?.plan,data?.finish]);
 useEffect(()=>{setStages(data?.plan?.stages??[]);setFinish(data?.finish??null);},[signature]);
 const locked=Boolean(data?.started_at||(data?.stage_index??0)>0);
 const dirty=JSON.stringify([stages,finish])!==JSON.stringify([data?.plan?.stages??[],data?.finish??null]);
 const change=(index:number,patch:Partial<MapStage>)=>setStages(rows=>rows.map((row,i)=>i===index?{...row,...patch}:row));
 const choose=(point:MapPoint)=>{if(locked)return;selection==='finish'?setFinish(point):change(selection,point);};
 const run=async(action:()=>Promise<unknown>)=>{setBusy(true);setError(null);try{await action();await onReload();}catch(error){setError(error instanceof ApiError?error.message:'Could not update the map.');}finally{setBusy(false);}};
 const selected=typeof selection==='number'?stages[selection]:stages[0];
 const preview:GameMapState={configured:Boolean(stages.length),initial_area:stages[0]??null,area:selected??stages[0]??null,stage_index:0,stage_count:stages.length,locations,started_at:null,next_shrink_at:null,server_time:data?.server_time??new Date().toISOString()};
 return <section className="map-host"><div className="map-host-heading"><div><p className="race-eyebrow">RACE CONTROL / PLAYING AREA</p><h2>Narrow the search area.</h2>
  <p>The final location is within the playing area. Its exact position is visible to the host only.</p></div>
  <div className={`map-main-timer ${data?.paused_at?'map-main-timer--paused':clock.warning?'map-main-timer--warning':''}`} role="group" aria-label="Next shrink countdown">
   <span>{clock.remaining!==null?`${data?.paused_at?'Paused':'Next shrink'} · Stage ${(clock.nextStage??0)+1}`:finalZone?'Final zone':!data?.started_at||status!=='active'?'Countdown stopped':data?.paused_at?'Countdown paused':'Manual shrink'}</span>
   <strong>{clock.remaining!==null?clockText(clock.remaining):finalZone?'00:00':'--:--'}</strong>
  </div></div>
  <div className="map-status-strip"><span>{data?.configured?`Area ${data.stage_index+1} of ${data.stage_count}`:'Playing area has not been saved'}</span></div>
  <Suspense fallback={<p role="status">Loading map...</p>}><MapCanvas data={locked&&data?{...data,locations}:preview} finish={finish} preview={stages.slice(locked?(data?.stage_index??0)+1:1)} onChoose={choose} teamNames={teamNames}/></Suspense>
  <div className="map-legend"><span className="map-legend-initial">Starting area</span><span className="map-legend-current">Current / selected area</span><span className="map-legend-future">Upcoming shrink zones</span><span>Red dot: destination, host only</span></div>
  <section className="map-team-visibility" aria-labelledby="team-visibility-title"><h3 id="team-visibility-title">Team location visibility</h3>
   <p>Choose which teams appear on other players’ maps. The host and each team can still see their own shared locations. This does not announce arrivals or end the game.</p>
   <ul>{Object.entries(teamNames).map(([teamId,name])=>{
    const visible=!(data?.hidden_team_ids??[]).includes(teamId);
    return <li key={teamId}><label><input type="checkbox" checked={visible} disabled={busy} aria-label={`Show ${name} to other players`} onChange={event=>void run(()=>setTeamLocationVisibility(sessionId,teamId,event.target.checked))}/><strong>{name}</strong><span>{visible?'Shown to other players':'Hidden from other players'}</span></label></li>;
   })}</ul>
  </section>
  <div className="map-plan-editor"><div className="map-plan-heading"><h3>Area and shrink schedule</h3>
   <div className="map-plan-actions">
    {!data?.started_at?<button type="button" className="btn-primary" disabled={busy||dirty||!data?.configured||status!=='active'} onClick={()=>void run(()=>startMapTimer(sessionId))}><Play size={16} aria-hidden="true"/>Start shrink countdown</button>:null}
    {data?.started_at?<button type="button" className="btn-secondary" disabled={busy||dirty||status!=='active'||(finalZone&&!data.paused_at)} onClick={()=>void run(()=>data.paused_at?resumeMapTimer(sessionId):pauseMapTimer(sessionId))}>{data.paused_at?<Play size={16} aria-hidden="true"/>:<Pause size={16} aria-hidden="true"/>}{data.paused_at?'Resume shrink timer':'Pause shrink timer'}</button>:null}
    <button type="button" className="btn-primary" disabled={busy||dirty||!data?.configured||!['lobby','active'].includes(status)||data.stage_index>=data.stage_count-1} onClick={()=>void run(()=>shrinkMapArea(sessionId))}><Minimize2 size={16} aria-hidden="true"/>Shrink area</button>
    {locked?<button type="button" className="btn-secondary" disabled={busy} onClick={()=>{if(window.confirm('Reset the shrink timer and restore the starting area?'))void run(()=>resetMapTimer(sessionId));}}><RotateCcw size={16} aria-hidden="true"/>Reset shrink timer</button>:null}
   </div>
  </div>
   <ShrinkTimeline data={data} stages={stages} now={serverNow} disabled={busy||dirty||status!=='active'} onSeek={seconds=>run(()=>seekMapTimer(sessionId,seconds))}/>
   {error?<p role="alert">{error}</p>:null}
   <div className="map-settings-heading"><div><h4>Zone settings</h4><p>Minutes from countdown start. Leave blank for manual stages.</p></div>
   <div className="map-plan-actions"><button type="button" className="btn-secondary" disabled={locked||busy||!stages.length||stages.length>=12} onClick={()=>setStages(rows=>[...rows,{...rows[rows.length-1],radius_m:Math.max(100,rows[rows.length-1].radius_m*.6),after_seconds:null}])}><Plus size={16} aria-hidden="true"/>Add shrink stage</button>
    <button type="button" className="btn-primary" disabled={locked||busy||!finish||!stages.length} onClick={()=>void run(()=>configureMap(sessionId,{finish:finish!,stages}))}><Save size={16} aria-hidden="true"/>{busy?'Saving...':'Save playing area'}</button></div>
   </div>
   {dirty?<p className="map-save-hint" role="status">Save changes to enable countdown controls.</p>:null}
   <div className="map-destination-settings">
   <button type="button" className="btn-secondary" disabled={locked} aria-pressed={selection==='finish'} onClick={()=>setSelection('finish')}><MapPin size={16} aria-hidden="true"/>Pick destination on map</button>

   <details><summary>Destination coordinates</summary><div className="map-form-grid">
    <label>Destination latitude<input className="field" type="number" step="any" disabled={locked} value={finish?.lat??''} onChange={e=>setFinish({lat:Number(e.target.value),lng:finish?.lng??103.85})}/></label>
    <label>Destination longitude<input className="field" type="number" step="any" disabled={locked} value={finish?.lng??''} onChange={e=>setFinish({lat:finish?.lat??1.32,lng:Number(e.target.value)})}/></label>
   </div></details>
   </div>
   <p className="map-selection-hint">{locked?'Reset the timer to edit zones.':`Map selection: ${selection==='finish'?'destination':`stage ${selection+1} center`}. Click the map or enter coordinates.`}</p>
   <details className="map-zone-rules"><summary>Zone rules</summary><p>Each smaller zone fits inside the previous one. The final location is within the playing area. The start only needs to be inside the first zone.</p></details>
   <div className="map-stage-grid">
   {stages.map((stage,index)=><fieldset className="map-stage-row" key={index} disabled={locked||busy}><legend><span className="map-stage-badge">{index+1}</span>{index===0?'Starting area':`Shrink stage ${index+1}`}</legend>
    <div className="map-form-grid"><label>After (minutes)<span className="map-input-unit"><input className="field" aria-label={`Stage ${index+1} after (minutes)`} type="number" min={index===0?0:1} max={1440} placeholder="Manual only" disabled={index===0} value={stage.after_seconds===null?'':stage.after_seconds/60} onChange={e=>change(index,{after_seconds:e.target.value===''?null:Math.round(Number(e.target.value)*60)})}/><span aria-hidden="true">min</span></span></label>
     <label>Radius (km)<span className="map-input-unit"><input className="field" aria-label={`Stage ${index+1} radius (km)`} type="number" min={.1} max={100} step={.1} value={stage.radius_m/1000} onChange={e=>change(index,{radius_m:Number(e.target.value)*1000})}/><span aria-hidden="true">km</span></span></label></div>
    <div className="map-plan-actions"><button type="button" className="btn-secondary" aria-pressed={selection===index} onClick={()=>setSelection(index)}><MapPin size={16} aria-hidden="true"/>Pick stage {index+1} center on map</button>{index>0?<button type="button" className="btn-secondary" onClick={()=>{setStages(rows=>rows.filter((_,i)=>i!==index));setSelection('finish');}}><Trash2 size={16} aria-hidden="true"/>Remove stage {index+1}</button>:null}</div>
    <details><summary>Center coordinates</summary><div className="map-form-grid"><label>Latitude<input aria-label={`Stage ${index+1} latitude`} className="field" type="number" step="any" value={stage.lat} onChange={e=>change(index,{lat:Number(e.target.value)})}/></label><label>Longitude<input aria-label={`Stage ${index+1} longitude`} className="field" type="number" step="any" value={stage.lng} onChange={e=>change(index,{lng:Number(e.target.value)})}/></label></div></details>
   </fieldset>)}
   </div>
   {status!=='active'?<p>Start the game before starting the shrink countdown.</p>:null}
  </div>
  <section className="map-roster"><h3>Shared locations ({trackers.length} team{trackers.length===1?'':'s'})</h3><ul>{trackers.map(point=><li key={point.team_id}><strong>{teamNames[point.team_id]??point.team_name}</strong><span>{point.device_count} device{point.device_count===1?'':'s'} &middot; Estimated area {Math.round(point.accuracy_m)} m</span></li>)}</ul></section>
 </section>;
}
