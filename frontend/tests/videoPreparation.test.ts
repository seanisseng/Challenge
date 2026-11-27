import assert from 'node:assert/strict';
import {test} from 'node:test';
import {videoPreparationError,shouldCompressVideo} from '../src/lib/videoPolicy.ts';

test('30-second limit rejects longer clips without trimming',()=>{
 assert.equal(videoPreparationError(30,1000),null);
 assert.ok(videoPreparationError(30.1,1000));
 assert.ok(videoPreparationError(NaN,1000));
 assert.ok(videoPreparationError(0,1000));
 assert.ok(videoPreparationError(10,200*1024**2+1));
});
test('small compatible MP4 copies skip encoding',()=>{
 assert.equal(shouldCompressVideo(20*1024**2,'h264','aac','mp4'),false);
 assert.equal(shouldCompressVideo(1000,'h264',null,'mp4'),false);
 assert.equal(shouldCompressVideo(20*1024**2+1,'h264','aac','mp4'),true);
 assert.equal(shouldCompressVideo(1000,'hevc','aac','mp4'),true);
 assert.equal(shouldCompressVideo(1000,'vp9','opus','webm'),true);
});
