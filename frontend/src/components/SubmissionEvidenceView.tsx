import {useEffect,useState} from 'react';
import {submissionPhoto} from '../lib/api';
import type {AdminSubmission,EvidenceAttachment} from '../lib/types';

function EvidenceMedia({item,description,onRetry}:{item:EvidenceAttachment;description:string;onRetry:()=>void}) {
 const [failed,setFailed]=useState(false);
 return <figure className="evidence-file">
  {!item.url||failed?<div className="review-media-state"><p>We could not load this attachment.</p><button type="button" className="btn-secondary" onClick={onRetry}>Retry photo or video</button></div>:item.content_type.startsWith('video/')?<video src={item.url} controls playsInline preload="metadata" aria-label={`Video proof: ${item.name}`} onError={()=>setFailed(true)}/>:<a href={item.url} target="_blank" rel="noreferrer" aria-label="Open full submission photo"><img src={item.url} alt={description} onError={()=>setFailed(true)}/></a>}
  <figcaption><span>{item.name}</span>{item.url?<a href={item.url} target="_blank" rel="noreferrer">Open attachment</a>:null}
    {item.download_url?<a href={item.download_url} download={item.name} target="_blank" rel="noreferrer" aria-label={`Download ${item.name}`}>Download</a>:null}</figcaption>
 </figure>;
}

export function SubmissionEvidenceView({submission}:{submission:AdminSubmission}) {
 const [result,setResult]=useState<Awaited<ReturnType<typeof submissionPhoto>>|null>(null);
 const [failed,setFailed]=useState(false);
 const [reload,setReload]=useState(0);
 useEffect(()=>{
  let cancelled=false;setResult(null);setFailed(false);
  submissionPhoto(submission.id).then(value=>{if(!cancelled)setResult(value);}).catch(()=>{if(!cancelled)setFailed(true);});
  return()=>{cancelled=true;};
 },[submission.id,reload]);
 const retry=()=>setReload(value=>value+1);
 if(failed)return <div className="review-media-state"><p>We could not load this proof.</p><button type="button" className="btn-secondary" onClick={retry}>Retry photo or video</button></div>;
 if(!result)return <div className="review-media-state" role="status">Loading proof...</div>;
 const attachments=result.attachments??(result.url?[{path:submission.photo_path??'',name:'Submission photo',content_type:'image/jpeg',size:0,url:result.url}]:[]);
 const text=result.text??submission.proof_text;
 return <section className="submission-evidence" aria-label="Submission evidence">
  {text?<div className="evidence-message"><h4>Team message</h4><p>{text}</p></div>:null}
  {attachments.map((item,index)=><EvidenceMedia key={`${submission.id}-${reload}-${item.path}`} item={item} description={`Proof from ${submission.teams?.name??'a team'} for ${submission.challenges?.title??'the challenge'}${index?` (attachment ${index+1})`:''}`} onRetry={retry}/>)}
  {!attachments.length&&!text?<p>No evidence is available for this submission.</p>:null}
 </section>;
}
