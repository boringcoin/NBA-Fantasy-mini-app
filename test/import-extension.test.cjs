'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=require('../extension/team-context.js');
const ORIGIN='https://basketball.fantasysports.yahoo.com',EXT='a'.repeat(32),SOURCE=ORIGIN+'/nba/90001/6';
test('team import accepts only a concrete Yahoo NBA team URL, never guesses from a matchup',()=>{
  assert.deepEqual(context.fromURL(SOURCE+'/?date=2026-10-23#roster'),{id:'90001',team:'6',source:SOURCE});
  for(const value of [ORIGIN+'/nba/90001',ORIGIN+'/nba/90001/matchup?mid1=6',ORIGIN+'/nba/90001/players',ORIGIN+'/nba/90001/6/edit',ORIGIN+'/nba/90001/0',ORIGIN+'/nba/90001/49',ORIGIN+'/nba/0/6',ORIGIN+'/nba/090001/6',ORIGIN+'/nba/90001/06',ORIGIN+'/nba/90001/%36',SOURCE.replace('https:','http:'),SOURCE.replace('yahoo.com','yahoo.com.evil.test'),SOURCE.replace('https://','https://user:pass@')])assert.equal(context.fromURL(value),null,value);
  const name='<img src=x onerror=alert(1)> League';
  const doc={querySelectorAll:()=>[{getAttribute:()=>'/nba/90001',textContent:name+' (ID# 90001)'}],querySelector:()=>({textContent:'  My   Team  '})};
  assert.equal(context.fromDocument(doc,SOURCE).name,name);assert.equal(context.fromDocument(doc,SOURCE).teamName,'My Team');
});
function background(){
  const state={tab:{id:7,url:SOURCE},requests:[],messages:[],leagues:[],paired:true,contextAvailable:true,afterMetadata:null,reloads:0,reloadedTabs:[],store:{},marker:null,extensionConfig:{}};
  const sandbox={URL,Date,AbortSignal,ThunderSyncCoordinator:require('../extension/sync-coordinator.js'),ThunderTeamContext:context,importScripts:()=>{},fetch:async(url,options)=>{
    state.requests.push({url,options,body:options?.body&&JSON.parse(options.body)});
    if(url.endsWith('/managed.json'))return {ok:true,json:async()=>state.marker};
    if(url.endsWith('/import-league')){state.leagues=[{id:'90001',team:'6',name:'Demo League'}];return {ok:true,json:async()=>({ok:true,league:state.leagues[0]})};}
    return {ok:true,json:async()=>({leagues:state.leagues,...state.extensionConfig})};
  },chrome:{runtime:{id:EXT,getManifest:()=>({version:'2.0.6'}),reload:()=>state.reloads++,getURL:file=>`chrome-extension://${EXT}/${file}`,onMessage:{addListener:()=>{}},onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}}},storage:{session:{get:async()=>({}),set:async()=>{},remove:async()=>{}},local:{get:async()=>({...state.store,...(state.paired?{pairing:{token:'test-pair-token',clientID:'test-client'}}:{})}),set:async v=>Object.assign(state.store,v),remove:async k=>{delete state.store[k];}}},tabs:{query:async query=>{if(!query.url)assert.deepEqual(JSON.parse(JSON.stringify(query)),{active:true,currentWindow:true});return [{...state.tab}];},reload:async id=>state.reloadedTabs.push(id),sendMessage:async(id,message)=>{state.messages.push(message.type);assert.equal(id,7);if(!state.contextAvailable)throw Error('No receiver');const result={ok:true,context:{...context.fromURL(state.tab.url),name:'Demo League',teamName:'My Team'}};if(message.type==='team-context'&&state.afterMetadata)state.afterMetadata();return result;}},alarms:{create:()=>{},onAlarm:{addListener:()=>{}}}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/background.js'),'utf8')+'\nglobalThis.callMessage=message;',sandbox);
  state.call=(message,sender={id:EXT,url:`chrome-extension://${EXT}/popup.html`})=>sandbox.callMessage(message,sender);
  return state;
}
test('paired popup imports its currently previewed team and refreshes configuration without broad permissions',async()=>{
  const s=background();const preview=await s.call({type:'current-team'});assert.equal(preview.context.source,SOURCE);assert.equal(preview.context.name,'Demo League');assert.equal(preview.context.needsReload,false);
  const result=await s.call({type:'import-team',source:preview.context.source});assert.equal(result.league.team,'6');assert.equal(result.config.leagues.length,1);
  const request=s.requests.find(r=>r.url.endsWith('/import-league'));assert.deepEqual(request.body,{source:SOURCE,name:'Demo League'});assert.equal(request.options.headers.Authorization,'Bearer test-pair-token');assert.ok(s.messages.includes('check-refresh'));
  const manifest=require('../extension/manifest.json');assert.ok(!manifest.permissions.includes('tabs'));assert.ok(!manifest.permissions.includes('cookies'));assert.ok(manifest.content_scripts[0].js.includes('team-context.js'));
});
test('import prevents stale-page selection and messages from web/content scripts; new installs can import by URL',async()=>{
  const s=background();s.tab.url=ORIGIN+'/nba/90001/7';await assert.rejects(s.call({type:'import-team',source:SOURCE}),/页面已变化/);assert.equal(s.requests.length,0);
  s.tab.url=SOURCE;s.contextAvailable=false;const preview=await s.call({type:'current-team'});assert.equal(preview.context.needsReload,true);assert.equal(preview.context.name,'联盟 90001');
  await assert.rejects(s.call({type:'import-team',source:SOURCE},{id:'b'.repeat(32),url:`chrome-extension://${EXT}/popup.html`}),/不允许/);
  await assert.rejects(s.call({type:'import-team',source:SOURCE},{id:EXT,url:SOURCE,tab:{id:7}}),/当前页面不属于配置/);
  assert.ok(!s.requests.some(r=>r.url.endsWith('/import-league')));
  s.paired=false;await assert.rejects(s.call({type:'import-team',source:SOURCE}),/尚未配对/);
});
test('import rechecks the active team after reading metadata to reject navigation and tab switches',async()=>{
  for(const change of [s=>{s.tab.url=ORIGIN+'/nba/90001/7';},s=>{s.tab.id=8;},s=>{s.tab.url=ORIGIN+'/nba/90001/matchup';}]){
    const s=background();s.afterMetadata=()=>change(s);
    await assert.rejects(s.call({type:'import-team',source:SOURCE}),/页面已变化/);
    assert.equal(s.requests.length,0);
  }
});

test('managed extension reloads only after matching instance and version, and pages refresh only on user action',async()=>{
  const s=background();s.extensionConfig={extensionVersion:'2.0.7',extensionInstance:'local-instance'};s.marker={version:'2.0.7',instance:'wrong-instance'};
  await s.call({type:'get-config'});assert.equal(s.reloads,0);
  s.marker.instance='local-instance';await s.call({type:'get-config'});assert.equal(s.reloads,1);assert.equal(s.store.reloadPagesRequired,true);assert.equal(s.reloadedTabs.length,0);
  s.leagues=[{id:'90001',team:'6'}];await s.call({type:'reload-pages'});assert.deepEqual(s.reloadedTabs,[7]);assert.equal(s.store.reloadPagesRequired,undefined);
});
