import assert from 'node:assert/strict';
import {test} from 'node:test';
import {draftError} from '../src/lib/submissionDraft.ts';
test('at least one nonempty medium or message is required',()=>{
 assert.ok(draftError({files:[],text:' \n '}));assert.equal(draftError({files:[],text:'Answer'}),null);
 assert.equal(draftError({files:[new File(['image'],'a.jpg',{type:'image/jpeg'})],text:''}),null);
 assert.equal(draftError({files:[new File(['video'],'a.mp4',{type:'video/mp4'})],text:'Details'}),null);
});

test('Vercel attachment budget applies to images, videos and their combined size',()=>{
 const sized=(size:number,type='video/mp4')=>({name:'recording.mp4',type,size} as File);
 const budget=4*1024**2;
 for(const type of ['image/jpeg','video/mp4']){
  assert.equal(draftError({files:[sized(budget,type)],text:'x'.repeat(4000)}),null);
  assert.ok(draftError({files:[sized(budget+1,type)],text:''}));
 }
 assert.equal(draftError({files:[sized(budget/2,'image/jpeg'),sized(budget/2)],text:''}),null);
 assert.ok(draftError({files:[sized(budget/2,'image/jpeg'),sized(budget/2+1)],text:''}));
 assert.equal(draftError({files:[{name:'phone.MOV',type:'',size:100} as File],text:''}),null);
});
test('invalid, empty and excessive attachments are rejected',()=>{
 assert.ok(draftError({files:[new File([],'a.jpg',{type:'image/jpeg'})],text:''}));
 assert.ok(draftError({files:[new File(['x'],'x.pdf',{type:'application/pdf'})],text:''}));
 assert.ok(draftError({files:Array.from({length:11},(_,i)=>new File(['x'],`${i}.jpg`,{type:'image/jpeg'})),text:''}));
 assert.ok(draftError({files:[],text:'x'.repeat(4001)}));
});

test('a full-budget multipart submission leaves headroom below 4.5 MB',async()=>{
 const budget=4*1024**2;
 const files=Array.from({length:10},(_,index)=>new File(
  [new Uint8Array(index===0?budget-9:1)],`${'照'.repeat(250)}-${index}.jpg`,{type:'image/jpeg'},
 ));
 const text='😀'.repeat(2000);
 assert.equal(draftError({files,text}),null);
 const form=new FormData();
 form.append('challenge_id','00000000-0000-0000-0000-000000000000');
 for(const file of files)form.append('files',file);
 form.append('text',text);
 assert.ok((await new Response(form).arrayBuffer()).byteLength<4_500_000);
});
