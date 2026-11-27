import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pendingReviewQueue} from '../src/lib/reviewQueue.ts';

test('pending proofs are oldest first without changing the incoming snapshot',()=>{
 const rows=[{id:'new',status:'pending',submitted_at:'2026-11-27T10:02:00Z'},
  {id:'reviewed',status:'approved',submitted_at:'2026-11-27T09:00:00Z'},
  {id:'old',status:'pending',submitted_at:'2026-11-27T10:00:00Z'}];
 const before=structuredClone(rows);
 assert.deepEqual(pendingReviewQueue(rows).map(row=>row.id),['old','new']);
 assert.deepEqual(rows,before);
});

test('new arrivals go last and equal timestamps have a stable order',()=>{
 const row={status:'pending',submitted_at:'2026-11-27T10:00:00Z'};
 assert.deepEqual(pendingReviewQueue([{...row,id:'b'},{...row,id:'a'},{...row,id:'later',submitted_at:'2026-11-27T10:01:00Z'}]).map(item=>item.id),['a','b','later']);
});
