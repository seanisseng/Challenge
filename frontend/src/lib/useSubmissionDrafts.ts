import {useCallback,useEffect,useRef,useState} from 'react';
import type {SubmissionDraft} from './submissionDraft';

interface StoredFile {blob?:Blob;chunks?:string[];name:string;type:string;lastModified:number}
interface StoredDraft {key:string;scope:string;challengeId:string;text:string;files:StoredFile[]}
const CHUNK_SIZE=4*1024*1024;
function database():Promise<IDBDatabase> {
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('challenge-proof-drafts',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'key'});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
}
async function transact(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>void) {
 const db=await database();
 try {await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('drafts',mode);
  tx.oncomplete=()=>resolve();tx.onerror=event=>reject((event.target as IDBRequest).error??tx.error);tx.onabort=()=>reject(tx.error);
  action(tx.objectStore('drafts'));
 });}finally{db.close();}
}
async function readChunk(key:string):Promise<ArrayBuffer> {
 let value:{data:ArrayBuffer}|undefined;
 await transact('readonly',store=>{const read=store.get(key);read.onsuccess=()=>{value=read.result;};});
 if(!value)throw new Error('Draft attachment data is missing');
 return value.data;
}
async function restoreFile(file:StoredFile):Promise<File> {
 let blob=file.blob??new Blob([],{type:file.type});
 for(const key of file.chunks??[])blob=new Blob([blob,await readChunk(key)],{type:file.type});
 return new File([blob],file.name,{type:file.type,lastModified:file.lastModified});
}

export function useSubmissionDrafts(scope:string) {
 const [drafts,setDrafts]=useState<Record<string,SubmissionDraft>>({});
 const [storageError,setStorageError]=useState<string|null>(null);
 const [saving,setSaving]=useState(0),[restoring,setRestoring]=useState(true);
 const touched=useRef(new Set<string>()),chunkCache=useRef(new WeakMap<File,string[]>());
 const queue=useRef(Promise.resolve());
 useEffect(()=>{
  let cancelled=false;
  const restore=async()=>{
   const rows:StoredDraft[]=[];
   await transact('readonly',store=>{
    const cursor=store.openCursor(IDBKeyRange.bound(`${scope}:`,`${scope}:\uffff`));
    cursor.onsuccess=()=>{const entry=cursor.result;if(entry){rows.push(entry.value);entry.continue();}};
   });
   for(const row of rows){
    if(cancelled||touched.current.has(row.challengeId))continue;
    const files:File[]=[];
    for(const stored of row.files){
     const file=await restoreFile(stored);files.push(file);
     if(stored.chunks)chunkCache.current.set(file,stored.chunks);
    }
    if(!cancelled&&!touched.current.has(row.challengeId))setDrafts(current=>({...current,[row.challengeId]:{text:row.text,files}}));
   }
  };
  void restore().catch(()=>{if(!cancelled)setStorageError('Draft recovery is unavailable in this browser. Keep this page open to retain your attachments.');}).finally(()=>{if(!cancelled)setRestoring(false);});
  return()=>{cancelled=true;};
 },[scope]);
 const save=useCallback((id:string,draft:SubmissionDraft|null)=>{
  touched.current.add(id);
  setDrafts(current=>{const next={...current};if(draft)next[id]=draft;else delete next[id];return next;});
  setSaving(value=>value+1);
  const write=()=>transact('readwrite',store=>{
   const key=`${scope}:${id}`;
   const files=draft?.files.map(file=>({...(chunkCache.current.has(file)?{chunks:chunkCache.current.get(file)!}:{blob:file}),name:file.name,type:file.type,lastModified:file.lastModified}))??[];
   const keep=new Set(files.flatMap(file=>'chunks' in file?file.chunks:[]));
   const read=store.get(key);
   read.onsuccess=()=>{
    const old=read.result as StoredDraft|undefined;
    for(const chunk of old?.files.flatMap(file=>file.chunks??[])??[])if(!keep.has(chunk))store.delete(chunk);
    if(!draft||(!draft.files.length&&!draft.text))store.delete(key);
    else store.put({key,scope,challengeId:id,text:draft.text,files} satisfies StoredDraft);
   };
  });
  queue.current=queue.current.then(async()=>{
   try{await write();}catch(error){
    // WebKit may reject Blob storage. Save bounded binary chunks instead of
    // allocating a single JavaScript buffer for a large phone video.
    if(!(error instanceof DOMException)||error.name!=='UnknownError'||!draft?.files.length)throw error;
    const created:{file:File;keys:string[]}[]=[];
    try{
     for(const file of draft.files){
      if(chunkCache.current.has(file))continue;
      const keys:string[]=[];created.push({file,keys});
      const prefix=`chunk:${scope}:${id}:${crypto.randomUUID()}`;
      for(let offset=0;offset<file.size;offset+=CHUNK_SIZE){
       const data=await file.slice(offset,offset+CHUNK_SIZE).arrayBuffer();
       const key=`${prefix}:${offset}`;
       await transact('readwrite',store=>{store.put({key,data});});keys.push(key);
      }
      chunkCache.current.set(file,keys);
     }
     await write();
    }catch(failure){
     for(const item of created)chunkCache.current.delete(item.file);
     await transact('readwrite',store=>{for(const item of created)for(const key of item.keys)store.delete(key);}).catch(()=>{});
     throw failure;
    }
   }
  }).then(()=>setStorageError(null)).catch(()=>setStorageError('Could not save this draft on your device. Keep this page open to retain your attachments.')).finally(()=>setSaving(value=>value-1));
 },[scope]);
 return {drafts,save,storageError,saving:saving>0,restoring};
}
