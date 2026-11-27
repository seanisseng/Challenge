import {useEffect,useRef,useState} from 'react';
import {Paperclip,X} from 'lucide-react';
import {draftError,MEDIA_ACCEPT,mediaType} from '../lib/submissionDraft';
import type {SubmissionDraft} from '../lib/submissionDraft';
import {compressPhoto} from '../lib/photoCompression';

function AttachmentPreview({file,url}:{file:File;url:string}) {
 const [failed,setFailed]=useState(false);
 if(failed)return <p className="proof-preview-unavailable">Preview unavailable. The file is still attached.</p>;
 return mediaType(file).startsWith('video/')?<video src={url} controls playsInline preload="metadata" aria-label={`Preview ${file.name}`} onError={()=>setFailed(true)}/>:<img src={url} alt={`Preview ${file.name}`} onError={()=>setFailed(true)}/>;
}

export function SubmissionComposer({draft,onChange,disabled,onPreparingChange}:{draft:SubmissionDraft;onChange:(draft:SubmissionDraft)=>void;disabled:boolean;onPreparingChange?:(value:boolean)=>void}) {
 const input=useRef<HTMLInputElement>(null);
 const [previews,setPreviews]=useState<{file:File;url:string}[]>([]);
 const [error,setError]=useState<string|null>(null);
 const [preparing,setPreparing]=useState(false);
 const generation=useRef(0);
 useEffect(()=>()=>{generation.current++;onPreparingChange?.(false);},[onPreparingChange]);
 useEffect(()=>{const items=draft.files.map(file=>({file,url:URL.createObjectURL(file)}));setPreviews(items);return()=>items.forEach(item=>URL.revokeObjectURL(item.url));},[draft.files]);
 const attach=async(files:File[])=>{
  if(!files.length||preparing||disabled)return;
  if(draft.files.length+files.length>10){setError('Attach at most 10 files.');return;}
  const current=++generation.current;
  setPreparing(true);onPreparingChange?.(true);setError(null);
  try {
  const additions=files.filter(file=>!draft.files.some(old=>old.name===file.name&&old.size===file.size&&old.lastModified===file.lastModified));
  const copies:File[]=[];
  for(const file of additions){copies.push(await compressPhoto(file));if(current!==generation.current)return;}
  if(current!==generation.current)return;
  const next={...draft,files:[...draft.files,...copies]};
  const problem=draftError(next);
  if(problem){setError(problem);return;}
  setError(null);onChange(next);
  }finally{if(current===generation.current){setPreparing(false);onPreparingChange?.(false);}}
 };
 return <section className="proof-composer" aria-label="Your submission">
  <h3>Your submission</h3>
  <p>Add images, videos, a message, or any combination. Nothing is sent until you submit.</p>
  <label className="proof-message-label">Message <span>(optional)</span><textarea className="field" rows={3} maxLength={4000} disabled={disabled||preparing} value={draft.text} onChange={event=>{setError(null);onChange({...draft,text:event.target.value});}} placeholder="Add details for the host…"/></label>
   <input ref={input} type="file" multiple accept={MEDIA_ACCEPT} className="hidden" aria-label="Attach images or videos" disabled={disabled||preparing} onChange={event=>{void attach(Array.from(event.target.files??[]));event.target.value='';}}/>
   <button type="button" className="btn-secondary proof-add" disabled={disabled||preparing} onClick={()=>input.current?.click()}><Paperclip size={18} aria-hidden="true"/>Add images or videos</button>
   {preparing?<p role="status">Preparing smaller photo copies…</p>:null}
   <p className="proof-limits">Photos are resized for faster uploads; originals stay on your device. Up to 10 files, totaling 4 MiB (about 4.19 MB). Videos: 60 seconds maximum; trim/compress larger clips before attaching.</p>
  {error?<p role="alert" className="sheet-error">{error}</p>:null}
  {previews.length?<ul className="proof-previews" aria-label="Attached files">{previews.map(({file,url},index)=><li key={url}>
   <AttachmentPreview file={file} url={url}/><div><strong>{file.name}</strong><span>{(file.size/1024/1024).toFixed(1)} MiB{mediaType(file).startsWith('video/')?' · Upload copy will be compressed':''}</span>
   <button type="button" className="proof-remove" aria-label={`Remove ${file.name}`} disabled={disabled||preparing} onClick={()=>{setError(null);onChange({...draft,files:draft.files.filter((_,i)=>i!==index)});}}><X size={18} aria-hidden="true"/></button></div>
  </li>)}</ul>:null}
 </section>;
}
