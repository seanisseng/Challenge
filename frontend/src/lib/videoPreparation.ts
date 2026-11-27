import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import {MAX_VIDEO_BYTES,MAX_VIDEO_SOURCE_BYTES,videoPreparationError,shouldCompressVideo} from './videoPolicy';

export async function prepareVideo(file:File,signal:AbortSignal,onProgress:(message:string)=>void):Promise<File> {
 if(file.size>MAX_VIDEO_SOURCE_BYTES)throw new Error('Choose a video smaller than 200 MiB. Export a smaller copy first.');
 const {FFmpeg}=await import('@ffmpeg/ffmpeg').catch(()=>{throw new Error('Could not load video tools. Check your connection and try again. Your previous draft is kept.');});
 const engine=new FFmpeg();
 const logs:string[]=[];
 engine.on('log',({message})=>{logs.push(message);if(logs.length>12)logs.shift();});
 let timer:ReturnType<typeof setTimeout>|undefined;
 const aborted=()=>new DOMException('Video preparation cancelled. Your previous draft is kept.','AbortError');
 const abort=()=>engine.terminate();
 signal.addEventListener('abort',abort,{once:true});
 const stopped=new Promise<never>((_,reject)=>{
  timer=setTimeout(()=>{engine.terminate();reject(new Error('Video preparation took too long. Choose a smaller 720p clip. Your previous draft is kept.'));},180_000);
 });
 const process=async()=>{
  if(signal.aborted)throw aborted();
  onProgress('Loading video tools…');
  await engine.load({coreURL,wasmURL},{signal});
  onProgress('Checking video duration and format…');
  await engine.writeFile('source',new Uint8Array(await file.arrayBuffer()),{signal});
  const probe=await engine.ffprobe(['-v','error','-show_entries','format=duration,format_name:stream=codec_type,codec_name,color_transfer','-of','json','source','-o','probe.json'],30_000,{signal});
  // core 0.12.10 can return -1 for a successful ffprobe invocation (#817).
  // Require a valid metadata file rather than relying on that sentinel alone.
  if(probe>0)throw Object.assign(new Error('This video could not be read. Choose another clip.'),{details:logs});
  let metadata;
  try{metadata=JSON.parse(await engine.readFile('probe.json','utf8',{signal}) as string);}
  catch{throw new Error('This video could not be read. Choose another clip.');}
  const video=metadata.streams?.find((stream:{codec_type:string})=>stream.codec_type==='video');
  const audio=metadata.streams?.find((stream:{codec_type:string})=>stream.codec_type==='audio');
  const problem=videoPreparationError(Number(metadata.format?.duration),file.size);
  if(problem)throw new Error(problem);
  if(!video)throw new Error('This file does not contain a readable video.');
  if(!shouldCompressVideo(file.size,video.codec_name,audio?.codec_name??null,metadata.format?.format_name??'')){
   return file.type==='video/mp4'?file:new File([file],file.name.replace(/\.[^.]+$/,'')+'.mp4',{type:'video/mp4',lastModified:file.lastModified});
  }
  onProgress('Preparing a smaller video copy…');
  engine.on('progress',({progress})=>onProgress(`Preparing video: ${Math.max(0,Math.min(99,Math.round(progress*100)))}%`));
  const filter="scale='min(iw,if(gte(iw,ih),1280,720))':'min(ih,if(gte(iw,ih),720,1280))':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30";
  const exit=await engine.exec(['-i','source','-map','0:v:0','-map','0:a:0?','-sn','-dn','-map_metadata','-1',
   '-vf',filter,'-c:v','libx264','-preset','ultrafast','-b:v','3M','-maxrate','3M','-bufsize','6M','-pix_fmt','yuv420p',
   '-c:a','aac','-b:a','128k','-movflags','+faststart','upload.mp4'],150_000,{signal});
  if(exit!==0)throw new Error('Could not prepare this video on this device. Export a smaller H.264 MP4 and try again.');
  const data=await engine.readFile('upload.mp4',undefined,{signal});
  if(typeof data==='string'||!data.byteLength||data.byteLength>MAX_VIDEO_BYTES)throw new Error('The prepared video is still too large. Choose a smaller 720p recording.');
  return new File([new Uint8Array(data)],file.name.replace(/\.[^.]+$/,'')+'.mp4',{type:'video/mp4',lastModified:file.lastModified});
 };
 try{return await Promise.race([process(),stopped]);}
 catch(error){
  if(signal.aborted)throw aborted();
  if(error instanceof Error&&/^(Choose |Videos |This video |This file |Could not prepare |Video preparation |The prepared )/.test(error.message))throw error;
  throw new Error('Could not prepare this video on this device. Export a smaller 720p H.264 MP4 and try again. Your previous draft is kept.');
 }
 finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort);engine.terminate();}
}
