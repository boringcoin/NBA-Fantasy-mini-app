(() => {
  if(!/^\/nba\/\d+(?:\/|$)/.test(location.pathname))return;
  let leagues=[];
  let busy=false, lastRequestID=null, activeRequestID=null, activeTodayOnly=false, queuedManualID=null;
  const parse=html=>new DOMParser().parseFromString(html,'text/html');
  async function get(url) {
    const r=await fetch(url,{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!r.ok || new URL(r.url).hostname!==location.hostname)throw Error('雅虎页面请求失败或登录失效');
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
    const result=await chrome.runtime.sendMessage({type:'snapshot',data});
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
      if(rows.size!==ids.size||![...ids].every(id=>rows.has(id)))throw Error(`仅获取 ${rows.size}/${ids.size} 队，暂不生成全盟排名`);
      const pairs=matches.filter(m=>m.ids.every(id=>ids.has(id))).map(m=>m.ids);
      const members=pairs.flat();
      const matchupPairs=members.length===ids.size&&new Set(members).size===ids.size?pairs:null;
      const result={...empty,teams:[...rows.values()],matchupPairs,updatedAt:new Date().toISOString()};
      if(withHistory) {
        result.priorWeeks=[];const errors=[];
        // Completed weeks only; bounded to four. Never run on ten-minute today-only syncs.
        for(let prior=Number(week)-1;prior>=Math.max(1,Number(week)-4);prior--) {
          try {
            const url=new URL(`/nba/${league.id}/matchup`,location.origin);
            url.searchParams.set('week',String(prior));url.searchParams.set('date','totals');
            const doc=await get(url);
            if((doc.body.textContent.match(/Week\s+(\d+)/)||[])[1]!==String(prior))throw Error('历史周次不一致');
            const parsed=YahooParser.fromDocument(doc);
            if(parsed.teams.length!==2)throw Error('历史对局不完整');
            const power=await leaguePower(league,doc,{week:'Week '+prior,teams:parsed.teams},false);
            if(power.error)throw Error(power.error);
            result.priorWeeks.push({week:power.week,teams:power.teams,expectedTeamCount:power.expectedTeamCount,matchupPairs:power.matchupPairs});
          } catch(e) {errors.push('Week '+prior+'：'+String(e.message||e));}
        }
        result.historyError=errors.length?errors.join('；').slice(0,900):null;
      }
      return result;
    } catch(e) {return {...empty,error:String(e.message||e)};}
  }
  async function syncLeague(league,todayOnly=false,daily=false) {
    YahooParser.setLeague(league.id);
    const matchupURL=new URL(`/nba/${league.id}/matchup`,location.origin);
    matchupURL.searchParams.set('date','totals');
    const [matchDoc,rosterDoc]=await Promise.all([get(matchupURL),get(rosterURL(league))]);
    const matchup=YahooParser.fromDocument(matchDoc),roster=YahooParser.fromDocument(rosterDoc);
    if(matchup.teams.length!==2||!matchup.teams.some(t=>t.id===league.team)||!roster.players.length)throw Error(league.name+'：未识别到对局和阵容');
    const base={league:league.name,leagueID:league.id,teamID:league.team,week:(matchDoc.body.textContent.match(/Week\s+\d+/)||[])[0]||'本周',receivedAt:new Date().toISOString(),columns:matchup.columns,teams:matchup.teams,players:roster.players,source:matchupURL.href};
    if(todayOnly) {
      const playing=roster.players.filter(hasGameToday);
      const ids=new Set(playing.map(p=>p.id));
      base.syncScope='today';base.todayPlayerIDs=[...ids];
      // Keep the roster, but send statistics only for players on today's Yahoo slate.
      base.players=roster.players.map(p=>ids.has(p.id)?p:{...p,stats:{}});
      if(ids.size)base.recentUpdates=YahooParser.fromDocument(await get(rosterURL(league,'AL14'))).players.filter(p=>ids.has(p.id));
      await send(base);return;
    }
    const years=Array.from(rosterDoc.querySelectorAll('a[href]')).map(a=>(a.textContent||'').trim().match(/^(20\d{2})[-–]\d{2}(?:\s+Season)?$/i)).filter(Boolean).map(m=>Number(m[1]));
    const seasonYear=years.length?Math.max(...years):new Date().getFullYear()-(new Date().getMonth()<8?1:0);
    base.syncScope='full';
    await send(base);
    try {
      // Every metric below is an average per appearance, with GP retained for sample size.
      const recent=YahooParser.fromDocument(await get(rosterURL(league,'AL14'))).players;
      const prior=YahooParser.fromDocument(await get(rosterURL(league,'AS_'+(seasonYear-1)))).players;
      const ownedIDs=new Set(roster.players.map(p=>p.id));
      base.research={recent:recent.filter(p=>ownedIDs.has(p.id)),prior:prior.filter(p=>ownedIDs.has(p.id)),baselineIDs:[...ownedIDs],available:[],period:'我的球员：近14天场均' ,updatedAt:new Date().toISOString(),error:null};
    } catch(error) {base.research={recent:[],prior:[],baselineIDs:[],available:[],period:'',updatedAt:new Date().toISOString(),error:String(error.message||error)};}
    // League totals are fetched only on a manual refresh or the existing daily run.
    // The ten-minute refresh still touches only today's owned players.
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
    base.leaguePower=await leaguePower(league,matchDoc,base);
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
    if(base.research?.error)throw Error(league.name+'：'+base.research.error);
  }
  async function sync(requestID=null,todayOnly=false,daily=false,targetLeague=null) {
    if(busy)return;busy=true;let acquired=false;
    try {
      // One tab is enough to synchronize both requested leagues.
      const config=await chrome.runtime.sendMessage({type:'get-config'});
      leagues=config?.leagues||[];
      if(!leagues.some(l=>new RegExp('^/nba/'+l.id+'(?:/|$)').test(location.pathname)))return;
      const selected=leagues.filter(l=>(!targetLeague||l.id===targetLeague)&&(!daily||requestID||l.dailyFreeAgents));
      if(!selected.length)return;
      const lock=await chrome.runtime.sendMessage({type:'acquire-sync',todayOnly});
      if(!lock?.ok)return;acquired=true;
      if(daily&&!requestID){const claim=await chrome.runtime.sendMessage({type:'acquire-daily'});if(!claim?.ok)return;}
      activeRequestID=requestID;activeTodayOnly=todayOnly;
      if(requestID){lastRequestID=requestID;await chrome.runtime.sendMessage({type:'refresh-status',requestID,state:'started'});}
      const errors=[];
      for(const league of selected){try{await syncLeague(league,todayOnly,daily);}catch(e){errors.push(String(e.message||e));}}
      chrome.runtime.sendMessage({type:'status',ok:errors.length===0,error:errors.join('；'),time:Date.now()}).catch(()=>{});
      if(activeRequestID)await chrome.runtime.sendMessage({type:'refresh-status',requestID:activeRequestID,state:'completed',error:errors.join('；')});
    } catch(error){chrome.runtime.sendMessage({type:'status',ok:false,error:String(error.message||error),time:Date.now()}).catch(()=>{});if(activeRequestID&&acquired)await chrome.runtime.sendMessage({type:'refresh-status',requestID:activeRequestID,state:'completed',error:String(error.message||error)}).catch(()=>{});}
    finally{if(acquired)await chrome.runtime.sendMessage({type:'release-sync'}).catch(()=>{});busy=false;activeRequestID=null;activeTodayOnly=false;const queued=queuedManualID;queuedManualID=null;if(queued)await sync(queued.requestID,false,queued.scope==='recommendations',queued.leagueID||null);}
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
      if(command?.ok&&command.requestID&&command.requestID!==lastRequestID) {
        if(busy) {
          queuedManualID=command;lastRequestID=command.requestID;
        } else await sync(command.requestID,false,command.scope==='recommendations',command.leagueID||null);
      }
    } catch {}
  };
  setInterval(checkRefresh,5000);
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message.type==='auto-sync')sync(null,true);
    if(message.type==='check-refresh')checkRefresh();
    if(message.type==='team-context')respond({ok:true,context:ThunderTeamContext.fromDocument(document,location.href)});
  });
})();
