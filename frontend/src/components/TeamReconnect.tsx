import {useEffect,useState} from 'react';
import {ArrowRight,Compass,LoaderCircle,RefreshCw,ShieldCheck,Ticket,WifiOff} from 'lucide-react';
import '../team-reconnect.css';

export function TeamReconnect({failed,onRetry,onUseCode,onAdmin}:{
 failed:boolean;onRetry:()=>void;onUseCode:()=>void;onAdmin:()=>void;
}){
 const [slow,setSlow]=useState(false);
 useEffect(()=>{
  if(failed)return;
  const timer=window.setTimeout(()=>setSlow(true),8_000);
  return()=>window.clearTimeout(timer);
 },[failed]);

 return <main className="team-reconnect">
  <div className="reconnect-shell">
   <div className="reconnect-brand"><Compass size={20} aria-hidden="true"/><span>SCAVENGER HUNT</span></div>
   <section className="reconnect-ticket" aria-labelledby="reconnect-title">
    <header className="reconnect-hero">
     <span className="reconnect-eyebrow">BACK TO THE HUNT</span>
     <div className="reconnect-art" aria-hidden="true"><Ticket size={44}/><span className="reconnect-art-mark"><ArrowRight size={20}/></span></div>
     <h1 id="reconnect-title">{failed?'Reconnect to your team':'Rejoining your team'}</h1>
     <p>Your next move is waiting. Let’s get you back to the hunt.</p>
    </header>
    <div className="reconnect-body">
     <div className="reconnect-pass"><ShieldCheck size={21} aria-hidden="true"/><div><strong>Saved team pass</strong><span>Ready on this device</span></div><span className="reconnect-pass-tag">RETURNING PLAYER</span></div>
     <div className={`reconnect-status${failed?' reconnect-status--failed':''}`}>
      {failed?<WifiOff size={24} aria-hidden="true"/>:<LoaderCircle size={24} className="reconnect-spinner" aria-hidden="true"/>}
      <div role={failed?'alert':'status'} aria-live="polite" aria-atomic="true">
       <strong>{failed?'We couldn’t reconnect.':slow?'Taking a little longer than usual.':'Connecting to your game…'}</strong>
       <p>{failed?'Your saved login and drafts are still on this device. Check your connection, then try again.':slow?'We’re still trying. Check your connection; a retry option will appear shortly.':'Loading your team’s latest board, clues and submissions.'}</p>
      </div>
     </div>
     {!failed?<div className="reconnect-track" aria-hidden="true"><span/></div>:null}
     <div className="reconnect-actions">
      {failed?<button type="button" className="btn-primary" onClick={onRetry}><RefreshCw size={18} aria-hidden="true"/>Try again<ArrowRight size={18} aria-hidden="true"/></button>:null}
      <button type="button" className="btn-secondary" onClick={onUseCode}>Use another team code<ArrowRight size={17} aria-hidden="true"/></button>
     </div>
     <p className="reconnect-help">Need your code? Ask a teammate or the host. Everyone on your team uses the same code.</p>
    </div>
   </section>
   <button type="button" className="reconnect-host" onClick={onAdmin}>I’m the host<ArrowRight size={15} aria-hidden="true"/></button>
  </div>
 </main>;
}
