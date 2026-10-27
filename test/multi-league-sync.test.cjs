'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Coordinator=require('../extension/sync-coordinator.js'),parser=require('../extension/parser.js');
const leagues=[{id:'90001',team:'1',name:'First'},{id:'90002',team:'13',name:'Second'}];
test('separate league leases, independent auto limits, heartbeat recovery and stale-release protection',()=>{
  const c=new Coordinator(),now=2000000;
  const a=c.acquire('90001',1,{todayOnly:true},now),b=c.acquire('90002',2,{todayOnly:true},now);
  assert.ok(a&&b);assert.equal(c.acquire('90001',2,{},now),null);
  assert.ok(c.finish('90001',1,a.leaseID,'',now));
  assert.equal(c.acquire('90001',2,{todayOnly:true},now+1000),null);
  assert.ok(c.acquire('90003',3,{todayOnly:true},now+1000));
  assert.ok(c.heartbeat('90002',2,b.leaseID,now+80000));
  assert.equal(c.acquire('90002',3,{},now+100000),null);
  const replacement=c.acquire('90002',3,{},now+180000);assert.ok(replacement);
  assert.equal(c.finish('90002',2,b.leaseID),false);
  assert.ok(new Coordinator(c.saved()).owns('90002',3,replacement.leaseID));
});
test('a manual refresh completes after every target league, with per-league failures retained',()=>{
  const c=new Coordinator(),command={requestID:'job-1'};c.observe(command,leagues);
  const a=c.acquire('90001',1,{requestID:command.requestID}),b=c.acquire('90002',2,{requestID:command.requestID});
  c.finish('90001',1,a.leaseID);assert.equal(c.completion(),null);
  assert.equal(c.acquire('90001',2,{requestID:command.requestID}),null);
  assert.equal(c.acquire('90002',3,{todayOnly:true}),null);
  c.finish('90002',2,b.leaseID,'HTTP 429');
  assert.deepEqual(c.completion(),{requestID:'job-1',error:'联盟 90002：HTTP 429'});
  c.observe({requestID:'job-2',leagueID:'90002'},leagues);
  assert.ok(c.acquire('90002',2,{requestID:'job-2'}));assert.equal(c.acquire('90001',1,{requestID:'job-2'}),null);
});
test('daily work is once per league, not once for the browser',()=>{
  const c=new Coordinator(),o={daily:true,day:'2026-10-27'};
  const a=c.acquire('90001',1,o);c.finish('90001',1,a.leaseID);
  assert.equal(c.acquire('90001',2,o),null);assert.ok(c.acquire('90002',2,o));
  const restarted=new Coordinator({daily:structuredClone(c.daily)});
  assert.equal(restarted.acquire('90001',3,o),null);assert.equal(restarted.acquire('90002',3,o),null);
});
function harness({matchupMissing=false}={}){
  const command={requestID:'two-pages',scope:'full'},snapshots=[],acks=[],local={pairing:{token:'test',clientID:'test'}},session={};let activeCommand=command;
  const store=values=>({get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(values[k])])),set:async v=>Object.assign(values,structuredClone(v)),remove:async k=>{delete values[k];}});
  const ext='a'.repeat(32),bg={URL,Date,Intl,AbortSignal,ThunderSyncCoordinator:Coordinator,importScripts:()=>{},fetch:async(url,options)=>{
    const body=options.body&&JSON.parse(options.body);let result={};
    if(url.endsWith('/config'))result={leagues};
    if(url.endsWith('/refresh-request'))result=activeCommand||{};
    if(url.endsWith('/snapshot'))snapshots.push(body);
    if(url.endsWith('/refresh-status')){acks.push(body);if(body.state==='completed')activeCommand=null;}
    return {ok:true,json:async()=>result};
  },chrome:{storage:{session:store(session),local:store(local)},runtime:{id:ext,getURL:f=>`chrome-extension://${ext}/${f}`,onMessage:{addListener:()=>{}},onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}}},alarms:{onAlarm:{addListener:()=>{}}}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/background.js'),'utf8')+'\nglobalThis.dispatch=message;',bg);
  function page(league,tab){
    const callbacks=[],location={pathname:`/nba/${league.id}/${league.team}`,origin:'https://basketball.fantasysports.yahoo.com',hostname:'basketball.fantasysports.yahoo.com'};
    const own={id:String(1000+tab),name:'Player '+tab,stats:{PTS:'20',GP:'5'},info:'AAA - PG vs BBB'};
    const ctx={URL,Date,AbortSignal,location,setInterval:()=>{},clearInterval:()=>{},YahooParser:{setLeague:()=>{},leagueLinks:(_doc,id,week,origin)=>{
      const own=leagues.find(l=>l.id===id).team;
      return {teamIDs:[own,'2','3','4'],matchups:[[own,'2'],['3','4']].map(ids=>({ids,url:`${origin}/nba/${id}/matchup?week=${week}&mid1=${ids[0]}&mid2=${ids[1]}&date=totals`}))};
    },fromDocument:doc=>{
      const id=new URL(doc.url).pathname.split('/')[2],l=leagues.find(l=>l.id===id);
      const url=new URL(doc.url),ids=[url.searchParams.get('mid1')||l.team,url.searchParams.get('mid2')||'2'];
      return {columns:parser.columns,teams:matchupMissing&&id==='90002'?[]:ids.map(id=>({id,name:'Team '+id,stats:{}})),players:[{...own,id:String(Number(id)+100),name:'Player of '+id}]};
    }},DOMParser:class{parseFromString(text){const d=JSON.parse(text);d.querySelectorAll=()=>[{textContent:'2026-27 Season'}];return d;}},fetch:async url=>{
      // Yield to allow both pages to claim work concurrently.
      await new Promise(r=>setImmediate(r));return {ok:true,url:String(url),text:async()=>JSON.stringify({url:String(url),body:{textContent:'Week 1'}})};
    },chrome:{runtime:{onMessage:{addListener:f=>callbacks.push(f)},sendMessage:async m=>{try{return await bg.dispatch(structuredClone(m),{id:ext,url:location.origin+location.pathname,tab:{id:tab}});}catch(e){return {ok:false,error:e.message};}}}}};
    const source=fs.readFileSync(require.resolve('../extension/sync.js'),'utf8').replace('sync(null,true).finally(checkDaily);','globalThis.fullSync=sync;');vm.runInNewContext(source,ctx);return ctx;
  }
  return {snapshots,acks,local,pages:[page(leagues[0],7),page(leagues[1],8)]};
}
test('two actual content-script tabs sync both leagues once and acknowledge only after both finish',async()=>{
  const h=harness();await Promise.all(h.pages.map(p=>p.fullSync('two-pages',false,false)));
  assert.deepEqual([...new Set(h.snapshots.map(s=>s.leagueID))].sort(),['90001','90002']);
  for(const league of leagues){const rows=h.snapshots.filter(s=>s.leagueID===league.id);assert.equal(rows.length,2);assert.ok(rows.every(s=>s.teamID===league.team));assert.ok(rows.every(s=>s.players[0].name==='Player of '+league.id));assert.equal(h.local.leagueStatus[league.id].state,'completed');}
  assert.equal(h.acks.filter(a=>a.state==='completed').length,1);
  assert.equal(h.acks.at(-1).error,'');
});
test('a missing matchup cannot block the second roster, and one tab can sync both leagues',async()=>{
  const h=harness({matchupMissing:true});await h.pages[0].fullSync('two-pages',false,false);
  const second=h.snapshots.filter(s=>s.leagueID==='90002').at(-1);assert.ok(second);
  assert.equal(second.players.length,1);assert.equal(second.teams.length,0);assert.match(second.matchupError,/本周对局/);
  assert.equal(second.research.season.length,1);assert.equal(h.acks.filter(a=>a.state==='completed').length,1);
  assert.equal(h.local.leagueStatus['90001'].state,'completed');assert.equal(h.local.leagueStatus['90002'].state,'error');
  assert.match(h.acks.at(-1).error,/90002/);assert.ok(!h.acks.at(-1).error.includes('90001'));
});
