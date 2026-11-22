'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{historicalOpponent}=require('../extension/parser.js');
function anchor(href,text){return {getAttribute:()=>href,parentElement:{textContent:text,parentElement:null}}}
test('historical opponent must match exact week and league',()=>{const doc={querySelectorAll:()=>[anchor('/nba/1061/9','Week 4 vs Other'),anchor('/nba/1061/12','Week 3 vs Tiger Team'),anchor('https://example.com/nba/1061/8','Week 3 vs Other')]};assert.equal(historicalOpponent(doc,'1061','3','1'),'12');assert.equal(historicalOpponent(doc,'1061','2','1'),null);assert.equal(historicalOpponent(doc,'1061','3','12'),null);});
