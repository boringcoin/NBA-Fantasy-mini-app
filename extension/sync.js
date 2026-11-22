(() => {
  if(!/^\/nba\/\d+(?:\/|$)/.test(location.pathname))return;
  let leagues=[];
  let busy=false,currentLease=null;
  const parse=html=>new DOMParser().parseFromString(html,'text/html');
  let queue=Promise.resolve(),lastRequest=0;
  async function fetchPage(url) {
    const storage=chrome.storage?.local,backoff=(await storage?.get('yahooBackoffUntil'))?.yahooBackoffUntil||0;
    if(Date.now()<backoff)throw Error('Yahoo 暂时拒绝访问，同步已暂停，请稍后再试');
    const wait=storage?Math.max(0,1000-(Date.now()-lastRequest)):0;if(wait)await new Promise(resolve=>setTimeout(resolve,wait));lastRequest=Date.now();
    let r;
    try{r=await fetch(url,{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(45000)});}
    catch(error){const timeout=error?.name==='TimeoutError'||error?.name==='AbortError';throw Error(timeout?'Yahoo 页面连接超时，请检查网络或代理后重试；已有数据会保留。':'无法连接 Yahoo，请检查网络或代理后重试；已有数据会保留。');}
    if(r.status===403||r.status===429){await storage?.set({yahooBackoffUntil:Date.now()+30*60*1000});throw Error('Yahoo 拒绝请求，同步已暂停 30 分钟，请稍后再试');}
    if(!r.ok)throw Error(`雅虎页面请求失败（HTTP ${r.status}）：${new URL(url).pathname}`);
    if(new URL(r.url).hostname!==location.hostname)throw Error('雅虎登录失效，请重新登录 Yahoo');
    const doc=parse(await r.text());if(/^request denied[.!\s]*$/i.test((doc.body?.textContent||'').trim())){await storage?.set({yahooBackoffUntil:Date.now()+30*60*1000});throw Error('Yahoo 拒绝请求，同步已暂停 30 分钟，请稍后再试');}return doc;
  }
  async function get(url){const next=queue.then(()=>fetchPage(url),()=>fetchPage(url));queue=next.catch(()=>{});return next;}
  const rosterURL=(league,period)=>{
    const url=new URL(`/nba/${league.id}/${league.team}`,location.origin);
    if(period){url.searchParams.set('stat1','AS');url.searchParams.set('stat2',period);}
    return url;
  };
  async function availablePool(league,period) {
    const players=[];
    for(let page=0;page<4;page++) {
      const url=new URL(`/nba/${league.id}/players`,location.origin);
      for(const [k,v] of Object.entries({status:'A',stat1:period,pos:'P',sort:'R_PO',sdir:'1',count:String(page*25)}))url.searchParams.set(k,v);
      const rows=YahooParser.fromDocument(await get(url)).players;
      players.push(...rows);if(rows.length<25)break;
    }
    return players;
  }
  async function send(data) {
    const result=await chrome.runtime.sendMessage({type:'snapshot',...currentLease,data});
    if(!result?.ok)throw Error(result?.error||'桌面应用尚未连接');
  }
  const hasGameToday=player=> /(?:\bvs\s+|@\s*)[A-Z]{2,3}\b/i.test(player.info||'') || (player.stats?.PTS!=null && String(player.stats.PTS).trim()!=='' && Number.isFinite(Number(player.stats.PTS)));
  async function weeklyPlayers(league,doc,week,team){
    try{
      const dates=new Set();for(const a of doc.querySelectorAll('a[href]')){let u;try{u=new URL(a.getAttribute('href'),location.origin)}catch{continue}const d=u.searchParams.get('date');if(u.origin===location.origin&&u.pathname===`/nba/${league.id}/matchup`&&/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&u.searchParams.get('week')===String(week))dates.add(d);}
      if(dates.size!==7)throw Error('未识别完整的 7 天日期');
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const active=[...dates].sort().filter(d=>d<=today),pages=await Promise.all(active.map(async date=>{const u=new URL(`/nba/${league.id}/${league.team}/team`,location.origin);u.searchParams.set('date',date);return YahooParser.fromDocument(await get(u)).players;}));
      const count=['3PTM','PTS','OREB','REB','AST','ST','BLK','TO'],rows=new Map();
      for(const day of pages)for(const p of day){if(!p.position||/^(BN|IL|IL\+|IR|NA|--)/i.test(p.position)||!String(p.stats.MIN||'').split(':').some(v=>Number(v)>0))continue;const fg=/^(\d+)\/(\d+)$/.exec(p.stats['FGM/A']||''),ft=/^(\d+)\/(\d+)$/.exec(p.stats['FTM/A']||'');if(!fg||!ft||count.some(k=>!/^\d+$/.test(String(p.stats[k]??''))))continue;let v=rows.get(p.id);if(!v){v={id:p.id,name:p.name,stats:Object.fromEntries([...count,'GP','FGM','FGA','FTM','FTA'].map(k=>[k,0]))};rows.set(p.id,v);}v.stats.GP++;for(const k of count)v.stats[k]+=Number(p.stats[k]);v.stats.FGM+=Number(fg[1]);v.stats.FGA+=Number(fg[2]);v.stats.FTM+=Number(ft[1]);v.stats.FTA+=Number(ft[2]);}
      const players=[...rows.values()],sum=k=>players.reduce((n,p)=>n+p.stats[k],0),totals=team?.stats||{};for(const k of count)if(!/^\d+$/.test(String(totals[k]??''))||sum(k)!==Number(totals[k]))throw Error(`球员${k}累计与球队总数不一致`);for(const [key,m,a] of [['FGM/A','FGM','FGA'],['FTM/A','FTM','FTA']]){const v=/^(\d+)\/(\d+)$/.exec(totals[key]||'');if(!v||sum(m)!==Number(v[1])||sum(a)!==Number(v[2]))throw Error(`${key}累计与球队总数不一致`);}
      for(const p of players){p.stats['FGM/A']=p.stats.FGM+'/'+p.stats.FGA;p.stats['FTM/A']=p.stats.FTM+'/'+p.stats.FTA;}
      return {players,error:null};
    }catch(e){return {players:[],error:String(e.message||e).slice(0,300)};}
  }
  async function leaguePower(league,matchDoc,base,withHistory=true) {
    const week=(base.week.match(/\d+/)||[])[0];
    const empty={teams:[],week:base.week,updatedAt:new Date().toISOString(),expectedTeamCount:0,error:null};
    try {
      if(!week)throw Error('未识别本周编号');
      const home=await get(new URL(`/nba/${league.id}`,location.origin));
      const links=[YahooParser.leagueLinks(home,league.id,week,location.origin),YahooParser.leagueLinks(matchDoc,league.id,week,location.origin)];
      const ids=new Set(links[0].teamIDs);
      empty.expectedTeamCount=ids.size;
      if(ids.size<4||ids.size>24)throw Error('未识别完整联盟球队名单');
      const rows=new Map(base.teams.map(t=>[t.id,t]));
      const matches=base.historical?[]:[...new Map(links.flatMap(l=>l.matchups).map(m=>[m.ids.slice().sort().join(':'),m])).values()];
      if(base.historical&&new Set(matches.flatMap(m=>m.ids)).size<ids.size){
        const teamIDs=[...ids],pages=await Promise.allSettled(teamIDs.map(async id=>{const url=new URL(`/nba/${league.id}/${id}`,location.origin);url.searchParams.set('week',week);return YahooParser.historicalOpponent(await get(url),league.id,week,id,location.origin);}));
        const byTeam=new Map(teamIDs.map((id,i)=>[id,pages[i].status==='fulfilled'?pages[i].value:null]));
        for(const [id,opponent] of byTeam){if(!opponent||!ids.has(opponent)||byTeam.get(opponent)!==id)continue;const key=[id,opponent].sort().join(':');if(matches.some(m=>m.ids.slice().sort().join(':')===key))continue;const url=new URL(`/nba/${league.id}/matchup`,location.origin);for(const [k,v] of Object.entries({week,mid1:id,mid2:opponent,date:'totals'}))url.searchParams.set(k,v);matches.push({url:url.href,ids:[id,opponent]});}
      }
      for(const match of matches.slice(0,12)) {
        if(match.ids.every(id=>rows.has(id)))continue;
        if(!match.ids.every(id=>ids.has(id)))continue;
        const doc=await get(match.url);
        const pageWeek=(doc.body.textContent.match(/Week\s+(\d+)/)||[])[1];
        if(pageWeek!==week)throw Error('对局周次不一致，请重试');
        const teams=YahooParser.fromDocument(doc).teams;
        if(teams.length!==2||!match.ids.every(id=>teams.some(t=>t.id===id)))throw Error('对局统计解析不完整');
        teams.forEach(t=>rows.set(t.id,t));
      }
      if(rows.size!==ids.size||![...ids].every(id=>rows.has(id)))throw Error(`仅获取 ${rows.size}/${ids.size} 队，暂不生成全盟排名`);
      const pairs=matches.filter(m=>m.ids.every(id=>ids.has(id))).map(m=>m.ids);
      const members=pairs.flat();
      const matchupPairs=members.length===ids.size&&new Set(members).size===ids.size?pairs:null;
      const result={...empty,teams:[...rows.values()],matchupPairs,updatedAt:new Date().toISOString()};
      if(withHistory)await addHistory(league,result);
      return result;
    } catch(e) {return {...empty,error:String(e.message||e)};}
  }
  async function addHistory(league,result){
    const week=Number((result.week.match(/\d+/)||[])[0]);result.priorWeeks=[];const errors=[];
    for(let prior=week-1;prior>=Math.max(1,week-4);prior--){
      if((league.cachedWeeks||[]).includes('Week '+prior))continue;
      try{
        const url=new URL(`/nba/${league.id}/matchup`,location.origin);url.searchParams.set('week',String(prior));url.searchParams.set('date','totals');
        const doc=await get(url);if((doc.body.textContent.match(/Week\s+(\d+)/)||[])[1]!==String(prior))throw Error('历史周次不一致');
        const parsed=YahooParser.fromDocument(doc);if(parsed.teams.length!==2)throw Error('历史对局不完整');
        const power=await leaguePower(league,doc,{week:'Week '+prior,teams:parsed.teams,historical:true},false);if(power.error)throw Error(power.error);
        result.priorWeeks.push({week:power.week,teams:power.teams,expectedTeamCount:power.expectedTeamCount,matchupPairs:power.matchupPairs,updatedAt:power.updatedAt});
      }catch(e){errors.push('Week '+prior+'：'+String(e.message||e));}
    }
    result.historyError=errors.length?errors.join('；').slice(0,900):null;
  }
  async function syncLeague(league,todayOnly=false,daily=false) {
    YahooParser.setLeague(league.id);
    const matchupURL=new URL(`/nba/${league.id}/matchup`,location.origin);
    matchupURL.searchParams.set('date','totals');
    // A missing/default matchup must never prevent a valid owned roster from arriving.
    const rosterDoc=await get(rosterURL(league)),roster=YahooParser.fromDocument(rosterDoc);
    if(!roster.players.length)throw Error('阵容读取失败：请确认配置的球队 ID，并在浏览器打开自己的 My Team 页面后重试');
    let matchDoc=null,matchup=null,matchupError=null;
    try {
      matchDoc=await get(matchupURL);matchup=YahooParser.fromDocument(matchDoc);
      if(matchup.teams.length!==2||!matchup.teams.some(t=>t.id===league.team)) {
        const week=(matchDoc.body.textContent.match(/Week\s+(\d+)/)||[])[1];
        const link=week&&[...YahooParser.leagueLinks(rosterDoc,league.id,week,location.origin).matchups,...YahooParser.leagueLinks(matchDoc,league.id,week,location.origin).matchups].find(m=>m.ids.includes(league.team));
        if(link){matchupURL.href=link.url;matchDoc=await get(matchupURL);matchup=YahooParser.fromDocument(matchDoc);}
        if(matchup.teams.length!==2||!matchup.teams.some(t=>t.id===league.team))throw Error('未识别到这支球队的本周对局；阵容仍可查看，请核对球队 ID 或稍后重试');
      }
    } catch(error) {matchupError=String(error.message||error);matchup=null;}
    const years=Array.from(rosterDoc.querySelectorAll('a[href]')).map(a=>(a.textContent||'').trim().match(/^(20\d{2})[-–]\d{2}(?:\s+Season)?$/i)).filter(Boolean).map(m=>Number(m[1]));
    const seasonYear=years.length?Math.max(...years):new Date().getFullYear()-(new Date().getMonth()<8?1:0);
    const base={league:league.name,leagueID:league.id,teamID:league.team,seasonYear,week:(matchDoc?.body.textContent.match(/Week\s+\d+/)||rosterDoc.body.textContent.match(/Week\s+\d+/)||[])[0]||'本周',receivedAt:new Date().toISOString(),columns:(matchup||roster).columns,teams:matchup?.teams||[],players:roster.players,source:matchupURL.href,matchupError};
    if(todayOnly) {
      const playing=roster.players.filter(hasGameToday);
      const ids=new Set(playing.map(p=>p.id));
      base.syncScope='today';base.todayPlayerIDs=[...ids];
      // Keep the roster, but send statistics only for players on today's Yahoo slate.
      base.players=roster.players.map(p=>ids.has(p.id)?p:{...p,stats:{}});
      if(ids.size)base.recentUpdates=YahooParser.fromDocument(await get(rosterURL(league,'AL14'))).players.filter(p=>ids.has(p.id));
      // Refresh this week's league totals every ten minutes too. Do not fetch
      // historical weeks or the free-agent pool during this lightweight run.
      base.leaguePower=matchup?await leaguePower(league,matchDoc,base,false):{teams:[],week:base.week,expectedTeamCount:0,error:matchupError,updatedAt:new Date().toISOString()};
      await send(base);if(matchupError||base.leaguePower.error)throw Error(matchupError||base.leaguePower.error);return;
    }
    base.syncScope='full';
    await send(base);
    try {
      // Every metric below is an average per appearance, with GP retained for sample size.
      const recent=YahooParser.fromDocument(await get(rosterURL(league,'AL14'))).players;
      const prior=YahooParser.fromDocument(await get(rosterURL(league,'AS_'+(seasonYear-1)))).players;
      const ownedIDs=new Set(roster.players.map(p=>p.id));
      base.research={recent:recent.filter(p=>ownedIDs.has(p.id)),prior:prior.filter(p=>ownedIDs.has(p.id)),baselineIDs:[...ownedIDs],available:[],period:'我的球员：近14天场均' ,updatedAt:new Date().toISOString(),error:null};
    } catch(error) {base.research={recent:[],prior:[],baselineIDs:[],available:[],period:'',updatedAt:new Date().toISOString(),error:String(error.message||error)};}
    // Full refresh also retrieves historical totals and season averages.
    // Keep this season's roster averages separate from the prior-season value baseline.
    try {
      const years=Array.from(rosterDoc.querySelectorAll('a[href]')).map(a=>(a.textContent||'').trim().match(/^(20\d{2})[-–]\d{2}(?:\s+Season)?$/i)).filter(Boolean).map(m=>Number(m[1]));
      if(!years.length)throw Error('未识别本赛季年份');
      const year=seasonYear;
      const season=YahooParser.fromDocument(await get(rosterURL(league,'AS_'+year))).players;
      const ownedIDs=new Set(roster.players.map(p=>p.id));
      base.research.season=season.filter(p=>ownedIDs.has(p.id));
      base.research.seasonLabel=`${year}–${String(year+1).slice(-2)}赛季`;
      base.research.seasonError=null;
    } catch(error) {base.research.seasonError=String(error.message||error).slice(0,900);}
    base.leaguePower=matchup?await leaguePower(league,matchDoc,base,false):{teams:[],week:base.week,expectedTeamCount:0,error:matchupError,updatedAt:new Date().toISOString()};
    await addHistory(league,base.leaguePower);
    const previous=Number((base.week.match(/\d+/)||[])[0])-1;
    if(previous>=1&&!(league.mvpWeeks||[]).includes('Week '+previous)){
      const url=new URL(`/nba/${league.id}/matchup`,location.origin);url.searchParams.set('week',String(previous));url.searchParams.set('date','totals');
      try{const doc=await get(url),parsed=YahooParser.fromDocument(doc),team=parsed.teams.find(t=>t.id===league.team);if(!team)throw Error('未找到球队的历史对局');const mvp=await weeklyPlayers(league,doc,previous,team),entry=base.leaguePower.priorWeeks.find(p=>p.week==='Week '+previous);if(entry){entry.weeklyPlayers=mvp.players;entry.weeklyPlayersError=mvp.error;}else{const cached=league.completedPower;if(cached?.week==='Week '+previous)base.leaguePower.priorWeeks.push({...cached,weeklyPlayers:mvp.players,weeklyPlayersError:mvp.error});}}catch(error){base.leaguePower.mvpError=String(error.message||error).slice(0,300);}
    }
    if(daily) {
      try {
        if(base.research?.error)throw Error(base.research.error);
        // Today's current available pool is authoritative; historical pages supply stats only.
        const recentPool=await availablePool(league,'S_AL14');
        const ownedIDs=new Set(roster.players.map(p=>p.id));
        const available=[...new Map(recentPool.map(p=>[p.id,p])).values()].filter(p=>!ownedIDs.has(p.id)&&/^(FA|W\b)/.test(p.availability)).slice(0,100);
        const currentIDs=new Set(available.map(p=>p.id));
        const prior=(await availablePool(league,'S_AS_'+(seasonYear-1))).filter(p=>currentIDs.has(p.id));
        const recent=recentPool.filter(p=>currentIDs.has(p.id));
        base.dailyRoster=roster.players;
        base.dailyResearch={recent:[...base.research.recent,...recent],prior:[...base.research.prior,...prior],baselineIDs:[...roster.players,...available].map(p=>p.id),available,period:'每日16:00自由球员参考',updatedAt:new Date().toISOString(),error:null};
      } catch(error) {base.dailyResearch={recent:[],prior:[],baselineIDs:[],available:[],period:'每日16:00自由球员参考',updatedAt:new Date().toISOString(),error:String(error.message||error)};}
    }
    base.receivedAt=new Date().toISOString();
    await send(base);
    const warnings=[matchupError,base.research?.error,base.research?.seasonError,base.leaguePower?.error,base.dailyResearch?.error].filter(Boolean);
    if(warnings.length)throw Error([...new Set(warnings)].join('；'));
  }
  async function sync(requestID=null,todayOnly=false,daily=false,targetLeague=null) {
    if(busy)return;busy=true;
    try {
      const config=await chrome.runtime.sendMessage({type:'get-config'});
      leagues=config?.leagues||[];
      if(!leagues.some(l=>new RegExp('^/nba/'+l.id+'(?:/|$)').test(location.pathname)))return;
      const selected=leagues.filter(l=>(!targetLeague||l.id===targetLeague)&&(!daily||requestID||l.dailyFreeAgents));
      // Prefer this page's league; one remaining tab can still service the other leagues.
      selected.sort((a,b)=>Number(location.pathname.startsWith('/nba/'+b.id+'/'))-Number(location.pathname.startsWith('/nba/'+a.id+'/')));
      for(const league of selected){
        const claim=await chrome.runtime.sendMessage({type:'acquire-sync',leagueID:league.id,requestID,todayOnly,daily});
        if(!claim?.ok)continue;
        const lease={leagueID:league.id,leaseID:claim.leaseID};currentLease=lease;
        const heartbeat=setInterval(()=>chrome.runtime.sendMessage({type:'sync-heartbeat',...lease}).catch(()=>{}),30000);
        let error='';
        try{await syncLeague(league,todayOnly,daily);}catch(e){error=String(e.message||e);}
        finally{
          clearInterval(heartbeat);currentLease=null;
          const released=await chrome.runtime.sendMessage({type:'release-sync',...lease,error});
          if(!released?.ok)throw Error(released?.error||'同步任务已失效，请重试');
        }
      }
    } catch(error){chrome.runtime.sendMessage({type:'status',ok:false,error:String(error.message||error),time:Date.now()}).catch(()=>{});}
    finally{busy=false;}
  }
  const checkDaily=()=>{if(!busy)return sync(null,false,true);};
  // Pairing and the first full sync are initiated by the popup. No account credentials are shared.
  sync(null,true).finally(checkDaily);
  setInterval(()=>sync(null,true),10*60*1000);
  setInterval(checkDaily,60*1000);
  // This checks only the local app for a manual command; it does not fetch Yahoo data.
  const checkRefresh=async()=>{
    try {
      const command=await chrome.runtime.sendMessage({type:'get-refresh-request'});
      // The background keeps per-league completion. A busy/losing tab retries on
      // the next poll; it must never mark another league's command as consumed.
      if(command?.ok&&command.requestID&&!busy)await sync(command.requestID,false,command.scope==='recommendations',command.leagueID||null);
    } catch {}
  };
  setInterval(checkRefresh,5000);
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message.type==='auto-sync')sync(null,true);
    if(message.type==='check-refresh')checkRefresh();
    if(message.type==='team-context')respond({ok:true,context:ThunderTeamContext.fromDocument(document,location.href)});
  });
})();
