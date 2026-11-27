export interface SubmissionDraft {files:File[];text:string}
export const MEDIA_ACCEPT='image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/webm,video/quicktime';
// Media goes directly to Storage; Vercel receives only control JSON.
export const MAX_SUBMISSION_BYTES=450*1024*1024;
export function mediaType(file:Pick<File,'name'|'type'>):string {
 if(file.type&&file.type!=='application/octet-stream')return file.type;
 const extension=file.name.split('.').pop()?.toLowerCase()??'';
 return ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',heic:'image/heic',heif:'image/heif',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm'} as Record<string,string>)[extension]??'';
}
export function draftError(draft:SubmissionDraft):string|null {
 if(!draft.files.length&&!draft.text.trim())return 'Add an image, a video, or a message.';
 if(draft.text.length>4000)return 'Keep the message to 4,000 characters.';
 if(draft.files.length>10)return 'Attach at most 10 files.';
 let total=0;
 for(const file of draft.files){
  const type=mediaType(file);
  if(!MEDIA_ACCEPT.split(',').includes(type))return 'Choose supported images or MP4, MOV, or WebM videos.';
  if(!file.size)return `${file.name} is empty.`;
  if(file.size>(type.startsWith('video/')?45:25)*1024*1024)return `${file.name} is too large. Prepared videos: 45 MiB; images: 25 MiB.`;
  total+=file.size;
 }
 return total>MAX_SUBMISSION_BYTES?'Attachments must total 450 MiB or less.':null;
}
