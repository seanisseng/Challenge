import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shrinkTimeline} from '../src/lib/shrinkTimeline.ts';
const stages=[{after_seconds:0},{after_seconds:600},{after_seconds:null},{after_seconds:1200}];
test('timeline drains the next interval and omits manual-only markers',()=>{
 const value=shrinkTimeline(stages,570,0,true);
 assert.equal(value.remaining,30);assert.equal(value.nextStage,1);
 assert.equal(value.remainingPercent,5);assert.equal(value.warning,true);
 assert.deepEqual(value.markers.map(x=>x.seconds),[0,600,1200]);
});
test('at a boundary the next interval starts; rewinding restores earlier stage timing',()=>{
 assert.equal(shrinkTimeline(stages,600,1,true).remaining,600);
 assert.equal(shrinkTimeline(stages,120,0,true).remaining,480);
 assert.equal(shrinkTimeline(stages,1200,3,true).remaining,null);
});
test('stopped and manual-only plans have no live countdown',()=>{
 assert.equal(shrinkTimeline(stages,0,0,false).remaining,null);
 assert.equal(shrinkTimeline([{after_seconds:0},{after_seconds:null}],0,0,true).duration,0);
});
