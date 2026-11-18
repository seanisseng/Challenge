import {useEffect,useRef,useState} from 'react';
import {Paperclip,X} from 'lucide-react';
import {draftError,MEDIA_ACCEPT,mediaType} from '../lib/submissionDraft';
import type {SubmissionDraft} from '../lib/submissionDraft';

function AttachmentPreview({file,url}:{file:File;url:string}) {
 const [failed,setFailed]=useState(false);
 if(failed)return <p className="proof-preview-unavailable">Preview unavailable. The file is still attached.</p>;
 return mediaType(file).startsWith('video/')?<video src={url} controls playsInline preload="metadata" aria-label={`Preview ${file.name}`} onError={()=>setFailed(true)}/>:<img src={url} alt={`Preview ${file.name}`} onError={()=>setFailed(true)}/>;
}

export function SubmissionComposer({draft,onChange,disabled}:{draft:SubmissionDraft;onChange:(draft:SubmissionDraft)=>void;disabled:boolean}) {
 const input=useRef<HTMLInputElement>(null);
 const [previews,setPreviews]=useState<{file:File;url:string}[]>([]);
 const [error,setError]=useState<string|null>(null);
 useEffect(()=>{const items=draft.files.map(file=>({file,url:URL.createObjectURL(file)}));setPreviews(items);return()=>items.forEach(item=>URL.revokeObjectURL(item.url));},[draft.files]);
 const attach=async(files:File[])=>{
  if(!files.length)return;
  const additions=files.filter(file=>!draft.files.some(old=>old.name===file.name&&old.size===file.size&&old.lastModified===file.lastModified));
  const next={...draft,files:[...draft.files,...additions]};
  const problem=draftError(next);
  if(problem){setError(problem);return;}
  setError(null);onChange(next);
 };
 return <section className="proof-composer" aria-label="Your submission">
  <h3>Your submission</h3>
  <p>Add images, videos, a message, or any combination. Nothing is sent until you submit.</p>
  <label className="proof-message-label">Message <span>(optional)</span><textarea className="field" rows={3} maxLength={4000} disabled={disabled} value={draft.text} onChange={event=>{setError(null);onChange({...draft,text:event.target.value});}} placeholder="Add details for the host…"/></label>
   <input ref={input} type="file" multiple accept={MEDIA_ACCEPT} className="hidden" aria-label="Attach images or videos" disabled={disabled} onChange={event=>{void attach(Array.from(event.target.files??[]));event.target.value='';}}/>
   <button type="button" className="btn-secondary proof-add" disabled={disabled} onClick={()=>input.current?.click()}><Paperclip size={18} aria-hidden="true"/>Add images or videos</button>
   <p className="proof-limits">Up to 10 files. Images: 25 MiB. Videos: 60 seconds, up to 1 GiB before compression. Videos are compressed to fit free storage.</p>
  {error?<p role="alert" className="sheet-error">{error}</p>:null}
  {previews.length?<ul className="proof-previews" aria-label="Attached files">{previews.map(({file,url},index)=><li key={url}>
   <AttachmentPreview file={file} url={url}/><div><strong>{file.name}</strong><span>{(file.size/1024/1024).toFixed(1)} MiB{mediaType(file).startsWith('video/')?' · Upload copy will be compressed':''}</span>
   <button type="button" className="proof-remove" aria-label={`Remove ${file.name}`} disabled={disabled} onClick={()=>{setError(null);onChange({...draft,files:draft.files.filter((_,i)=>i!==index)});}}><X size={18} aria-hidden="true"/></button></div>
  </li>)}</ul>:null}
 </section>;
}
