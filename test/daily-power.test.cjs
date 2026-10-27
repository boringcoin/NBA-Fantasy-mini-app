'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Coordinator=require('../extension/sync-coordinator.js');
test('daily league power marks each league only after success and retries after failure',async()=>{
  let now=Date.parse('2026-10-27T08:05:00Z');class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
  const local={pairing:{token:'token',clientID:'client'}},session={},save=x=>({get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(x[k])])),set:async values=>Object.assign(x,structuredClone(values)),remove:async key=>{delete x[key];}});
  class TimedCoordinator extends Coordinator{acquire(id,tab,options){return super.acquire(id,tab,options,now)}finish(id,tab,lease,error){return super.finish(id,tab,lease,error,now)}}
  const ext='a'.repeat(32),leagues=[{id:'101',team:'1'},{id:'102',team:'2'}];
  const bg={URL,Date:Clock,Intl,AbortSignal,ThunderSyncCoordinator:TimedCoordinator,importScripts:()=>{},fetch:async url=>({ok:true,json:async()=>url.endsWith('/config')?{leagues}:{}}),chrome:{storage:{session:save(session),local:save(local)},runtime:{id:ext,getURL:p=>`chrome-extension://${ext}/${p}`,onMessage:{addListener:()=>{}},onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}}},alarms:{onAlarm:{addListener:()=>{}}}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/background.js'),'utf8')+'\nglobalThis.dispatch=message;',bg);
  const sender=id=>({id:ext,url:`https://basketball.fantasysports.yahoo.com/nba/${id}/1`,tab:{id:Number(id)}});
  const lease=async id=>bg.dispatch({type:'acquire-sync',leagueID:id,todayOnly:true},sender(id));
  let a=await lease('101');let key={leagueID:'101',leaseID:a.leaseID};
  assert.equal((await bg.dispatch({type:'daily-power-due',...key},sender('101'))).due,true);
  await bg.dispatch({type:'release-sync',...key,error:'network'},sender('101'));now+=11*60*1000;
  a=await lease('101');key.leaseID=a.leaseID;assert.equal((await bg.dispatch({type:'daily-power-due',...key},sender('101'))).due,true);
  await bg.dispatch({type:'daily-power-complete',...key,day:'2026-10-27'},sender('101'));await bg.dispatch({type:'release-sync',...key,error:''},sender('101'));
  now+=11*60*1000;a=await lease('101');key.leaseID=a.leaseID;assert.equal((await bg.dispatch({type:'daily-power-due',...key},sender('101'))).due,false);
  const b=await lease('102'),other={leagueID:'102',leaseID:b.leaseID};assert.equal((await bg.dispatch({type:'daily-power-due',...other},sender('102'))).due,true);
  await bg.dispatch({type:'release-sync',...key,error:''},sender('101'));now=Date.parse('2026-10-28T08:05:00Z');a=await lease('101');key.leaseID=a.leaseID;assert.equal((await bg.dispatch({type:'daily-power-due',...key},sender('101'))).due,true);
});
