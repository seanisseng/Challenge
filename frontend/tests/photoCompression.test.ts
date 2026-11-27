import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compressPhoto} from '../src/lib/photoCompression.ts';

test('large photos become smaller JPEG copies and release decoded images',async()=>{
 const source=new File([new Uint8Array(5*1024**2)],'phone.png',{type:'image/png',lastModified:123});
 let closed=false;
 const result=await compressPhoto(source,async()=>({encode:async()=>new Blob([new Uint8Array(200_000)],{type:'image/jpeg'}),close:()=>{closed=true;}}));
 assert.equal(result.name,'phone.jpg');assert.equal(result.type,'image/jpeg');
 assert.equal(result.size,200_000);assert.equal(result.lastModified,123);
 assert.equal(source.size,5*1024**2);assert.ok(closed);
});
test('small files and videos do not invoke image decoding',async()=>{
 const fail=async()=>{throw new Error('should not decode');};
 for(const source of [new File(['x'],'tiny.jpg',{type:'image/jpeg'}),new File([new Uint8Array(500_000)],'clip.mp4',{type:'video/mp4'})]){
  assert.equal(await compressPhoto(source,fail),source);
 }
});
test('unsupported decoders and larger re-encodings preserve the original',async()=>{
 const source=new File([new Uint8Array(500_000)],'photo.heic',{type:'image/heic'});
 assert.equal(await compressPhoto(source,async()=>{throw new Error('unsupported codec');}),source);
 assert.equal(await compressPhoto(source,async()=>({encode:async()=>new Blob([new Uint8Array(600_000)]),close(){}})),source);
});
