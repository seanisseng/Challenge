import {useState} from 'react';
import {RaceDialog} from './RaceDialog';

export const locationPromptKey=(sessionId:string,teamId:string)=>`challenge.location-prompt:${sessionId}:${teamId}`;

export function LocationSharingPrompt({sessionId,teamId,freshJoin,eligible,onShare,deferred=false}:{sessionId:string;teamId:string;freshJoin:boolean;eligible:boolean;onShare:()=>void;deferred?:boolean}) {
 const key=locationPromptKey(sessionId,teamId);
 const [pending,setPending]=useState(()=>{
  try{const value=localStorage.getItem(key);return value==='pending'||(!value&&freshJoin);}catch{return freshJoin;}
 });
 const dismiss=()=>{setPending(false);try{localStorage.setItem(key,'done');}catch{/* Still respect dismissal for this visit. */}};
 if(!pending||!eligible||deferred)return null;
 return <RaceDialog title="See your team on the map" eyebrow="LOCATION SHARING" onClose={dismiss} footer={<>
  <button type="button" className="btn-secondary" onClick={dismiss}>Not now</button>
  <button type="button" className="btn-primary" onClick={()=>{dismiss();onShare();}}>Share location</button>
 </>}>
  <p>Share your location to see where you are within the game radius.</p>
  <p>Your team’s devices combine into one tracker, visible to the host and other sharing teams.</p>
  <p>Share from this device to see other teams. If you decline or stop sharing, their trackers stay hidden.</p>
  <p>Sharing is optional. You can still play and see the game radius without it. Stop sharing anytime in Map.</p>
 </RaceDialog>;
}
