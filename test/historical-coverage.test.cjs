'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('week 1 fetches every team even when the league home has no historical matchup links, without inventing actual pairings',async()=>{
  const snapshots=[],requests=[],players=[{id:'100',name:'Player',stats:{PTS:'1'},info:'AAA - PG'}];
  const ids=Array.from({length:16},(_,i)=>String(i+1));
  const ctx={URL,Date,AbortSignal,location:{pathname:'/nba/12345/1',origin:'https://basketball.fantasysports.yahoo.com',hostname:'basketball.fantasysports.yahoo.com'},setInterval:()=>{},clearInterval:()=>{},DOMParser:class{parseFromString(t){const d=JSON.parse(t);d.querySelectorAll=()=>[{textContent:'2026-27 Season'}];return d;}},fetch:async input=>{const url=new URL(input);requests.push(url.href);const week=url.searchParams.get('week')||'2';return {ok:true,url:url.href,text:async()=>JSON.stringify({url:url.href,body:{textContent:'Week '+week}})};},YahooParser:{setLeague:()=>{},leagueLinks:(doc,id,week)=>({teamIDs:ids,matchups:week==='1'?[]:Array.from({length:8},(_,i)=>({ids:[String(i*2+1),String(i*2+2)],url:`https://basketball.fantasysports.yahoo.com/nba/${id}/matchup?week=2&mid1=${i*2+1}&mid2=${i*2+2}`}))}),fromDocument:doc=>{const u=new URL(doc.url),a=u.searchParams.get('mid1')||'1',b=u.searchParams.get('mid2')||'2';return {columns:['PTS'],teams:[a,b].map(id=>({id,name:'Team '+id,stats:{PTS:id}})),players};}},chrome:{runtime:{onMessage:{addListener:()=>{}},sendMessage:async message=>{if(message.type==='snapshot')snapshots.push(structuredClone(message.data));return {ok:true};}}}};
  const source=fs.readFileSync(require.resolve('../extension/sync.js'),'utf8').replace('sync(null,true).finally(checkDaily);','globalThis.syncLeague=syncLeague;');vm.runInNewContext(source,ctx);
  await ctx.syncLeague({id:'12345',team:'1',name:'Demo'},false,false);
  const history=snapshots.flatMap(s=>s.powerHistory||[]).find(w=>w.week==='Week 1');assert.equal(history.teams.length,16);assert.equal(history.matchupPairs,null);
  assert.equal(requests.filter(u=>u.includes('week=1')&&u.includes('mid1=')).length,14);
});
test('backfill visits every missing earlier week, skips verified cache, and saves each week separately',async()=>{
  const snapshots=[],requested=[];
  const ctx={URL,Date,AbortSignal,location:{origin:'https://basketball.fantasysports.yahoo.com',pathname:'/nba/12345/1',hostname:'basketball.fantasysports.yahoo.com'},setInterval:()=>{},DOMParser:class{parseFromString(s){return JSON.parse(s);}},fetch:async input=>{const u=new URL(input),week=u.searchParams.get('week');requested.push(Number(week));return {ok:true,url:u.href,text:async()=>JSON.stringify({body:{textContent:'Week '+week}})};},YahooParser:{fromDocument:()=>({teams:[{id:'1'},{id:'2'}]})},chrome:{runtime:{onMessage:{addListener:()=>{}},sendMessage:async m=>{if(m.type==='snapshot')snapshots.push(structuredClone(m.data));return {ok:true};}}},makePower:async (_league,_doc,base)=>({week:base.week,teams:[],expectedTeamCount:4})};
  const source=fs.readFileSync(require.resolve('../extension/sync.js'),'utf8').replace('const power=await leaguePower(league,doc,{week:\'Week \'+prior,teams:parsed.teams},false)','const power=await globalThis.makePower(league,doc,{week:\'Week \'+prior,teams:parsed.teams},false)').replace('sync(null,true).finally(checkDaily);','globalThis.addHistory=addHistory;');
  vm.runInNewContext(source,ctx);
  const result={week:'Week 7'},base={seasonYear:2026,columns:['PTS']};
  await ctx.addHistory({id:'12345'},result,base,{seasonYear:2026,weeks:['Week 5','Week 2']});
  assert.deepEqual(requested,[6,4,3,1]);
  assert.deepEqual(snapshots.map(s=>s.powerHistory[0].week),['Week 6','Week 4','Week 3','Week 1']);
  assert.ok(snapshots.every(s=>s.powerHistory[0].historicalFinal===true));
});
