'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{dayKey,espnDateForBeijing}=require('../core/score.cjs');
test('Beijing dates map to the ESPN US game day across midnight and daylight saving',()=>{assert.equal(dayKey(new Date('2026-11-19T06:07:49Z')),'20261119');assert.equal(espnDateForBeijing('20261119'),'20261118');assert.equal(espnDateForBeijing('20270101'),'20261231');assert.equal(espnDateForBeijing('20260309'),'20260308');assert.throws(()=>espnDateForBeijing('20260230'));});
