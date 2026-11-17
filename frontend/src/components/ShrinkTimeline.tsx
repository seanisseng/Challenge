import {useRef,useState} from 'react';
import type {CSSProperties} from 'react';
import type {GameMapState,MapStage} from '../lib/gameMap';
import {clockText,shrinkTimeline} from '../lib/shrinkTimeline';

export function ShrinkTimeline({data,stages,now,disabled,onSeek}:{data?:GameMapState;stages:MapStage[];now:number;disabled:boolean;onSeek:(seconds:number)=>Promise<void>}) {
 const [draft,setDraft]=useState<number|null>(null);
 const draftRef=useRef<number|null>(null),committing=useRef(false);
 const running=Boolean(data?.started_at);
 const clockNow=data?.paused_at?Date.parse(data.paused_at):now;
 const elapsed=running?Math.max(0,(clockNow-Date.parse(data!.started_at!))/1000):stages[data?.stage_index??0]?.after_seconds??0;
 const model=shrinkTimeline(stages,elapsed,data?.stage_index??0,running);
 const position=Math.max(0,Math.min(model.duration,draft??elapsed));
 const progress=model.duration?position/model.duration*100:0;
 const alignedMarkers=model.markers.length<=4&&model.markers.every((marker,index)=>index===0||(marker.seconds-model.markers[index-1].seconds)/model.duration>=.2);
 const preview=shrinkTimeline(stages,position,Math.max(0,...model.markers.filter(m=>m.seconds<=position).map(m=>m.index)),running);
 const display=draft===null?model:preview;
 const displayStage=draft===null?(data?.stage_index??0):Math.max(0,...model.markers.filter(marker=>marker.seconds<=position).map(marker=>marker.index));
 const label=!running?'Shrink countdown stopped':display.remaining!==null?`${data?.paused_at?'Paused:':'Next shrink:'} Stage ${(display.nextStage??0)+1} in ${clockText(display.remaining)}`:displayStage>=stages.length-1?'Final area reached':data?.paused_at?'Countdown paused':'No further timed shrinks';
 const commit=async()=>{
  if(draftRef.current===null||committing.current)return;
  const seconds=draftRef.current;committing.current=true;
  try{await onSeek(seconds);}finally{committing.current=false;draftRef.current=null;setDraft(null);}
 };
 const move=(input:HTMLInputElement,clientX:number)=>{
  const rect=input.getBoundingClientRect();
  const seconds=Math.round(Math.max(0,Math.min(1,(clientX-rect.left-12)/Math.max(1,rect.width-24)))*model.duration);
  draftRef.current=seconds;setDraft(seconds);
 };
 return <section className={`shrink-timeline ${!running||data?.paused_at?'shrink-timeline--stopped':display.warning?'shrink-timeline--warning':''}`} aria-label="Shrink countdown">
  <div className="shrink-timeline-heading"><strong>{label}</strong><span>{clockText(position)} / {clockText(model.duration)}</span></div>
  <div className="shrink-remaining" role="progressbar" aria-label="Elapsed shrink schedule" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-valuetext={`${clockText(position)} of ${clockText(model.duration)} elapsed`}>
   <span style={{width:`${progress}%`}}/>
   <div className="shrink-ticks" aria-hidden="true">{model.markers.map(marker=><i key={marker.index} style={{left:`${model.duration?marker.seconds/model.duration*100:0}%`}}/>)}</div>
  </div>
  <div className="shrink-scrubber" style={{'--timeline-position':`calc(12px + ${progress}% - ${24*progress/100}px)`} as CSSProperties}>
   {draft!==null?<output className="shrink-time-tooltip">{clockText(position)}</output>:null}
   <input type="range" role="slider" min={0} max={model.duration||1} step={1} value={Math.floor(position)}
    aria-label="Shrink countdown position" aria-valuemin={0} aria-valuemax={model.duration||1} aria-valuenow={Math.floor(position)}
    aria-valuetext={`${clockText(position)} elapsed. ${draft!==null&&preview.remaining!==null?`Stage ${(preview.nextStage??0)+1} in ${clockText(preview.remaining)}`:label}`}
    disabled={disabled||!running||!model.duration}
    onChange={event=>{draftRef.current=Number(event.target.value);setDraft(draftRef.current);}}
    onPointerDown={event=>{event.preventDefault();event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);move(event.currentTarget,event.clientX);}}
    onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))move(event.currentTarget,event.clientX);}}
    onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId)){move(event.currentTarget,event.clientX);event.currentTarget.releasePointerCapture(event.pointerId);void commit();}}}
    onPointerCancel={()=>{draftRef.current=null;setDraft(null);}}
    onKeyUp={event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))void commit();}}
    onBlur={()=>void commit()}/>
  </div>
  <ol className={`shrink-markers ${alignedMarkers?'shrink-markers--aligned':''}`}>{model.markers.map(marker=><li key={marker.index} style={{'--marker-position':`${model.duration?marker.seconds/model.duration*100:0}%`} as CSSProperties}><span/><b>{marker.seconds/60} min</b><small>{marker.index===0?'Start':`Stage ${marker.index+1}`}</small>
   <button type="button" className="btn-secondary shrink-stage-jump" disabled={disabled||!running||!model.duration}
    aria-label={marker.index===0?'Restore starting area at 0 minutes':`Shrink to stage ${marker.index+1} at ${marker.seconds/60} minutes`}
    title={`Set zone radius to ${stages[marker.index].radius_m/1000} km and timer to ${marker.seconds/60} minutes`}
    onClick={()=>{if(committing.current)return;draftRef.current=marker.seconds;setDraft(marker.seconds);void commit();}}>{marker.index===0?'Restore':'Shrink'}</button>
  </li>)}</ol>
  <p className="shrink-timeline-help">{!model.duration?'Save shrink times to enable the timeline.':!running?'Start the countdown to adjust time.':'Drag to change time and zone. Arrows: ±1 sec · Home / End: start / finish.'}</p>
 </section>;
}
