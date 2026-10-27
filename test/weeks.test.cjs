'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');

test('all earlier weeks are selectable even before synchronization',()=>{
  const {availableWeeks}=require('../core/weeks.cjs');
  const list=availableWeeks({week:'Week 9'});
  assert.equal(list.length,9);
  assert.ok(list.some(w=>w.week==='Week 1'&&!w.available));
});
