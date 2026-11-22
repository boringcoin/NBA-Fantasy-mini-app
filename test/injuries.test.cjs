'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalize,changes}=require('../core/injuries.cjs');
test('injuries reject incomplete feed and notify only after baseline changes',()=>{
 assert.throws(()=>normalize({injuries:[]}));
 const raw={injuries:Array.from({length:20},(_,i)=>({displayName:'Team',injuries:i?[]:[{athlete:{id:1,displayName:'Player'},status:'Out',details:{type:'Knee'},longComment:'News'}]}))};
 const players=normalize(raw);const first=changes(['Player'],{},players);assert.deepEqual(first.alerts,[]);
 assert.deepEqual(changes(['Player'],first.baseline,players).alerts,[]);
 const changed=changes(['Player'],first.baseline,[{...players[0],status:'Questionable'}]);assert.deepEqual(changed.alerts,['Player']);
 assert.deepEqual(changes(['Player'],first.baseline,[]).alerts,[]);
});
