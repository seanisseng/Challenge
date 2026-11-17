import assert from 'node:assert/strict';
import {test} from 'node:test';
import {aggregateTeamLocations} from '../src/lib/gameMap.ts';
const now=Date.parse('2026-11-18T00:00:00Z');
const fix=(device_id:string,lat:number,lng:number,accuracy_m=10)=>({team_id:'team',team_name:'Team',device_id,lat,lng,accuracy_m,revision:1,updated_at:new Date(now).toISOString()});
test('multiple devices produce one team tracker and preserve device membership',()=>{
 const result=aggregateTeamLocations([fix('a',1,103),fix('b',1,103.002)],now);
 assert.equal(result.length,1);assert.equal(result[0].device_count,2);
 assert.deepEqual(result[0].device_ids,['a','b']);assert.ok(Math.abs(result[0].lng-103.001)<.00001);
 assert.ok(result[0].accuracy_m>100);
});
test('more accurate readings contribute more and teams remain separate',()=>{
 const result=aggregateTeamLocations([fix('a',1,103,10),fix('b',1,104,100),{...fix('a',2,105),team_id:'other'}],now);
 assert.equal(result.length,2);assert.ok(result[0].lng<103.02);
});
test('stale devices expire and stopping one device preserves the other tracker',()=>{
 const a=fix('a',1,103),b={...fix('b',1,104),updated_at:new Date(now-120001).toISOString()};
 assert.equal(aggregateTeamLocations([a,b],now)[0].device_count,1);
 assert.equal(aggregateTeamLocations([a],now)[0].lng,103);
 assert.deepEqual(aggregateTeamLocations([b],now),[]);
});
test('averaging across the date line stays near the devices',()=>{
 const tracker=aggregateTeamLocations([fix('a',1,179.9),fix('b',1,-179.9)],now)[0];
 assert.ok(Math.abs(tracker.lng)>179);
});
