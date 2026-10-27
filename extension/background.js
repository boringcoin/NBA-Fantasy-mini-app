'use strict';
importScripts('team-context.js','sync-coordinator.js');
const BASE='http://127.0.0.1:18747';
let coordinator,configCache=null,coordination=Promise.resolve();
const ready=Promise.all([chrome.storage.session.get('coordinator'),chrome.storage.local.get('dailyByLeague')]).then(([session,local])=>{
  coordinator=new ThunderSyncCoordinator(session.coordinator);
  coordinator.daily={...coordinator.daily,...local.dailyByLeague};
});
function serial(fn){const result=coordination.then(fn,fn);coordination=result.catch(()=>{});return result;}
async function saveCoordinator(){await chrome.storage.session.set({coordinator:coordinator.saved()});}
async function leagueStatus(id,state,error=''){
  const saved=await chrome.storage.local.get('leagueStatus'),statuses=saved.leagueStatus||{};
  statuses[id]={state,error:String(error).slice(0,1200),time:Date.now()};
  await chrome.storage.local.set({leagueStatus:statuses});
}
function dailyDay(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date()),p=Object.fromEntries(parts.map(v=>[v.type,v.value]));
  return Number(p.hour)<16?null:`${p.year}-${p.month}-${p.day}`;
}
async function observeCommand(config){const command=await bridge('/refresh-request');coordinator.observe(command,config.leagues);await saveCoordinator();return command;}
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
  if(m.type==='popup-status'&&popup){const saved=await chrome.storage.local.get(['pairing','status','leagueStatus']);let appError=null,config=null;try{config=await configuration();}catch(e){appError=e.message;}return {ok:true,paired:!!saved.pairing,status:saved.status,leagueStatus:saved.leagueStatus||{},config,appError};}
  if(m.type==='request-refresh'&&popup){
    const config=await configuration(true),tabs=await chrome.tabs.query({url:'https://basketball.fantasysports.yahoo.com/nba/*'});
    const allowed=tabs.filter(tab=>{try{return config.leagues.some(l=>new URL(tab.url).pathname.startsWith('/nba/'+l.id+'/'));}catch{return false;}});
    if(!allowed.length)throw Error('未发现已配置的 Yahoo 联盟页面。请打开自己的 My Team 后刷新网页。');
    await bridge('/refresh-request',{});
    let notified=0;
    for(const tab of allowed){try{await chrome.tabs.sendMessage(tab.id,{type:'check-refresh'});notified++;}catch{}}
    if(!notified)throw Error('Yahoo 页面尚未加载同步扩展。请在球队网页按 Ctrl+R（Mac 为 ⌘R）刷新，然后重试。');
    return {ok:true};
  }
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
  if(['acquire-sync','release-sync','sync-heartbeat','snapshot','get-refresh-request','daily-power-due','daily-power-complete'].includes(m.type))return serial(async()=>{
    if(m.type==='get-refresh-request')return {ok:true,...await observeCommand(config)};
    const leagueID=m.type==='snapshot'?m.data?.leagueID:m.leagueID;
    const league=config.leagues.find(l=>l.id===leagueID);
    if(!league)throw Error('同步任务没有有效的联盟 ID；更新扩展后请刷新所有 Yahoo 标签页');
    if(m.type==='acquire-sync'){
      // Observe the desktop command before granting any lease. Completion belongs
      // to all target leagues, never to whichever tab finishes its batch first.
      await observeCommand(config);
      const lease=coordinator.acquire(leagueID,sender.tab.id,{requestID:m.requestID,todayOnly:m.todayOnly,daily:m.daily,day:dailyDay()});
      if(!lease)return {ok:false};
      await saveCoordinator();await leagueStatus(leagueID,'started');
      if(lease.day)await chrome.storage.local.set({dailyByLeague:coordinator.daily});
      if(m.requestID)await bridge('/refresh-status',{requestID:m.requestID,state:'started'}).catch(()=>{});
      return {ok:true,leaseID:lease.leaseID};
    }
    if(!coordinator.owns(leagueID,sender.tab.id,m.leaseID))throw Error('这个联盟的同步任务已失效，请重试');
    if(m.type==='daily-power-due'){
      const day=dailyDay(),saved=await chrome.storage.local.get('powerByLeague');
      return {ok:true,due:!!day&&saved.powerByLeague?.[leagueID]!==day,day};
    }
    if(m.type==='daily-power-complete'){
      const day=dailyDay();if(!day||m.day!==day)throw Error('每日战力同步日期已变化，请重试');
      const saved=await chrome.storage.local.get('powerByLeague'),days=saved.powerByLeague||{};days[leagueID]=day;
      await chrome.storage.local.set({powerByLeague:days});return {ok:true};
    }
    if(m.type==='snapshot'){
      coordinator.heartbeat(leagueID,sender.tab.id,m.leaseID);await saveCoordinator();
      await bridge('/snapshot',m.data);return {ok:true};
    }
    if(m.type==='sync-heartbeat'){
      coordinator.heartbeat(leagueID,sender.tab.id,m.leaseID);await saveCoordinator();return {ok:true};
    }
    const error=String(m.error||'').slice(0,1200);
    coordinator.finish(leagueID,sender.tab.id,m.leaseID,error);await saveCoordinator();
    await leagueStatus(leagueID,error?'error':'completed',error);
    const completion=coordinator.completion();
    if(completion){
      await bridge('/refresh-status',{...completion,state:'completed'});
      await chrome.storage.local.set({status:{ok:!completion.error,error:completion.error,time:Date.now()}});
    }
    return {ok:true};
  });
  if(m.type==='status'){await chrome.storage.local.set({status:{ok:m.ok,error:String(m.error||'').slice(0,1200),time:m.time}});return {ok:true};}
  throw Error('未知操作');
}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{message(m,sender).then(respond,e=>respond({ok:false,error:e.message}));return true;});
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create('today-owned',{periodInMinutes:10}));
chrome.runtime.onStartup.addListener(()=>chrome.alarms.create('today-owned',{periodInMinutes:10}));
chrome.alarms.onAlarm.addListener(async alarm=>{if(alarm.name!=='today-owned')return;const tabs=await chrome.tabs.query({url:'https://basketball.fantasysports.yahoo.com/nba/*'});for(const tab of tabs)chrome.tabs.sendMessage(tab.id,{type:'auto-sync'}).catch(()=>{});});
