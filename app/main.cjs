'use strict';
const {app,BrowserWindow,ipcMain,Menu,dialog,shell,protocol,session,net,Notification}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const {State}=require('../core/state.cjs'),{createBridge}=require('../core/bridge.cjs'),{analyze,playerValues}=require('../core/analysis.cjs'),exportsCore=require('../core/export.cjs'),{dayKey,scoreboardDays,espnDateForBeijing}=require('../core/score.cjs');
const {Updater,pruneCache}=require('../core/update.cjs'),{startInstall,finishInstall}=require('../core/update-install.cjs'),{managedExtension}=require('../core/extension-files.cjs');
const {availableWeeks,powerSnapshot}=require('../core/weeks.cjs');
const {seasonPower}=require('../core/season-power.cjs');
const injuryCore=require('../core/injuries.cjs');
const dailyCore=require('../core/daily-rank.cjs');
const {weeklyMVP}=require('../core/weekly-mvp.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const args=process.argv.slice(1),argument=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];},smoke=args.includes('--smoke-test'),exportPath=argument('--export');
app.setName('Thunder Fantasy');
if(process.platform==='win32')app.setAppUserModelId('app.thunderfantasy.desktop');
if(smoke&&argument('--data-dir'))app.setPath('userData',path.resolve(argument('--data-dir')));
if(!exportPath&&!smoke&&!app.requestSingleInstanceLock()){app.quit();}else{
let updater,managed,updateTimer,updateInterval,installing=false,injuryTimer,injuryBusy=false;
let injury={players:[],updatedAt:null,error:null,followed:[],baseline:{}};
let preferences={fontScale:1,reportPath:''};
async function saveExtra(){await fs.writeFile(path.join(app.getPath('userData'),'thunder-extra.json'),JSON.stringify({followed:injury.followed,baseline:injury.baseline,players:injury.players,updatedAt:injury.updatedAt,preferences}));}
async function refreshInjuries(){if(injuryBusy)return;injuryBusy=true;try{const players=injuryCore.normalize(await requestJSON('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries'));const result=injuryCore.changes(injury.followed,injury.baseline,players);injury={...injury,players,baseline:result.baseline,updatedAt:new Date().toISOString(),error:null};await saveExtra();for(const name of result.alerts)if(Notification.isSupported())new Notification({title:'球员伤病更新',body:name+'：伤病状态或新闻有更新，请打开伤病报告查看。'}).show();}catch(e){injury.error=e.message;}finally{injuryBusy=false;changed();clearTimeout(injuryTimer);if(!app.isQuitting)injuryTimer=setTimeout(refreshInjuries,600000);}}
let win,state,bridge,reportWindows=new Set(),exporting=false,score={events:[],featured:null,summary:null,updatedAt:null,error:null},scoreBusy=false,summaryID=null,scoreTimer,scheduleCache=null;
let daily={date:null,players:[],updatedAt:null,error:null,failed:[],games:0,loading:false},dailyTimer;
async function refreshDaily(date,followToday=false){const espnDate=espnDateForBeijing(date);if(daily.loading)return daily;daily={...daily,...(daily.date!==date?{players:[],games:0,started:0,updatedAt:null,failed:[]}:{}),date,followToday,loading:true,error:null};changed();try{const feed=await requestJSON(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${espnDate}&limit=200`),events=(feed.events||[]).filter(e=>e.date&&dayKey(new Date(e.date),'Asia/Shanghai')===date),eligible=events.filter(e=>e.status?.type?.state!=='pre');const results=await Promise.allSettled(eligible.map(async event=>({event,detail:await summary(event.id)})));const games=results.filter(r=>r.status==='fulfilled').map(r=>r.value),failed=results.flatMap((r,i)=>r.status==='rejected'?[eligible[i].shortName||eligible[i].name]:[]);daily={date,followToday,players:dailyCore.parseGames(games),games:events.length,started:eligible.length,failed,updatedAt:new Date().toISOString(),error:null,loading:false};}catch(e){daily={...daily,loading:false,error:e.message};}changed();clearTimeout(dailyTimer);if(!app.isQuitting)dailyTimer=setTimeout(()=>refreshDaily(followToday?dayKey(new Date()):date,followToday),60000);return daily;}
function status(){return {...state.public(),updater:updater?.state,managedExtension:managed?.directory,score,daily,injury:{players:injury.players,updatedAt:injury.updatedAt,error:injury.error,followed:injury.followed},preferences,powerWeeks:Object.fromEntries(Object.entries(state.data.snapshots).map(([id,s])=>[id,availableWeeks(s)])),seasonPowers:Object.fromEntries(Object.entries(state.data.snapshots).map(([id,s])=>[id,seasonPower(s)])),analyses:Object.fromEntries(Object.entries(state.data.snapshots).map(([id,s])=>[id,analyze(s)]))};}
function changed(){if(win&&!win.isDestroyed())win.webContents.send('changed',status());}
async function requestJSON(url){const response=await net.fetch(url,{signal:AbortSignal.timeout(15000),headers:{'Accept':'application/json'}});if(!response.ok)throw Error('比分数据暂不可用（'+response.status+'）');return response.json();}
async function summary(id){if(!/^\d+$/.test(id))throw Error('比赛 ID 无效');return requestJSON('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='+id);}
async function refreshScore(force=false){
  if(scoreBusy)return;scoreBusy=true;
  try{
    const now=Date.now(),calendarDay=dayKey(new Date(now));
    let games;
    if(!force&&scheduleCache&&scheduleCache.day===calendarDay&&now-scheduleCache.time<600000)games=scheduleCache.games;
    else {
      const feeds=await Promise.all(scoreboardDays(now).map(day=>requestJSON(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day}&limit=200`)));
      games=[...new Map(feeds.flatMap(data=>data.events||[]).filter(e=>e.competitions?.[0]?.competitors?.some(c=>c.team?.abbreviation==='OKC')).map(e=>[e.id,e])).values()].sort((a,b)=>new Date(a.date)-new Date(b.date));
      scheduleCache={games,day:calendarDay,time:now};
    }
    const live=games.find(e=>e.status?.type?.state==='in'),today=games.filter(e=>dayKey(new Date(e.date))===dayKey(new Date(now))),recent=today.filter(e=>e.status?.type?.completed).sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
    let featured=live||recent||games.find(e=>new Date(e.date)>now)||games.at(-1)||null;
    const details=featured?await summary(featured.id).catch(()=>null):null;
    if(featured&&details?.header?.competitions?.[0]){const competition=details.header.competitions[0];featured={...featured,competitions:[competition],status:competition.status||featured.status};games=games.map(g=>g.id===featured.id?featured:g);scheduleCache.games=games;}
    score={events:games,featured,summary:details||(featured?.id===score.featured?.id?score.summary:null),updatedAt:new Date().toISOString(),error:null};
    if(summaryID&&featured?.id!==summaryID){score.selectedSummary=await summary(summaryID).catch(()=>null);score.selectedSummaryID=summaryID;}
  }catch(e){score.error=e.message;}finally{scoreBusy=false;changed();clearTimeout(scoreTimer);if(!app.isQuitting)scoreTimer=setTimeout(refreshScore,score.featured?.status?.type?.state==='in'?15000:60000);}
}
async function refresh(scope='full'){state.refresh(scope);changed();if(!smoke)void refreshScore(true);}
function windowOptions(extra={}){return {width:1200,height:850,minWidth:440,minHeight:420,icon:path.join(__dirname,'../assets/icon.png'),backgroundColor:'#0b1524',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true},...extra};}
function guardWindow(w){w.webContents.setWindowOpenHandler(({url})=>{openExternal(url);return {action:'deny'};});w.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('app://desktop/')){e.preventDefault();openExternal(url);}});w.webContents.on('will-attach-webview',e=>e.preventDefault());}
function openExternal(url){try{const u=new URL(url);if(u.protocol==='https:'&&u.hostname==='basketball.fantasysports.yahoo.com'&&/^\/nba(?:\/|$)/.test(u.pathname))shell.openExternal(u.href);}catch{}}
async function capture(html,file,width){const w=new BrowserWindow({width,height:900,show:false,useContentSize:true,enableLargerThanScreen:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});try{await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));await w.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');const height=Math.min(12000,Math.ceil(await w.webContents.executeJavaScript('document.documentElement.scrollHeight')));w.setContentSize(width,height);await new Promise(r=>setTimeout(r,100));const img=await w.webContents.capturePage();await fs.writeFile(file,img.toPNG());}finally{w.destroy();}}
async function doExport(outDir,selection){if(installing)throw Error('正在准备更新，请稍后导出');if(exporting)throw Error('正在导出，请稍候');exporting=true;try{return await exportsCore.exportBundle({snapshots:state.data.snapshots,leagues:state.data.leagues,outDir,capture,selection});}finally{exporting=false;}}
function wireIPC(){
  function handle(name,fn){ipcMain.handle(name,async(event,...values)=>{if(event.sender!==win?.webContents||event.senderFrame?.url!=='app://desktop/index.html')throw Error('页面无权调用此功能');return fn(...values);});}
  handle('get-state',()=>status());
  handle('update-action',async(action,value)=>{
    if(action==='auto'){await updater.setAuto(value);return updater.state;}
    if(action==='check')return updater.check();
    if(action==='download')return updater.download();
    if(action==='extension'){await shell.openPath(managed.directory);return true;}
    if(action==='files'){await shell.openPath(updater.directory);return true;}
    if(action!=='install')throw Error('未知的更新操作');
    if(!app.isPackaged||smoke)throw Error('只有已安装的应用可以执行更新');
    if(exporting||installing)throw Error('正在处理导出或更新，请稍后重试');
    if(updater.state.phase!=='ready')throw Error('请先完成更新下载');
    installing=true;updater.emit({phase:'preparing',error:''});
    try{
      const prepared=await updater.prepare(),target=process.platform==='darwin'?path.resolve(path.dirname(process.execPath),'../..'):path.dirname(process.execPath);
      await startInstall({platform:process.platform,target,prepared,directory:updater.directory});
      state.save();app.quit();return true;
    }catch(e){installing=false;updater.emit({phase:'ready',error:'更新未能安装：'+e.message+'。原有数据和应用保留，可打开更新文件重试。'});throw e;}
  });
  handle('injury-refresh',()=>refreshInjuries());
  handle('injury-follow',async name=>{if(typeof name!=='string'||!name.trim()||name.length>100)throw Error('球员名称无效');name=name.trim();const found=injury.followed.find(x=>x.toLowerCase()===name.toLowerCase());if(found){injury.followed=injury.followed.filter(x=>x!==found);delete injury.baseline[found.toLowerCase()];}else{injury.followed.push(name);const p=injury.players.find(x=>x.name.toLowerCase()===name.toLowerCase());if(p)injury.baseline=injuryCore.changes([name],{},[p]).baseline;}await saveExtra();changed();});
  handle('font-scale',async n=>{preferences.fontScale=Math.max(.8,Math.min(1.4,Number(n)||1));win.webContents.setZoomFactor(preferences.fontScale);await saveExtra();return preferences.fontScale;});
  handle('configure',leagues=>{state.configure(leagues);if(!state.data.leagues.some(l=>l.id===state.data.selectedLeague))state.data.selectedLeague=state.data.leagues[0]?.id||null;state.save();changed();return status();});
  handle('select-league',id=>{if(!state.data.leagues.some(l=>l.id===id))throw Error('联盟未配置');state.data.selectedLeague=id;state.save();return status();});
  handle('new-code',()=>state.newCode());
  handle('revoke',()=>{state.revoke();changed();return true;});
  handle('refresh',scope=>refresh(['full','recommendations'].includes(scope)?scope:'full'));
  handle('window-action',action=>{if(action==='pin'){win.setAlwaysOnTop(!win.isAlwaysOnTop());return win.isAlwaysOnTop();}if(action==='minimize')win.minimize();if(action==='close')app.quit();});
  handle('open-yahoo',id=>{const l=state.data.leagues.find(l=>l.id===id);if(l)openExternal(`https://basketball.fantasysports.yahoo.com/nba/${l.id}/${l.team}`);});
  handle('game-summary',async id=>{const game=score.events.find(e=>e.id===id);if(!game)throw Error('比赛不在当前赛程中');summaryID=id;const detail=await summary(id);score.selectedSummary=detail;score.selectedSummaryID=id;changed();return detail;});
  handle('power-week',(id,week)=>{const s=state.data.snapshots[id];if(!s)throw Error('尚未收到联盟数据');const snapshot=powerSnapshot(s,week),power=snapshot.leaguePower,team=power.teams.find(t=>t.id===s.teamID);return {error:power.weeklyPlayersError||'',mvp:weeklyMVP(power.weeklyPlayers,team,snapshot.columns)};});
  handle('player-values',(id,mode)=>{const s=state.data.snapshots[id];return s?playerValues(s,mode==='needs'?'needs':'balanced'):{owned:[],recommendations:[],message:'等待同步'};});
  handle('daily-refresh',(date,followToday)=>refreshDaily(date,followToday===true));
  handle('daily-rank',(id,punt)=>({rows:dailyCore.rank(daily.players,state.data.snapshots[id]?.columns,Array.isArray(punt)?punt:[]),columns:state.data.snapshots[id]?.columns||dailyCore.CATS.slice(0,9)}));
  handle('open-report',async(selection={})=>{if(!exportsCore.datasets(state.data.snapshots,[],{allWeeks:true}).length)throw Error('请先手动刷新，收齐全盟数据');const w=new BrowserWindow(windowOptions({width:1450,height:950,title:'全盟交互报告',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}}));guardWindow(w);reportWindows.add(w);w.on('closed',()=>reportWindows.delete(w));await w.loadURL('app://desktop/report.html?'+new URLSearchParams({leagueID:selection?.leagueID||'',week:selection?.week||''}));w.show();return true;});
  handle('export-power-html',async(selection)=>{if(installing||exporting)throw Error('正在处理导出或更新，请稍后重试');const s=state.data.snapshots[selection?.leagueID];if(!s)throw Error('尚未收到联盟数据');powerSnapshot(s,selection.week);const datasets=exportsCore.datasets(state.data.snapshots,state.data.leagues,{allWeeks:true,selection:{leagueID:selection.leagueID}});const html=await exportsCore.reportHTML(datasets,{leagueID:selection.leagueID,week:selection.week});const chosen=await dialog.showSaveDialog(win,{title:'导出盟内战力 HTML',defaultPath:`${exportsCore.safeName(s.league)}-${exportsCore.safeName(selection.week)}-盟内战力.html`,filters:[{name:'HTML',extensions:['html']}]});if(chosen.canceled||!chosen.filePath)return null;await fs.writeFile(chosen.filePath,html,'utf8');shell.showItemInFolder(chosen.filePath);return chosen.filePath;});
  handle('export-power-images',async(selection)=>{if(installing||exporting)throw Error('正在处理导出或更新，请稍后重试');const s=state.data.snapshots[selection?.leagueID];if(!s)throw Error('尚未收到联盟数据');powerSnapshot(s,selection.week);const [data]=exportsCore.datasets(state.data.snapshots,state.data.leagues,{selection});if(!data)throw Error('尚无完整全盟数据，无法导出');exporting=true;try{const chosen=await dialog.showOpenDialog(win,{title:'选择图片保存位置',properties:['openDirectory','createDirectory']});if(chosen.canceled)return null;const outDir=await fs.mkdtemp(path.join(chosen.filePaths[0],`${exportsCore.safeName(s.league)}-${exportsCore.safeName(selection.week)}-图片-`));let count=0;for(const kind of ['战力排名','各队数据','全员对战','实际对局','走位分析']){const file=path.join(outDir,kind+'.png');await capture(exportsCore.chartHTML(data,kind),file,kind==='全员对战'?Math.max(1800,280+data.analysis.rows.length*180):kind==='各队数据'?2400:1800);count++;}shell.showItemInFolder(outDir);return {outDir,count};}finally{exporting=false;}});
  handle('export',async(selection)=>{if(selection)powerSnapshot(state.data.snapshots[selection.leagueID],selection.week);const chosen=await dialog.showOpenDialog(win,{title:'选择报告保存位置',properties:['openDirectory','createDirectory']});if(chosen.canceled)return null;const stamp=new Date().toISOString().replace(/[:.]/g,'-'),outDir=path.join(chosen.filePaths[0],'范特西报告-'+stamp);const files=await doExport(outDir,selection);shell.showItemInFolder(files[0]);return {outDir,count:files.length};});
}
function menu(){const actionRefresh=()=>refresh().catch(()=>{});const items=[{label:'更新',submenu:[{label:'检查应用更新',click:()=>updater?.check().catch(()=>{})}]},{label:'数据',submenu:[{label:'刷新比分和 Yahoo 数据',accelerator:'CmdOrCtrl+R',click:actionRefresh},{label:'显示主窗口',click:()=>{win.show();win.focus();}},{type:'separator'},{role:'quit',label:'退出 Thunder Fantasy'}]},{role:'editMenu',label:'编辑'},{role:'windowMenu',label:'窗口'}];if(process.platform==='darwin')items.unshift({label:app.name,submenu:[{role:'about',label:'关于 Thunder Fantasy'},{type:'separator'},{role:'hide',label:'隐藏'},{role:'unhide',label:'显示全部'},{type:'separator'},{role:'quit',label:'退出 Thunder Fantasy'}]});Menu.setApplicationMenu(Menu.buildFromTemplate(items));}
app.whenReady().then(async()=>{
  state=new State(app.getPath('userData'));
  try{const saved=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'thunder-extra.json'),'utf8'));injury.followed=Array.isArray(saved.followed)?saved.followed:[];injury.baseline=saved.baseline||{};injury.players=Array.isArray(saved.players)?saved.players:[];injury.updatedAt=saved.updatedAt||null;preferences={...preferences,...saved.preferences};}catch{}
  managed=await managedExtension(path.join(__dirname,'../extension'),app.getPath('userData'));state.managedExtension=managed;
  updater=new Updater({directory:path.join(app.getPath('userData'),'updates'),currentVersion:app.getVersion(),fetch:(...args)=>net.fetch(...args),enabled:app.isPackaged&&!smoke,onChange:value=>{if(win&&!win.isDestroyed())win.webContents.send('update-state',value);}});await updater.load();
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false);
  protocol.handle('app',async request=>{
    const u=new URL(request.url);if(u.hostname!=='desktop')return new Response('Not found',{status:404});
    const logo=u.pathname.match(/^\/team-logos\/([0-9]{1,3})\.png$/);if(logo){try{return new Response(await fs.readFile(path.join(__dirname,'../assets/team-logos',logo[1]+'.png')),{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=86400'}});}catch{return new Response('Not found',{status:404});}}
    if(u.pathname==='/report.html'){try{return new Response(await exportsCore.reportHTML(exportsCore.datasets(state.data.snapshots,state.data.leagues,{allWeeks:true}),{leagueID:u.searchParams.get('leagueID'),week:u.searchParams.get('week')}),{headers:{'Content-Type':'text/html; charset=utf-8'}});}catch{return new Response('暂无完整联盟数据',{status:409});}}
    const routes={'/index.html':['index.html','text/html'],'/renderer.js':['renderer.js','text/javascript'],'/style.css':['style.css','text/css']};const route=routes[u.pathname];if(!route)return new Response('Not found',{status:404});return new Response(await fs.readFile(path.join(__dirname,route[0])),{headers:{'Content-Type':route[1]+'; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'self'; form-action 'none'"}});
  });
  if(smoke&&argument('--input')){const source=JSON.parse(await fs.readFile(argument('--input'),'utf8'));state.configure(source.leagues);for(const s of source.snapshots)state.snapshot(s);}
  if(exportPath){try{const files=await doExport(path.resolve(exportPath));process.stdout.write(JSON.stringify({ok:true,files})+'\n');app.exit(0);}catch(e){process.stderr.write(e.message+'\n');app.exit(1);}return;}
  win=new BrowserWindow(windowOptions({show:!smoke}));guardWindow(win);wireIPC();menu();
  win.on('closed',()=>{win=null;app.quit();});
  const errors=[];win.webContents.on('console-message',(_e,...rest)=>{if(smoke&&rest.some(x=>String(x).includes('Error')))errors.push(rest.map(String).join(' '));});
  await win.loadURL('app://desktop/index.html');win.webContents.setZoomFactor(Math.max(.8,Math.min(1.4,Number(preferences.fontScale)||1)));if(!smoke)win.show();
  if(!smoke&&!exportPath){
    const target=process.platform==='darwin'?path.resolve(path.dirname(process.execPath),'../..'):path.dirname(process.execPath);
    await finishInstall(updater.directory,app.getVersion(),target);
    setTimeout(()=>pruneCache(updater.directory,app.getVersion()).catch(()=>{}),30000);
    updateTimer=setTimeout(()=>updater.check(true).catch(()=>{}),30000);
    updateInterval=setInterval(()=>updater.check(true).catch(()=>{}),6*60*60*1000);
  }
  if(smoke){
    await new Promise(r=>setTimeout(r,300));const out=argument('--smoke-output');
    if(args.includes('--network')){await refreshScore();if(score.error)throw Error(score.error);await win.webContents.executeJavaScript("document.querySelector('[data-page=score]').click()");await new Promise(r=>setTimeout(r,400));if(score.featured&&!await win.webContents.executeJavaScript("document.querySelectorAll('.team-logo').length===2&&[...document.querySelectorAll('.team-logo')].every(i=>i.complete&&i.naturalWidth>0)"))throw Error('真实比赛双方队标未加载');if(score.featured?.status?.type?.state==='pre'&&!await win.webContents.executeJavaScript("document.querySelectorAll('.scoreline strong').length===0&&document.querySelector('.colon').textContent===''"))throw Error('赛前比分占位未移除');if(score.featured){if(!await win.webContents.executeJavaScript("data.score.featured.status.type.state='in';render();document.querySelectorAll('.scoreline strong').length===2&&document.querySelector('.colon').textContent===':'"))throw Error('比赛中比分未显示');}process.stdout.write('ESPN_NETWORK_OK '+score.events.length+'\n');}
    if(args.includes('--network')){const date=argument('--daily-date')||dayKey(new Date(),'America/New_York');await refreshDaily(date);if(daily.error||daily.failed.length||!daily.players.length)throw Error('每日排行真实数据不完整：'+JSON.stringify({error:daily.error,failed:daily.failed,players:daily.players.length}));await win.webContents.executeJavaScript("document.querySelector('[data-page=daily]').click()");await new Promise(r=>setTimeout(r,300));if(!await win.webContents.executeJavaScript("document.querySelectorAll('#daily-results tbody tr').length>0&&document.querySelectorAll('.daily-punt').length>0"))throw Error('每日排行或 Punt 控件未显示');process.stdout.write('DAILY_NETWORK_OK '+daily.players.length+'\n');}
    await win.webContents.executeJavaScript("document.querySelector('[data-page=settings]').click()");
    const waitForUpdateUI=async(expression,message)=>{
      const until=Date.now()+10000;
      while(Date.now()<until){if(await win.webContents.executeJavaScript(expression))return;await new Promise(r=>setTimeout(r,100));}
      throw Error(message+': '+JSON.stringify(await win.webContents.executeJavaScript("({progress:document.getElementById('update-progress')?.value,hidden:document.getElementById('update-banner')?.hidden,text:document.getElementById('update-banner-text')?.textContent})")));
    };
    updater.emit({phase:'downloading',version:'9.0.0',progress:45});
    await waitForUpdateUI("document.getElementById('update-progress').value===45&&!document.getElementById('update-banner').hidden",'自动更新下载进度未显示');
    updater.emit({phase:'ready',progress:100});
    await waitForUpdateUI("!document.getElementById('update-banner-install').hidden",'自动更新安装入口未显示');
    updater.emit({phase:'idle',version:null,progress:0});
    if(!await win.webContents.executeJavaScript("typeof require==='undefined'&&typeof process==='undefined'&&typeof desktop.getState==='function'"))throw Error('渲染进程隔离失败');
    if(out){await fs.mkdir(out,{recursive:true});await win.webContents.executeJavaScript("document.querySelector('[data-page=settings]').click()");await new Promise(r=>setTimeout(r,100));await fs.writeFile(path.join(out,'首次配置.png'),(await win.webContents.capturePage()).toPNG());}
    if(exportsCore.datasets(state.data.snapshots).length){
      const originalDaily=await win.webContents.executeJavaScript("document.querySelector('.daily-fa').checked");
      if(await win.webContents.executeJavaScript("document.querySelector('.daily-fa').click();document.querySelector('.league-theme').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.daily-fa').checked")===originalDaily)throw Error('自由球员更新选项无法切换');
      await win.webContents.executeJavaScript("document.querySelector('[data-action=save-leagues]').click()");
      await new Promise(r=>setTimeout(r,200));
      if(state.data.leagues[0].dailyFreeAgents===originalDaily||await win.webContents.executeJavaScript("document.querySelector('.daily-fa').checked")===originalDaily)throw Error('自由球员更新选项未保存');
      await win.webContents.executeJavaScript("document.querySelector('[data-page=fantasy]').click();document.querySelector('[data-tab=players]').click();document.getElementById('range').value='season';document.getElementById('range').dispatchEvent(new Event('change',{bubbles:true}))");
      await new Promise(r=>setTimeout(r,100));
      if(!await win.webContents.executeJavaScript("document.querySelectorAll('tbody tr').length>0"))throw Error('球员场均界面为空');
      await win.webContents.executeJavaScript("document.querySelector('[data-tab=values]').click()");await new Promise(r=>setTimeout(r,150));
      if(!await win.webContents.executeJavaScript("document.querySelectorAll('.value-card').length>0"))throw Error('价值分析界面为空');
      await win.webContents.executeJavaScript("document.querySelector('[data-tab=power]').click()");await new Promise(r=>setTimeout(r,100));
      await new Promise(r=>setTimeout(r,300));
      const embedded=win.webContents.mainFrame.frames.find(f=>f.url.includes('/report.html'));
      if(!embedded)throw Error('应用内战力面板未加载');
      if(!await win.webContents.executeJavaScript("!!document.querySelector('[data-action=export-power-html]')&&powerSelection().leagueID===document.querySelector('#power-report').contentDocument.querySelector('[data-league][aria-pressed=true]').dataset.league&&powerSelection().week===document.querySelector('#power-report').contentDocument.querySelector('#weeks').value"))throw Error('HTML 导出入口或当前联盟周次读取失败');
      for(const view of ['overview','stats','actual','matrix','luck']){
        const ok=await embedded.executeJavaScript(`document.querySelector('[data-view=${view}]').click();document.getElementById('view-title').textContent.length>0`);if(!ok)throw Error('应用内战力视图未显示：'+view);
      }
      await embedded.executeJavaScript("document.querySelector('[data-view=overview]').click()");
      if(!await embedded.executeJavaScript("document.querySelectorAll('.bar-row').length===12"))throw Error('应用内战力柱状图不完整');
      await embedded.executeJavaScript("document.getElementById('appearance').value='dark';document.getElementById('appearance').dispatchEvent(new Event('change'))");
      await new Promise(r=>setTimeout(r,300));
      if(!await embedded.executeJavaScript("document.body.classList.contains('dark')&&getComputedStyle(document.body).backgroundColor==='rgb(9, 19, 33)'"))throw Error('应用内深色背景未生效');
      await embedded.executeJavaScript("document.querySelector('[data-view=stats]').click();document.querySelector('[data-sort=\"stat:PTS\"]').click()");
      if(!await embedded.executeJavaScript("document.querySelectorAll('.stat-best').length>0&&document.querySelectorAll('.stat-worst').length>0&&document.querySelector('[data-sort=\"stat:PTS\"]').closest('th').getAttribute('aria-sort')==='descending'"))throw Error('最高最低标注或排序异常');
      if(out){await fs.writeFile(path.join(out,'应用内战力.png'),(await win.webContents.capturePage()).toPNG());await doExport(path.join(out,'报告'));}
      const report=new BrowserWindow({width:1500,height:1000,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});await report.loadURL('app://desktop/report.html');
      for(const view of ['overview','stats','matrix','luck']){
        const count=await report.webContents.executeJavaScript(`document.querySelector('[data-view=${view}]').click();document.querySelectorAll('tbody tr').length`);if(count<4)throw Error('交互报告 '+view+' 为空');
      }
      if(availableWeeks(Object.values(state.data.snapshots)[0]).length>1){
        await embedded.executeJavaScript("document.getElementById('weeks').value='Week 1';document.getElementById('weeks').dispatchEvent(new Event('change'))");
        if(!await win.webContents.executeJavaScript("powerSelection().week==='Week 1'"))throw Error('导出未使用报告内选择的周次');
        await report.webContents.executeJavaScript("document.getElementById('weeks').value='Week 1';document.getElementById('weeks').dispatchEvent(new Event('change'))");
        if(!await report.webContents.executeJavaScript("document.getElementById('title').textContent.includes('Week 1')&&document.querySelectorAll('tbody tr').length>=4"))throw Error('交互报告历史周切换失败');
        await report.webContents.executeJavaScript("document.querySelector('[data-view=stats]').click()");
        if(!await report.webContents.executeJavaScript("document.getElementById('content').textContent.includes('1200')"))throw Error('历史周报告混入本周统计');
        if(out)await fs.writeFile(path.join(out,'历史周交互报告.png'),(await report.webContents.capturePage()).toPNG());
      }
      await report.webContents.executeJavaScript("document.getElementById('appearance').value='custom';document.getElementById('appearance').dispatchEvent(new Event('change'));document.getElementById('bg-color').value='#164b31';document.getElementById('bg-color').dispatchEvent(new Event('input'))");
      await new Promise(resolve=>{report.webContents.once('did-finish-load',resolve);report.reload();});if(!await report.webContents.executeJavaScript("document.getElementById('appearance').value==='custom'&&document.getElementById('bg-color').value==='#164b31'"))throw Error('报告背景设置未持久化');
      report.destroy();
    }else{
      if(!await win.webContents.executeJavaScript("document.querySelectorAll('.league-row').length===1"))throw Error('首次配置界面异常');
      state.importLeague({source:'https://basketball.fantasysports.yahoo.com/nba/90001/6',name:'导入测试联盟'});changed();
      await new Promise(r=>setTimeout(r,100));
      if(!await win.webContents.executeJavaScript("document.querySelector('.league-id')?.value==='90001'&&document.querySelector('.team-id')?.value==='6'"))throw Error('网页导入后设置界面未更新');
      state.configure([]);state.data.selectedLeague=null;state.command=null;state.save();
    }
    if(errors.length)throw Error(errors.join('\n'));process.stdout.write('SMOKE_OK\n');app.exit(0);return;
  }
  bridge=createBridge(state,changed);bridge.on('error',error=>{state.syncStatus={state:'error',error:'本机同步服务无法启动：'+error.message,time:Date.now()};changed();});bridge.listen(18747,'127.0.0.1');
  refreshScore();
  if(!smoke)refreshInjuries();
}).catch(error=>{process.stderr.write(error.stack+'\n');if(!smoke)dialog.showErrorBox('Thunder Fantasy 启动失败',error.message);app.exit(1);});
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.on('activate',()=>{win?.show();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{app.isQuitting=true;clearTimeout(scoreTimer);clearTimeout(dailyTimer);clearTimeout(injuryTimer);clearTimeout(updateTimer);clearInterval(updateInterval);bridge?.close();});
}
