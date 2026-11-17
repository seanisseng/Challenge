import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyMapEvent,mergeMapSnapshot} from '../src/lib/gameMap.ts';
import type {GameMapState,DeviceLocation} from '../src/lib/gameMap.ts';
const base=():GameMapState=>({configured:true,initial_area:null,area:null,stage_count:2,stage_index:0,started_at:null,next_shrink_at:null,server_time:'2026-11-16T00:00:00Z',locations:[]});
const point:DeviceLocation={team_id:'team',team_name:'Team',device_id:'device',lat:1.3,lng:103.9,accuracy_m:10,updated_at:'2026-11-16T00:00:01Z',revision:2};
test('access revocation removes rivals and redacted snapshots cannot restore cached rivals',()=>{
 const own={...point,team_id:'own'};
 const current={...base(),can_track_teams:true,locations:[own,point]};
 const revoked=applyMapEvent(current,{kind:'map_access',session_id:'room',can_track_teams:false},'own')!;
 assert.deepEqual(revoked.locations,[own]);
 assert.deepEqual(applyMapEvent(revoked,{kind:'location',session_id:'room',location:{...point,revision:3}},'own')!.locations,[own]);
 assert.deepEqual(mergeMapSnapshot(current,{...base(),can_track_teams:false,locations:[own]})!.locations,[own]);
});
test('stop sharing tombstones reject delayed fixes and stale snapshots',()=>{
 let map=applyMapEvent(base(),{kind:'location',session_id:'room',location:point})!;
 map=applyMapEvent(map,{kind:'location_removed',session_id:'room',team_id:'team',device_id:'device',revision:3})!;
 assert.equal(map.locations.length,0);
 map=applyMapEvent(map,{kind:'location',session_id:'room',location:point})!;
 assert.equal(map.locations.length,0);
 assert.equal(mergeMapSnapshot(map,{...base(),locations:[point]})!.locations.length,0);
});
test('a current fix survives a matching or older game snapshot',()=>{
 const map=applyMapEvent(base(),{kind:'location',session_id:'room',location:point})!;
 assert.equal(mergeMapSnapshot(map,{...base(),locations:[point]})!.locations.length,1);
 assert.equal(mergeMapSnapshot(map,base())!.locations.length,1);
 const later={...base(),server_time:'2026-11-16T00:03:00Z'};
 assert.equal(mergeMapSnapshot(map,later)!.locations.length,0);
});
