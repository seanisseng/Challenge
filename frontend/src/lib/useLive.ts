/** WebSocket delivery with bounded reconnects and HTTP reconciliation. */
import {useEffect,useRef,useState} from 'react';

export type ConnectionStatus='connecting'|'live'|'reconnecting'|'syncing'|'offline';
const HEARTBEAT_MS=20_000;
const HEALTH_SYNC_MS=30_000;
const FALLBACK_SYNC_MS=5_000;

export function useLiveSocket<T>(
 url:string|null,onSnapshot:(snapshot:T)=>void,onUnauthorized?:()=>void,
 refresh?:(signal:AbortSignal)=>Promise<T>,
 getVersion?:()=>number,
):ConnectionStatus{
 const [status,setStatus]=useState<ConnectionStatus>('connecting');
 const handler=useRef(onSnapshot);handler.current=onSnapshot;
 const unauthorized=useRef(onUnauthorized);unauthorized.current=onUnauthorized;
 const refreshState=useRef(refresh);refreshState.current=refresh;
 const gameVersion=useRef(getVersion);gameVersion.current=getVersion;

 useEffect(()=>{
  if(!url){setStatus('offline');return;}
  let socket:WebSocket|null=null,disposed=false;
  let heartbeat:number|undefined,retry:number|undefined,connectTimeout:number|undefined;
  let syncTimer:number|undefined,syncDue=0,syncController:AbortController|null=null;
  let attempt=0,lastReceived=Date.now(),revision=0;
  let socketHasState=false,everConnected=false,httpFresh=false,unavailable=false,needsSync=false;
  const visible=()=>document.visibilityState!=='hidden';

  function updateStatus(){
   if(disposed)return;
   if(!navigator.onLine){setStatus('offline');return;}
   if(socketHasState&&!needsSync){setStatus('live');return;}
   if(unavailable){setStatus('offline');return;}
   if(httpFresh||socketHasState){setStatus('syncing');return;}
   setStatus(attempt||everConnected?'reconnecting':'connecting');
  }
  function clearSync(){
   if(syncTimer!==undefined)window.clearTimeout(syncTimer);
   syncTimer=undefined;
  }
  function releaseSocket(){
   if(heartbeat!==undefined)window.clearInterval(heartbeat);
   if(connectTimeout!==undefined)window.clearTimeout(connectTimeout);
   heartbeat=connectTimeout=undefined;
   const old=socket;socket=null;socketHasState=false;
   if(old){old.onopen=old.onclose=old.onmessage=old.onerror=null;try{old.close();}catch{/* Already closed. */}}
  }
  function stop(){
   disposed=true;clearSync();releaseSocket();syncController?.abort();
   if(retry!==undefined)window.clearTimeout(retry);
   retry=undefined;
  }
  function rejectIdentity(){stop();unauthorized.current?.();}
  function scheduleSync(delay:number,replace=false){
   if(disposed||!refreshState.current||!visible()||!navigator.onLine)return;
   const due=Date.now()+delay;
   // Frequent map packets must not postpone the periodic consistency check.
   if(syncTimer!==undefined&&!replace&&syncDue<=due)return;
   clearSync();syncDue=due;
   syncTimer=window.setTimeout(()=>{syncTimer=undefined;void sync();},delay);
  }
  async function sync(){
   if(disposed||!visible()||!navigator.onLine||syncController||!refreshState.current)return;
   const controller=new AbortController();syncController=controller;
   const startedRevision=revision;
   const startedGameVersion=gameVersion.current?.();
   const timeout=window.setTimeout(()=>controller.abort(),10_000);
   try{
    const snapshot=await refreshState.current(controller.signal);
    if(disposed||controller.signal.aborted||startedRevision!==revision||startedGameVersion!==gameVersion.current?.())return;
    handler.current(snapshot);
    httpFresh=true;unavailable=false;needsSync=false;everConnected=true;updateStatus();
   }catch(error){
    if(disposed)return;
    if((error as {status?:number})?.status===401){rejectIdentity();return;}
    if(!socketHasState)unavailable=true;
    updateStatus();
   }finally{
    window.clearTimeout(timeout);
    if(syncController===controller)syncController=null;
    scheduleSync(startedRevision!==revision&&needsSync?0:socketHasState&&!needsSync?HEALTH_SYNC_MS:FALLBACK_SYNC_MS);
   }
  }
  function scheduleReconnect(immediate=false){
   if(disposed||!visible()||!navigator.onLine)return;
   if(retry!==undefined)window.clearTimeout(retry);
   const delay=immediate?0:Math.min(1000*2**Math.min(attempt-1,4),10_000);
   retry=window.setTimeout(()=>{retry=undefined;open();},delay);
  }
  function restart(cause:string,immediate=false){
   if(disposed)return;
   console.info('[live] Reconnecting',{cause});
   releaseSocket();needsSync=true;attempt++;updateStatus();
   scheduleReconnect(immediate);scheduleSync(0,true);
  }
  function ping(){
   if(socket?.readyState===WebSocket.OPEN)try{socket.send('ping');}catch{restart('send_failed');}
  }
  function open(){
   if(disposed||!visible()||!navigator.onLine){updateStatus();return;}
   releaseSocket();updateStatus();
   let current:WebSocket;
   try{current=new WebSocket(url!);socket=current;}catch{restart('connection_failed');return;}
   connectTimeout=window.setTimeout(()=>{if(socket===current)restart('connect_timeout');},15_000);
   current.onopen=()=>{
    if(disposed||socket!==current)return;
    if(connectTimeout!==undefined)window.clearTimeout(connectTimeout);
    connectTimeout=undefined;lastReceived=Date.now();
    heartbeat=window.setInterval(()=>{
     if(!visible())return;
     if(Date.now()-lastReceived>45_000){restart('heartbeat_timeout');return;}
     ping();
    },HEARTBEAT_MS);
   };
   current.onmessage=event=>{
    if(disposed||socket!==current)return;
    try{
     const payload=JSON.parse(event.data as string);
     if(!payload||typeof payload!=='object')return;
     lastReceived=Date.now();
     if(payload.kind==='pong')return;
     // GPS fixes merge by revision, but permission/removal changes must reject
     // older HTTP snapshots as well as older game updates.
     if(payload.kind!=='location')revision++;
     if(payload.kind==='sync_required'){
      needsSync=true;updateStatus();scheduleSync(0,true);return;
     }
     handler.current(payload as T);
     const first=!socketHasState;
     const gamePayload=!['location','location_removed','map_access'].includes(payload.kind);
     if(gamePayload){socketHasState=true;needsSync=false;unavailable=false;attempt=0;everConnected=true;}
     updateStatus();scheduleSync(socketHasState&&!needsSync?HEALTH_SYNC_MS:FALLBACK_SYNC_MS,first&&gamePayload);
    }catch{/* Ignore malformed frames, including callbacks that reject a bad payload. */}
   };
   current.onerror=()=>{/* onclose records the safe close code and handles recovery. */};
   current.onclose=event=>{
    if(disposed||socket!==current)return;
    console.info('[live] Socket closed',{code:event.code,clean:event.wasClean});
    releaseSocket();needsSync=true;
    if(event.code===4401){rejectIdentity();return;}
    attempt++;updateStatus();scheduleReconnect();scheduleSync(0,true);
   };
  }
  function onVisibility(){
   if(!visible()){
    clearSync();if(retry!==undefined)window.clearTimeout(retry);retry=undefined;return;
   }
   // Suspended timers do not prove a socket is dead. Allow a heartbeat response
   // and refresh state immediately on returning to the game.
   lastReceived=Date.now();
   if(socket?.readyState===WebSocket.OPEN)ping();else restart('page_visible',true);
   scheduleSync(0,true);
  }
  function onOffline(){
   clearSync();releaseSocket();syncController?.abort();syncController=null;
   if(retry!==undefined)window.clearTimeout(retry);retry=undefined;
   unavailable=true;needsSync=true;updateStatus();
  }
  function onOnline(){unavailable=false;attempt=0;restart('network_online',true);}

  document.addEventListener('visibilitychange',onVisibility);
  window.addEventListener('offline',onOffline);window.addEventListener('online',onOnline);
  open();scheduleSync(FALLBACK_SYNC_MS);
  return()=>{
   stop();document.removeEventListener('visibilitychange',onVisibility);
   window.removeEventListener('offline',onOffline);window.removeEventListener('online',onOnline);
  };
 },[url]);
 return status;
}
