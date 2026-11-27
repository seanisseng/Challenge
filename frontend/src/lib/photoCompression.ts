/** Make an upload copy; keep originals and unsupported formats unchanged. */
const TARGET_BYTES=350*1024;
interface PhotoRenderer {
 encode:(edge:number,quality:number)=>Promise<Blob>;
 close:()=>void;
}

async function browserRenderer(file:File):Promise<PhotoRenderer> {
 const url=URL.createObjectURL(file);
 const image=new Image();
 try {
  await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Unsupported image'));image.src=url;});
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>50_000_000)throw new Error('Image too large to decode safely');
  const canvas=document.createElement('canvas');
  return {
   async encode(edge,quality){
    const scale=Math.min(1,edge/Math.max(image.naturalWidth,image.naturalHeight));
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('Image conversion unavailable');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Image conversion failed')),'image/jpeg',quality));
   },
   close(){canvas.width=0;canvas.height=0;image.src='';URL.revokeObjectURL(url);},
  };
 }catch(error){URL.revokeObjectURL(url);throw error;}
}

export async function compressPhoto(file:File,createRenderer:(file:File)=>Promise<PhotoRenderer>=browserRenderer):Promise<File> {
 const photo=/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)||(!file.type&&/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name));
 if(!photo||file.size<=TARGET_BYTES||file.size>25*1024*1024)return file;
 let renderer:PhotoRenderer|undefined;
 try {
  renderer=await createRenderer(file);
  let best:Blob=file;
  for(const [edge,quality] of [[1600,.82],[1600,.65],[1280,.65],[960,.6]]){
   const candidate=await renderer.encode(edge,quality);
   if(candidate.size>0&&candidate.size<best.size)best=candidate;
   if(best.size<=TARGET_BYTES)break;
  }
  return best===file?file:new File([best],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg',lastModified:file.lastModified});
 }catch{return file;}finally{renderer?.close();}
}
