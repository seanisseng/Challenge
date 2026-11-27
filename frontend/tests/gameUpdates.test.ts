import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mergeTeamGameUpdate,mergeAdminGameUpdate} from '../src/lib/gameUpdates.ts';
import type {TeamState,AdminState} from '../src/lib/types';
import type {TeamGameUpdate,AdminGameUpdate} from '../src/lib/gameUpdates';

test('game updates preserve map/identity and refuse other rooms or teams',()=>{
 const state={kind:'team',session:{id:'s'},team:{id:'t'},me:{id:'m'},map:{locations:[]},clues:[]} as unknown as TeamState;
 const event={kind:'team_update',session_id:'s',team_id:'t',changes:{clues:[{id:'reward'}]}} as TeamGameUpdate;
 const result=mergeTeamGameUpdate(state,event);
 assert.equal(result.map,state.map);assert.equal(result.me,state.me);assert.equal(result.clues[0].id,'reward');
 assert.equal(mergeTeamGameUpdate(state,{...event,team_id:'rival'}),state);
 assert.equal(mergeTeamGameUpdate(state,{...event,session_id:'other'}),state);
 const admin={kind:'admin',session:{id:'s'},teams:[],map:{locations:[]}} as unknown as AdminState;
 const update={kind:'admin_update',session_id:'s',changes:{submissions:[]}} as unknown as AdminGameUpdate;
 assert.equal(mergeAdminGameUpdate(admin,update).teams,admin.teams);
 assert.equal(mergeAdminGameUpdate(admin,update).map,admin.map);
 assert.equal(mergeAdminGameUpdate(admin,{...update,session_id:'other'}),admin);
});
