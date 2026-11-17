import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createShrinkCursor,readShrinkUpdate} from '../src/lib/shrinkNotifications.ts';
const snapshot=(radius:number,time=1)=>({session:{id:'room',status:'active'},team:{id:'team'},map:{area:{radius_m:radius},stage_index:radius===5000?0:1,server_time:new Date(time*1000).toISOString()}});
test('joining an already smaller area establishes a baseline without an alert',()=>{
 const state=snapshot(1500);assert.equal(readShrinkUpdate(createShrinkCursor(state),state).notice,null);
});
test('a shrink alerts once; identical snapshots and stale snapshots do not replay it',()=>{
 const cursor=createShrinkCursor(snapshot(5000));const next=readShrinkUpdate(cursor,snapshot(1500,2));
 assert.equal(next.notice?.radius_m,1500);assert.equal(next.notice?.stage,2);
 assert.equal(readShrinkUpdate(next.cursor,snapshot(1500,3)).notice,null);
 assert.equal(readShrinkUpdate(next.cursor,snapshot(5000,1)).cursor.radius,1500);
});
test('expansion is silent and a later shrink alerts again',()=>{
 const reset=readShrinkUpdate(createShrinkCursor(snapshot(1500)),snapshot(5000,2));
 assert.equal(reset.notice,null);assert.ok(readShrinkUpdate(reset.cursor,snapshot(1500,3)).notice);
});
test('switching games or beginning a game does not announce old transitions',()=>{
 const initial=snapshot(5000);const cursor=createShrinkCursor(initial);
 assert.equal(readShrinkUpdate(cursor,{...snapshot(1500,2),session:{id:'other',status:'active'}}).notice,null);
 const lobby=createShrinkCursor({...initial,session:{id:'room',status:'lobby'}});
 assert.equal(readShrinkUpdate(lobby,snapshot(1500,2)).notice,null);
});
