import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync,mkdtempSync,unlinkSync,rmdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';

test('resumable video chunks bypass Vercel and finalize one proof',async({page})=>{
 const chunks:number[]=[];let offset=0;let lostResponse=false;
 const offsets:number[]=[];
 const size=13*1024*1024;
 const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,PATCH,HEAD,OPTIONS',
  'Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'Location,Upload-Offset,Upload-Length,Tus-Resumable',
  'Tus-Resumable':'1.0.0'};
 let endpoint='';
 const server=createServer(async(request,response)=>{
  const reply=(status:number,extra:Record<string,string>={})=>{response.writeHead(status,{...headers,...extra});response.end();};
  const method=request.method;
  if(method==='OPTIONS'){reply(204);return;}
  if(!request.url?.startsWith('/resumable/sign')||request.headers['x-signature']!=='signed-test-token'){reply(401);return;}
  if(method==='POST'){reply(201,{Location:endpoint+'/one','Upload-Offset':'0'});return;}
  if(method==='HEAD'){reply(200,{'Upload-Offset':String(offset),'Upload-Length':String(size)});return;}
  if(method!=='PATCH'){reply(405);return;}
  offsets.push(Number(request.headers['upload-offset']));
  let length=0;for await(const chunk of request)length+=chunk.length;
  chunks.push(length);offset+=length;
  // The server accepted a chunk but its response was lost. HEAD must recover
  // the offset instead of duplicating bytes or starting a second object.
  if(!lostResponse){lostResponse=true;reply(503);return;}
  reply(204,{'Upload-Offset':String(offset)});
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 endpoint=`http://127.0.0.1:${(server.address() as {port:number}).port}/resumable/sign`;
 try{
 await page.goto('/');
 const result=await page.evaluate(async({size,endpoint})=>{
  const path='/src/lib/directUploader.ts';const {uploadProof}=await import(path);
  const calls:string[]=[];
  const post=async(path:string)=>{
   calls.push(path);
   if(path==='/api/uploads')return {batch_id:'batch',submission_id:null,bucket:'proofs',endpoint,
    uploads:[{id:'one',path:'room/team/one.mp4',ordinal:0,token:'signed-test-token',verified_at:null}]};
   return {ok:true,photo_path:null};
  };
  await uploadProof('video-challenge',{files:[new File([new Uint8Array(size)],'clip.mp4',{type:'video/mp4'})],text:'Proof'},'test-team',post,{});
  return calls;
 },{size,endpoint});
 expect(chunks).toEqual([6*1024*1024,6*1024*1024,1024*1024]);
 expect(offset).toBe(size);
 expect(offsets).toEqual([0,6*1024*1024,12*1024*1024]);
 expect(result).toEqual(['/api/uploads','/api/uploads/one/complete','/api/submissions/finalize']);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

for(const status of [401,413]){
 test(`Storage rejection HTTP ${status} reports its cause without leaking signed URLs`,async({page})=>{
  const server=createServer((request,response)=>{
   response.writeHead(request.method==='OPTIONS'?204:status,{
    'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,PATCH,HEAD,OPTIONS',
    'Access-Control-Allow-Headers':'*','Tus-Resumable':'1.0.0',
   });
   response.end('Internal error containing https://storage.invalid/private?token=do-not-show');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${(server.address() as {port:number}).port}/resumable/sign`;
  try{
   await page.goto('/');
   const result=await page.evaluate(async endpoint=>{
    const path='/src/lib/directUploader.ts';const {uploadProof}=await import(path);
    const calls:string[]=[];
    const post=async(path:string)=>{
     calls.push(path);
     return {batch_id:'rejected',submission_id:null,bucket:'proofs',endpoint,
      uploads:[{id:'rejected',path:'room/team/proof.jpg',ordinal:0,token:'signed-token',verified_at:null}]};
    };
    try{
     await uploadProof('rejected-upload',{files:[new File(['proof'],'proof.jpg',{type:'image/jpeg'})],text:''},'test-team',post,{});
     return {message:'Unexpected success',calls};
    }catch(error){return {message:(error as Error).message,calls};}
   },endpoint);
   expect(result.message).toContain(`HTTP ${status}`);
   expect(result.message).not.toContain('do-not-show');
   expect(result.message).toContain('draft');
   expect(result.calls).toEqual(['/api/uploads']);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
}

for(const [name,source,accepted] of [['small MP4','short.mp4',true],['WebM conversion','short.webm',true],['over 30 seconds','long.mp4',false]] as const){
 test(`video preparation: ${name}`,async({page})=>{
  test.setTimeout(120_000);
  const bytes=readFileSync(resolve('tests/fixtures/video',source)).toString('base64');
  await page.goto('/');
  const result=await page.evaluate(async({source,bytes})=>{
   const path='/src/lib/videoPreparation.ts';const {prepareVideo}=await import(path);
   const data=Uint8Array.from(atob(bytes),char=>char.charCodeAt(0));
   const file=new File([data],source,{type:source.endsWith('.webm')?'video/webm':'video/mp4'});
   try{
    const output=await prepareVideo(file,new AbortController().signal,()=>{});
    const video=document.createElement('video');video.src=URL.createObjectURL(output);
    const playback=await new Promise<boolean>(resolve=>{video.onloadedmetadata=()=>resolve(true);video.onerror=()=>resolve(false);});
    const duration=playback?video.duration:null;URL.revokeObjectURL(video.src);
    const data=new Uint8Array(await output.arrayBuffer());
    let binary='';for(const byte of data)binary+=String.fromCharCode(byte);
    return {ok:true,size:output.size,type:output.type,duration,bytes:btoa(binary),playback};
   }catch(error){return {ok:false,message:String(error),details:(error as {details?:unknown}).details};}
  },{source,bytes});
  expect(result.ok,JSON.stringify(result)).toBe(accepted);
  if(accepted){
   expect(result.type).toBe('video/mp4');expect(result.size!).toBeLessThan(45*1024**2);
   // Windows WebKit may lack proprietary H.264 playback. Independently probe
   // the actual browser-produced bytes with the backend's native validator.
   const directory=mkdtempSync(join(tmpdir(),'challenge-video-test-'));const output=join(directory,'prepared.mp4');
   try{
    writeFileSync(output,Buffer.from(result.bytes!,'base64'));
    const windows=resolve('../backend/.venv/Scripts/python.exe');
    const python=existsSync(windows)?windows:resolve('../backend/.venv/bin/python');
    const duration=Number(execFileSync(python,['-c','from pathlib import Path; import sys; from app.video import inspect_video; print(inspect_video(Path(sys.argv[1]),require_compatible=True))',output],{cwd:resolve('../backend'),encoding:'utf8'}));
    expect(duration).toBeLessThanOrEqual(30);
    if(result.playback)expect(result.duration!).toBeLessThanOrEqual(30);
   }finally{if(existsSync(output))unlinkSync(output);rmdirSync(directory);}
  }
  else expect(result.message).toContain('30 seconds');
 });
}
