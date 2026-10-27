'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {State}=require('../core/state.cjs'),{createBridge}=require('../core/bridge.cjs');
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fantasy-import-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return new State(dir);}
const source='https://basketball.fantasysports.yahoo.com/nba/90001/6';
test('import from an exact Yahoo team page adds, selects, persists and queues first sync',async t=>{
  const s=await setup(t),l=s.importLeague({source:source+'?date=2026-10-26',name:'新用户联盟'});
  assert.deepEqual(l,{id:'90001',team:'6',name:'新用户联盟',theme:'white',dailyFreeAgents:false});
  assert.equal(s.data.selectedLeague,l.id);assert.equal(s.command.scope,'full');assert.equal(s.syncStatus.state,'waiting');
  assert.deepEqual(new State(s.dir).data.leagues,[l]);
});
test('reimport is idempotent and cannot silently change teams or report preferences',async t=>{
  const s=await setup(t);s.configure([{id:'90001',team:'6',name:'自定义名字',theme:'dark',dailyFreeAgents:true}]);
  s.data.snapshots['90001']={teamID:'6',league:'自定义名字',players:[]};
  assert.equal(s.importLeague({source,name:'网页名字'}).name,'自定义名字');assert.equal(s.data.leagues.length,1);assert.equal(s.data.leagues[0].theme,'dark');
  assert.throws(()=>s.importLeague({source:source.replace('/6','/7')}),/另一支球队/);assert.equal(s.data.snapshots['90001'].teamID,'6');
});
test('import refuses arbitrary URLs, matchup pages, oversized input and league count overflow',async t=>{
  const s=await setup(t);
  for(const bad of ['https://evil.example/nba/90001/6','http://basketball.fantasysports.yahoo.com/nba/90001/6','https://someone@basketball.fantasysports.yahoo.com/nba/90001/6',source+'/players',source.replace('/6','/49'),source.replace('/6','/0'),source.replace('/6','/matchup'),source.replace('/6',''),source.replace('/6','/6/../matchup'),'x'.repeat(2001)])assert.throws(()=>s.importLeague({source:bad}),bad);
  assert.equal(s.data.leagues.length,0);
  s.configure(Array.from({length:12},(_,i)=>({id:String(100+i),team:'1'})));
  assert.throws(()=>s.importLeague({source}),/12/);assert.equal(s.data.leagues.length,12);
});
test('browser import requires a paired extension; onChange publishes imported configuration',async t=>{
  const s=await setup(t);let changes=0;const server=createBridge(s,()=>changes++);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port,ext='b'.repeat(32),headers={'Content-Type':'application/json','X-Extension-ID':ext},post=(route,data,extra={})=>fetch(base+route,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(data)});
  assert.equal((await post('/import-league',{source})).status,401);
  const pair=await (await post('/pair',{code:s.newCode().code})).json();headers.Authorization='Bearer '+pair.token;headers['X-Client-ID']=pair.clientID;
  assert.equal((await post('/import-league',{source},{Origin:'https://basketball.fantasysports.yahoo.com'})).status,403);
  assert.equal((await post('/import-league',{source},{'X-Extension-ID':'c'.repeat(32)})).status,401);
  const r=await post('/import-league',{source,name:'网页联盟'});assert.equal(r.status,200);assert.equal((await r.json()).league.team,'6');assert.equal(changes,2);
  const conf=await (await fetch(base+'/config',{headers})).json();assert.equal(conf.leagues.length,1);
  assert.equal((await post('/import-league',{source:source.replace('/6','/7')})).status,400);
  s.revoke();assert.equal((await post('/import-league',{source})).status,401);
});
