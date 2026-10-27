(() => {
  if(!/^\/nba\/\d+(?:\/|$)/.test(location.pathname))return;
  let leagues=[];
  let busy=false,currentLease=null;
  const parse=html=>new DOMParser().parseFromString(html,'text/html');
  async function get(url) {
    const r=await fetch(url,{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw Error(`雅虎页面请求失败（HTTP ${r.status}）：${new URL(url).pathname}`);
    if(new URL(r.url).hostname!==location.hostname)throw Error('雅虎登录失效，请重新登录 Yahoo');
    return parse(await r.text());
  }
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
      const matches=[...new Map(links.flatMap(l=>l.matchups).map(m=>[m.ids.slice().sort().join(':'),m])).values()];
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
      // League home often links only to the current week's schedule. For a
      // historical week, query missing team totals against a known team. These
      // are comparisons only: never claim them as actual historical pairings.
      if(rows.size<ids.size){
        const known=[...rows.keys()].find(id=>ids.has(id));
        if(known)for(const missing of ids){
          if(rows.has(missing))continue;
          const url=new URL(`/nba/${league.id}/matchup`,location.origin);
          for(const [key,value]of Object.entries({week,mid1:missing,mid2:known,date:'totals'}))url.searchParams.set(key,value);
          const doc=await get(url);
          if((doc.body.textContent.match(/Week\s+(\d+)/)||[])[1]!==week)throw Error('历史对局返回周次不一致');
          const teams=YahooParser.fromDocument(doc).teams;
          if(teams.length!==2||!teams.some(t=>t.id===missing)||!teams.some(t=>t.id===known))continue;
          rows.set(missing,teams.find(t=>t.id===missing));
        }
      }
      if(rows.size!==ids.size||![...ids].every(id=>rows.has(id)))throw Error(`仅获取 ${rows.size}/${ids.size} 队，Yahoo 未返回其余球队的本周数据；请稍后重试`);
      const pairs=matches.filter(m=>m.ids.every(id=>ids.has(id))).map(m=>m.ids);
      const members=pairs.flat();
      const matchupPairs=members.length===ids.size&&new Set(members).size===ids.size?pairs:null;
      const result={...empty,teams:[...rows.values()],matchupPairs,updatedAt:new Date().toISOString()};
      return result;
    } catch(e) {return {...empty,error:String(e.message||e)};}
  }
  async function addHistory(league,result,base,cached){
    const week=Number((result.week.match(/\d+/)||[])[0]);result.priorWeeks=[];const errors=[];
    if(!Number.isInteger(week)||week<1||week>40){result.historyError='未识别有效周次，无法补取历史数据';return;}
    const completed=new Set(base.seasonYear&&cached?.seasonYear===base.seasonYear?cached.weeks||[]:[]);
    for(let prior=week-1;prior>=1;prior--){
      if(completed.has('Week '+prior))continue;
      try{
        const url=new URL(`/nba/${league.id}/matchup`,location.origin);url.searchParams.set('week',String(prior));url.searchParams.set('date','totals');
        const doc=await get(url);if((doc.body.textContent.match(/Week\s+(\d+)/)||[])[1]!==String(prior))throw Error('历史周次不一致');
        const parsed=YahooParser.fromDocument(doc);if(parsed.teams.length!==2)throw Error('历史对局不完整');
        const power=await leaguePower(league,doc,{week:'Week '+prior,teams:parsed.teams},false);if(power.error)throw Error(power.error);
        const saved={week:power.week,teams:power.teams,expectedTeamCount:power.expectedTeamCount,matchupPairs:power.matchupPairs,updatedAt:power.updatedAt,columns:base.columns,seasonYear:base.seasonYear,historicalFinal:true};
        await send({...base,syncScope:'history',powerHistory:[saved]});
      }catch(e){errors.push('Week '+prior+'：'+String(e.message||e));}
    }
    result.historyError=errors.length?errors.join('；').slice(0,900):null;
  }
  async function syncLeague(league,todayOnly=false,daily=false,cached=null) {
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
      // League-wide power is independent from ten-minute player updates.
      // Refresh once after 16:00 Beijing time, and retry on failure.
      const daily=await chrome.runtime.sendMessage({type:'daily-power-due',...currentLease});
      if(!daily?.ok)throw Error(daily?.error||'无法检查每日战力同步状态');
      if(daily.due){
        base.leaguePower=matchup?await leaguePower(league,matchDoc,base,false):{teams:[],week:base.week,expectedTeamCount:0,error:matchupError,updatedAt:new Date().toISOString()};
      }
      await send(base);
      if(daily.due){
        if(base.leaguePower.error)throw Error(base.leaguePower.error);
        const result=await chrome.runtime.sendMessage({type:'daily-power-complete',...currentLease,day:daily.day});
        if(!result?.ok)throw Error(result?.error||'无法保存每日战力同步状态');
      }
      if(matchupError)throw Error(matchupError);return;
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
    await addHistory(league,base.leaguePower,base,cached);
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
    const warnings=[matchupError,base.research?.error,base.research?.seasonError,base.leaguePower?.error,base.leaguePower?.historyError,base.dailyResearch?.error].filter(Boolean);
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
        try{await syncLeague(league,todayOnly,daily,config?.history?.[league.id]);}catch(e){error=String(e.message||e);}
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
    if(message.type==='check-refresh'){checkRefresh();respond({ok:true});}
    if(message.type==='team-context')respond({ok:true,context:ThunderTeamContext.fromDocument(document,location.href)});
  });
})();
