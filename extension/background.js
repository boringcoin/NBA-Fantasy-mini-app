'use strict';
importScripts('team-context.js');
const BASE='http://127.0.0.1:18747';
let lock=null,lastAuto=0,configCache=null;
const ready=chrome.storage.session.get(['syncLock','lastAuto']).then(v=>{lock=v.syncLock||null;lastAuto=v.lastAuto||0;});
async function credentials(){return (await chrome.storage.local.get('pairing')).pairing;}
async function bridge(route,body,auth=true){
  const headers={'Content-Type':'application/json','X-Extension-ID':chrome.runtime.id};
  if(auth){const pair=await credentials();if(!pair)throw Error('尚未配对，请输入桌面应用生成的配对码');headers.Authorization='Bearer '+pair.token;headers['X-Client-ID']=pair.clientID;}
  let r;try{r=await fetch(BASE+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch{throw Error('无法连接桌面应用，请先启动 Thunder Fantasy');}
  const result=await r.json();if(!r.ok)throw Error(result.error||'同步失败');return result;
}
async function configuration(force=false){if(!force&&configCache&&Date.now()-configCache.time<5000)return configCache.data;const data=await bridge('/config');configCache={time:Date.now(),data};return data;}
async function currentTeam(){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const context=ThunderTeamContext.fromURL(tab?.url);
  if(!context)throw Error('请先在当前标签打开自己的 Yahoo「My Team」球队页，再打开扩展。联盟首页或对局页面不能直接导入。');
  let page;try{page=await chrome.tabs.sendMessage(tab.id,{type:'team-context'});}catch{}
  const [latest]=await chrome.tabs.query({active:true,currentWindow:true});
  if(latest?.id!==tab.id||ThunderTeamContext.fromURL(latest?.url)?.source!==context.source||(page?.ok&&page.context?.source!==context.source))throw Error('当前球队页面已变化，请重新打开扩展，确认球队后再导入。');
  const valid=page?.ok&&page.context?.source===context.source;
  return {...context,tabID:tab.id,name:valid?String(page.context.name||'').slice(0,80):`联盟 ${context.id}`,teamName:valid?String(page.context.teamName||'').slice(0,100):'',needsReload:!valid};
}
async function message(m,sender){
  await ready;
  const popup=sender.id===chrome.runtime.id&&!sender.tab&&sender.url===chrome.runtime.getURL('popup.html');
  const content=sender.id===chrome.runtime.id&&sender.tab&&/^https:\/\/basketball\.fantasysports\.yahoo\.com\/nba\/\d+(?:\/|$)/.test(sender.url||'');
  if(!popup&&!content)throw Error('不允许的消息来源');
  if(m.type==='pair'&&popup){if(!/^\d{6}$/.test(String(m.code)))throw Error('请输入六位配对码');const paired=await bridge('/pair',{code:String(m.code)},false);await chrome.storage.local.set({pairing:{token:paired.token,clientID:paired.clientID}});configCache=null;await bridge('/refresh-request',{});return {ok:true};}
  if(m.type==='unpair'&&popup){await chrome.storage.local.remove('pairing');configCache=null;return {ok:true};}
  if(m.type==='get-config')return {ok:true,...await configuration(true)};
  if(m.type==='popup-status'&&popup){const saved=await chrome.storage.local.get(['pairing','status']);let appError=null,config=null;try{config=await configuration();}catch(e){appError=e.message;}return {ok:true,paired:!!saved.pairing,status:saved.status,config,appError};}
  if(m.type==='request-refresh'&&popup){await bridge('/refresh-request',{});return {ok:true};}
  if(m.type==='current-team'&&popup)return {ok:true,context:await currentTeam()};
  if(m.type==='import-team'&&popup){
    const context=await currentTeam();
    if(!m.source||context.source!==m.source)throw Error('当前球队页面已变化，请重新打开扩展，确认球队后再导入。');
    const result=await bridge('/import-league',{source:context.source,name:context.name});
    configCache=null;
    await chrome.tabs.sendMessage(context.tabID,{type:'check-refresh'}).catch(()=>{});
    return {...result,needsReload:context.needsReload,config:await configuration(true)};
  }
  if(!content)throw Error('该消息仅允许同步页面发送');
  const config=await configuration(),id=new URL(sender.url).pathname.match(/^\/nba\/(\d+)/)?.[1];if(!config.leagues.some(l=>l.id===id))throw Error('当前页面不属于配置的联盟');
  if(m.type==='acquire-sync'){
    if(lock&&Date.now()-lock.time<10*60*1000)return {ok:false};
    if(m.todayOnly&&Date.now()-lastAuto<9.5*60*1000)return {ok:false};
    lock={tab:sender.tab.id,time:Date.now()};if(m.todayOnly)lastAuto=Date.now();await chrome.storage.session.set({syncLock:lock,lastAuto});return {ok:true};
  }
  if(m.type==='release-sync'){if(lock?.tab===sender.tab.id){lock=null;await chrome.storage.session.remove('syncLock');}return {ok:true};}
  if(m.type==='acquire-daily'){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date()),p=Object.fromEntries(parts.map(v=>[v.type,v.value]));
    if(Number(p.hour)<16)return {ok:false};const day=`${p.year}-${p.month}-${p.day}`,saved=await chrome.storage.local.get('dailyDate');if(saved.dailyDate===day)return {ok:false};await chrome.storage.local.set({dailyDate:day});return {ok:true};
  }
  if(m.type==='snapshot'){if(lock?.tab!==sender.tab.id)throw Error('同步锁已释放，请重试');await bridge('/snapshot',m.data);return {ok:true};}
  if(m.type==='get-refresh-request')return {ok:true,...await bridge('/refresh-request')};
  if(m.type==='refresh-status'){await bridge('/refresh-status',{requestID:m.requestID,state:m.state,error:m.error||''});return {ok:true};}
  if(m.type==='status'){await chrome.storage.local.set({status:{ok:m.ok,error:String(m.error||'').slice(0,1200),time:m.time}});return {ok:true};}
  throw Error('未知操作');
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{message(m,sender).then(respond,e=>respond({ok:false,error:e.message}));return true;});
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create('today-owned',{periodInMinutes:10}));
chrome.runtime.onStartup.addListener(()=>chrome.alarms.create('today-owned',{periodInMinutes:10}));
chrome.alarms.onAlarm.addListener(async alarm=>{if(alarm.name!=='today-owned')return;const tabs=await chrome.tabs.query({url:'https://basketball.fantasysports.yahoo.com/nba/*'});for(const tab of tabs)chrome.tabs.sendMessage(tab.id,{type:'auto-sync'}).catch(()=>{});});
