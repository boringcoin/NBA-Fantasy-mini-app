'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('player sync does not erase historical failure; a successful full sync clears it',async()=>{
 const local={};const store={get:async()=>structuredClone(local),set:async x=>Object.assign(local,structuredClone(x))};
 const ctx={Date,URL,AbortSignal,Intl,importScripts:()=>{},ThunderSyncCoordinator:require('../extension/sync-coordinator.js'),chrome:{storage:{local:store,session:{get:async()=>({})}},runtime:{onMessage:{addListener:()=>{}},onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}}},alarms:{onAlarm:{addListener:()=>{}}}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../extension/background.js'),'utf8')+'\nglobalThis.record=leagueStatus;',ctx);
 await ctx.record('101','error','Week 1: 2/16','full');await ctx.record('101','completed','','today');assert.equal(local.leagueStatus['101'].lastFull.error,'Week 1: 2/16');
 await ctx.record('101','completed','','full');assert.equal(local.leagueStatus['101'].lastFull.state,'completed');assert.equal(local.leagueStatus['101'].lastFull.error,'');
});
