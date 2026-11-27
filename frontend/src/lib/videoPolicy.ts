export const MAX_VIDEO_SOURCE_BYTES=200*1024*1024;
export const TARGET_VIDEO_BYTES=20*1024*1024;
export const MAX_VIDEO_BYTES=45*1024*1024;
export function videoPreparationError(duration:number,size:number):string|null {
 if(size>MAX_VIDEO_SOURCE_BYTES)return 'Choose a video smaller than 200 MiB. Export a smaller copy first.';
 if(!Number.isFinite(duration)||duration<=0)return 'This video could not be read. Choose another clip.';
 if(duration>30)return 'Videos must be 30 seconds or shorter. Trim this video before attaching it.';
 return null;
}
export function shouldCompressVideo(size:number,videoCodec:string,audioCodec:string|null,format:string):boolean {
 return size>TARGET_VIDEO_BYTES||videoCodec!=='h264'||(audioCodec!==null&&audioCodec!=='aac')||!format.split(',').includes('mp4');
}
