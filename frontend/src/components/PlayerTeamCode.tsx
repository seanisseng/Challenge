import {useEffect,useState} from 'react';
import {Check,Copy} from 'lucide-react';

export function PlayerTeamCode({code}:{code?:string|null}){
 const [notice,setNotice]=useState<'idle'|'copied'|'unavailable'>('idle');
 useEffect(()=>{
  if(notice==='idle')return;
  const timer=window.setTimeout(()=>setNotice('idle'),4_000);
  return()=>window.clearTimeout(timer);
 },[notice]);
 if(!code)return null;
 const copy=async()=>{
  try{await navigator.clipboard.writeText(code);setNotice('copied');}
  catch{setNotice('unavailable');}
 };
 return <div className="player-team-code-bar"><div className="player-team-code-inner">
  <span>TEAM CODE</span>
  <button type="button" onClick={()=>void copy()} aria-label={`Copy team code ${code}`}>
   <strong>{code}</strong>{notice==='copied'?<Check size={16} aria-hidden="true"/>:<Copy size={16} aria-hidden="true"/>}
  </button>
  <p role="status" aria-live="polite">{notice==='copied'?'Team code copied':notice==='unavailable'?'Select code to copy':'Tap to copy'}</p>
 </div></div>;
}
