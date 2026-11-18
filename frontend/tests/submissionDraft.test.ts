import assert from 'node:assert/strict';
import {test} from 'node:test';
import {draftError} from '../src/lib/submissionDraft.ts';
test('at least one nonempty medium or message is required',()=>{
 assert.ok(draftError({files:[],text:' \n '}));assert.equal(draftError({files:[],text:'Answer'}),null);
 assert.equal(draftError({files:[new File(['image'],'a.jpg',{type:'image/jpeg'})],text:''}),null);
 assert.equal(draftError({files:[new File(['video'],'a.mp4',{type:'video/mp4'})],text:'Details'}),null);
});

test('phone source and aggregate size limits are checked without reading files',()=>{
 const sized=(size:number,type='video/mp4')=>({name:'recording.mp4',type,size} as File);
 assert.equal(draftError({files:[sized(1024**3)],text:''}),null);
 assert.ok(draftError({files:[sized(1024**3+1)],text:''}));
 assert.ok(draftError({files:[sized(25*1024**2+1,'image/jpeg')],text:''}));
 assert.ok(draftError({files:[sized(1024**3),sized(1024**3),sized(1)],text:''}));
 assert.equal(draftError({files:[{name:'phone.MOV',type:'',size:100} as File],text:''}),null);
});
test('invalid, empty and excessive attachments are rejected',()=>{
 assert.ok(draftError({files:[new File([],'a.jpg',{type:'image/jpeg'})],text:''}));
 assert.ok(draftError({files:[new File(['x'],'x.pdf',{type:'application/pdf'})],text:''}));
 assert.ok(draftError({files:Array.from({length:11},(_,i)=>new File(['x'],`${i}.jpg`,{type:'image/jpeg'})),text:''}));
 assert.ok(draftError({files:[],text:'x'.repeat(4001)}));
});
