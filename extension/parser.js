(function(root) {
  const columns = ['FG%','FT%','3PTM','PTS','OREB','REB','AST','ST','BLK','TO','A/T'];
  function clean(value) { return String(value || '').replace(/\s+/g,' ').trim(); }
  function header(value) {
    const v=clean(value).toUpperCase().replace(/\*/g,'');
    const aliases={'3PM':'3PTM','3PT':'3PTM','STL':'ST','AST/TO':'A/T','FGM/A':'FGM/A','FTM/A':'FTM/A','GP':'GP','% ROS':'%ROS'};
    return aliases[v] || v;
  }
  function parseTables(tables) {
    const result={columns,teams:[],players:[]};
    for(const table of tables) {
      const rows=table.rows;
      let labels=null;
      for(const row of rows) {
        const cells=row.cells;
        const candidate=cells.map(c=>header(c.text));
        if(candidate.includes('FG%') && candidate.includes('PTS') && candidate.includes('TO')) { labels=candidate; const scoring=columns.filter(k=>{const i=candidate.indexOf(k);return i>=0&&!String(cells[i].text).includes('*');});if(scoring.length>=8)result.columns=scoring;continue; }
        if(!labels || cells.length<labels.length) continue;
        const stats={};
        labels.forEach((key,i)=>{if([...columns,'GP','FGM/A','FTM/A','MPG','%ROS'].includes(key))stats[key]=clean(cells[i]?.text);});
        if(Object.keys(stats).length<8)continue;
        const playerCell=cells.find(c=>c.player);
        if(playerCell) {
          const positionIndex=labels.findIndex(l=>l==='POS');
          let position=positionIndex<0?'':clean(cells[positionIndex].text);
          if(!position&&positionIndex>=0)position=(cells[positionIndex].label||'').match(/edit\s+(\S+)/i)?.[1]||'';
          const availabilityIndex=labels.indexOf('ROSTER STATUS');
          const availability=availabilityIndex<0?'':clean(cells[availabilityIndex].text);
          const eligible=(clean(playerCell.text).match(/-\s*((?:(?:PG|SG|SF|PF|C)(?:,|\b))+)/)||[])[1]||'';
          if(!result.players.some(p=>p.id===playerCell.player.id))result.players.push({name:playerCell.player.name,id:playerCell.player.id,position,availability,eligible,info:clean(playerCell.text).replace(/(?:New )?Player Note/g,''),stats});
        } else {
          const teamCell=cells.find(c=>c.team);
          if(teamCell && !result.teams.some(t=>t.id===teamCell.team.id))result.teams.push({...teamCell.team,stats});
        }
      }
    }
    return result;
  }
  function matchupGP(text) {
    const match=clean(text).match(/(\d+)\s*\/\s*(\d+)\s*Games\s+Played\s*(\d+)\s*\/\s*(\d+)/i);
    if(!match)return null;
    const values=[Number(match[1]),Number(match[3])];
    return values.every(Number.isSafeInteger)?values:null;
  }
  let contextLeague='';
  function setLeague(id){if(!/^\d+$/.test(String(id)))throw Error('联盟 ID 无效');contextLeague=String(id);}
  function fromDocument(doc) {
    const tables=Array.from(doc.querySelectorAll('table')).map(table=>({rows:Array.from(table.rows).map(row=>({cells:Array.from(row.cells).map(cell=>{
      const playerLink=cell.querySelector('a[href*="sports.yahoo.com/nba/players/"]');
      const links=Array.from(cell.querySelectorAll('a[href]'));
      const teamLink=links.find(a=>new RegExp('^/nba/'+contextLeague+'/\\d+(?:[?#]|$)').test(new URL(a.getAttribute('href'),'https://basketball.fantasysports.yahoo.com').pathname) && clean(a.textContent));
      let player=null,team=null;
      if(playerLink){const url=new URL(playerLink.getAttribute('href'),'https://sports.yahoo.com');player={name:clean(playerLink.textContent),id:url.pathname.split('/').filter(Boolean).pop()};}
      if(teamLink){const url=new URL(teamLink.getAttribute('href'),'https://basketball.fantasysports.yahoo.com');team={name:clean(teamLink.textContent),id:url.pathname.split('/').filter(Boolean).pop()};}
      return {text:cell.innerText || cell.textContent,label:cell.querySelector('button')?.getAttribute('aria-label')||'',player,team};
    })}))}));
    const result=parseTables(tables);
    const scoreTable=Array.from(doc.querySelectorAll('table')).find(t=>t.textContent.includes('Compare Managers'));
    const scores=scoreTable?Array.from(scoreTable.querySelectorAll('td')).map(c=>clean(c.textContent)).filter(v=>/^\d+$/.test(v)):[];
    if(scores.length===2 && result.teams.length===2)result.teams.forEach((t,i)=>{t.wins=Number(scores[i]);});
    // Yahoo keeps matchup GP above the statistics table, in left/right team order.
    const gp=matchupGP(doc.body?.textContent||'');
    if(gp && result.teams.length===2)result.teams.forEach((t,i)=>{t.stats.GP=String(gp[i]);});
    return result;
  }
  function leagueLinks(doc,leagueID,week,origin='https://basketball.fantasysports.yahoo.com') {
    const teamIDs=new Set(),matchups=new Map();
    for(const a of doc.querySelectorAll('a[href]')) {
      let u;try{u=new URL(a.getAttribute('href'),origin);}catch{continue;}
      if(u.origin!==origin)continue;
      const team=u.pathname.match(new RegExp(`^/nba/${leagueID}/(\\d+)$`));
      if(team)teamIDs.add(team[1]);
      if(u.pathname!==`/nba/${leagueID}/matchup`)continue;
      const one=u.searchParams.get('mid1'),two=u.searchParams.get('mid2'),w=u.searchParams.get('week');
      if(!/^\d+$/.test(one||'')||!/^\d+$/.test(two||'')||one===two||(w&&w!==week))continue;
      const key=[one,two].sort().join(':');
      const url=new URL(u.pathname,origin);
      for(const [k,v] of Object.entries({week,mid1:one,mid2:two,date:'totals'}))url.searchParams.set(k,v);
      matchups.set(key,{url:url.href,ids:[one,two]});
    }
    return {teamIDs:[...teamIDs],matchups:[...matchups.values()]};
  }
  root.YahooParser={setLeague,columns,parseTables,fromDocument,leagueLinks,matchupGP};
  if(typeof module!=='undefined')module.exports=root.YahooParser;
})(globalThis);
