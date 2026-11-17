import {useEffect,useRef,useState} from 'react';
import {ApiError,beginLocationShare,sendLocation,endLocationShare,setLocationAccess} from './api';
import type {LocationAccess} from './api';

function deviceId() {
  const key='challenge.map-device';
  try {const old=localStorage.getItem(key);if(old)return old;const id=crypto.randomUUID();localStorage.setItem(key,id);return id;}
  catch {return crypto.randomUUID();}
}
export function useLocationSharing(sessionId:string,active:boolean) {
  const [id]=useState(deviceId);
  const [status,setStatus]=useState<'off'|'locating'|'sharing'>('off');
  const [error,setError]=useState<string|null>(null);
  const [access,setAccess]=useState<LocationAccess|null>(null);
  const generation=useRef(0),lease=useRef<string|null>(null),interval=useRef<ReturnType<typeof setInterval>>();
  const sample=useRef<()=>void>(()=>{});
  const stop=async ()=> {
    generation.current++;
    clearInterval(interval.current);interval.current=undefined;
    const grant=lease.current;lease.current=null;
    setStatus('off');
    setLocationAccess(null);setAccess(null);
    if(grant) try {await endLocationShare(id,grant);} catch {setError('Sharing stopped here. The last fix will disappear within two minutes if the server is unreachable.');}
  };
  const start=()=> {
    if(status!=='off')return;
    if(!window.isSecureContext){setError('Open the secure HTTPS game link to share your location.');return;}
    if(!navigator.geolocation){setError('Location sharing is unavailable in this browser.');return;}
    const run=++generation.current;let pending=false;
    setError(null);setStatus('locating');
    sample.current=()=> {
      if(pending||generation.current!==run||document.visibilityState==='hidden')return;
      pending=true;
      navigator.geolocation.getCurrentPosition(async position=> {
        try {
          if(generation.current!==run)return;
          let grant=lease.current;
          if(!grant) {
            const result=await beginLocationShare(id);grant=result.lease;
            if(generation.current!==run){await endLocationShare(id,grant);return;}
            lease.current=grant;
          }
          await sendLocation(id,grant,{lat:position.coords.latitude,lng:position.coords.longitude},position.coords.accuracy);
          if(generation.current===run){const credentials={device_id:id,lease:grant};setLocationAccess(credentials);setAccess(credentials);setStatus('sharing');setError(null);}
        } catch(error) {
          if(generation.current===run) {
            if(error instanceof ApiError && error.status===400) lease.current=null;
            setError(error instanceof ApiError ? error.message : 'Could not share this fix. Retrying while the game is open.');
          }
        } finally {pending=false;}
      },error=> {
        pending=false;
        if(generation.current!==run)return;
        if(error.code===1){void stop();setError('Location permission was denied. You can still play and enable it later.');}
        else setError('Waiting for a GPS fix. Check location services; sharing will retry.');
      },{enableHighAccuracy:true,timeout:10000,maximumAge:5000});
    };
    sample.current();interval.current=setInterval(()=>sample.current(),15000);
  };
  useEffect(()=> {
    const visible=()=>{if(document.visibilityState==='visible')sample.current();};
    document.addEventListener('visibilitychange',visible);
    return ()=>{document.removeEventListener('visibilitychange',visible);void stop();};
  },[sessionId]);
  useEffect(()=>{if(!active)void stop();},[active]);
  return {deviceId:id,status,error,access,start,stop};
}
