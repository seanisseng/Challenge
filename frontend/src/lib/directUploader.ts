import {Upload,type DetailedError} from 'tus-js-client';
import type {SubmissionDraft} from './submissionDraft';
import {mediaType} from './submissionDraft';

interface Ticket {id:string;path:string;ordinal:number;token:string|null;verified_at:string|null}
interface Authorized {batch_id:string;submission_id:string|null;uploads:Ticket[];bucket:string;endpoint:string}
type Post=<T>(path:string,body:unknown,signal?:AbortSignal)=>Promise<T>;
const sessions=new Map<string,{fingerprint:string;request_id:string}>();
const abortError=()=>new DOMException('Upload cancelled','AbortError');

export async function uploadProof(challengeId:string,draft:SubmissionDraft,teamToken:string,post:Post,
 options:{signal?:AbortSignal;onProgress?:(percent:number)=>void}) {
 const group=new AbortController();
 const abort=()=>group.abort();options.signal?.addEventListener('abort',abort,{once:true});
 if(options.signal?.aborted)group.abort();
 const signal=group.signal;
 const check=()=>{if(signal.aborted)throw abortError();};
 try {
  check();
  const files=draft.files.map(file=>({name:Array.from(file.name).slice(0,255).join(''),content_type:mediaType(file),size:file.size}));
  const hashes:string[]=[];
  for(const file of draft.files){
   const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());check();
   hashes.push(Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join(''));
  }
  const fingerprint=JSON.stringify([files,hashes]);
  const key=`challenge.direct-upload:${teamToken}:${challengeId}`;
  let cached=sessions.get(key);
  try{cached=JSON.parse(localStorage.getItem(key)??'null')??cached;}catch{/* Memory fallback in private browsing. */}
  const retrying=cached?.fingerprint===fingerprint;
  const state=retrying?cached!:{fingerprint,request_id:crypto.randomUUID()};
  const forget=()=>{sessions.delete(key);try{localStorage.removeItem(key);}catch{/* Best effort. */}};
  sessions.set(key,state);try{localStorage.setItem(key,JSON.stringify(state));}catch{/* Keep in memory. */}
  let auth:Authorized;
  try{auth=await post<Authorized>('/api/uploads',{request_id:state.request_id,challenge_id:challengeId,files},signal);}
  catch(error){if((error as {status?:number}).status===410)forget();throw error;}
  if(!auth.batch_id||!Array.isArray(auth.uploads))throw new Error('Could not authorize uploads. Your draft is kept.');
  if(auth.submission_id){forget();options.onProgress?.(100);return {ok:true,photo_path:null};}
  const transferred=draft.files.map(()=>0);const total=draft.files.reduce((sum,file)=>sum+file.size,0);
  const progress=()=>options.onProgress?.(total?Math.min(99,Math.round(transferred.reduce((a,b)=>a+b,0)/total*99)):99);
  let next=0;
  const process=async(ticket:Ticket)=>{
   check();const file=draft.files[ticket.ordinal];
   if(!file)throw new Error('The upload manifest does not match this draft.');
   let verified=Boolean(ticket.verified_at);
   if(!verified&&retrying){
    try{await post(`/api/uploads/${ticket.id}/complete`,{},signal);verified=true;}
    catch(error){if((error as {status?:number}).status!==409)throw error;}
   }
   if(!verified){
    if(!ticket.token)throw new Error('Storage authorization is incomplete. Retry this saved draft.');
    await new Promise<void>((resolve,reject)=>{
     let settled=false;
     const finish=(error?:unknown)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);error?reject(error):resolve();};
     const upload=new Upload(file,{
      endpoint:auth.endpoint,headers:{'x-signature':ticket.token!},
      metadata:{bucketName:auth.bucket,objectName:ticket.path,contentType:files[ticket.ordinal].content_type,cacheControl:'3600'},
      chunkSize:6*1024*1024,retryDelays:[0,1000,3000,5000],removeFingerprintOnSuccess:true,
      fingerprint:async()=>`challenge-proof:${ticket.id}`,
      onProgress:bytes=>{transferred[ticket.ordinal]=bytes;progress();},
      onError:error=>{
       // DetailedError messages may contain signed URLs. Expose only the status.
       const status=(error as Partial<DetailedError>).originalResponse?.getStatus()??0;
       let message='The upload connection failed. Check your connection and retry your saved draft.';
       if(status===401||status===403)message=`Upload permission was rejected (HTTP ${status}). Your draft is kept. Retry to request fresh upload permission.`;
       else if(status===413)message='The file exceeds the Storage upload limit (HTTP 413). Your draft is kept. Choose a smaller file.';
       else if(status===415)message='The file type was rejected (HTTP 415). Your draft is kept. Choose a supported image or MP4 video.';
       else if(status)message=`Storage could not accept the upload (HTTP ${status}). Your draft is kept. Retry submission.`;
       finish(new Error(message));
      },
      onSuccess:()=>finish(),
     });
     const cancel=()=>{void upload.abort().catch(()=>{});finish(abortError());};
     signal.addEventListener('abort',cancel,{once:true});
     if(signal.aborted){cancel();return;}
     void upload.findPreviousUploads().then(previous=>{
      if(signal.aborted)return;
      const resumable=previous.find(item=>item.uploadUrl&&new URL(item.uploadUrl).origin===new URL(auth.endpoint).origin);
      if(resumable)upload.resumeFromPreviousUpload(resumable);
      upload.start();
     }).catch(()=>{if(!signal.aborted)upload.start();});
    });
    check();await post(`/api/uploads/${ticket.id}/complete`,{},signal);
   }
   transferred[ticket.ordinal]=file.size;progress();
  };
  let failure:unknown;
  const worker=async()=>{
   try{while(next<auth.uploads.length){check();await process(auth.uploads[next++]);}}
   catch(error){if(!failure)failure=error;group.abort();}
  };
  await Promise.all([worker(),worker()]);
  if(failure)throw failure;check();options.onProgress?.(100);
  const result=await post<{ok:boolean;photo_path:string|null}>('/api/submissions/finalize',{batch_id:auth.batch_id,text:draft.text.trim()},signal);
  if(result.ok!==true)throw new Error('Could not confirm submission. Retry this saved draft.');
  forget();
  return result;
 }finally{options.signal?.removeEventListener('abort',abort);}
}
