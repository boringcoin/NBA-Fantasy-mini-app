'use strict';
const {powers,weekNumber}=require('./weeks.cjs');
const {rankTeams,value}=require('./analysis.cjs');
function seasonPower(snapshot){
  const current=weekNumber(snapshot?.week),history=powers(snapshot),byWeek=new Map(history.map(p=>[weekNumber(p.week),p]));
  if(!current)return {error:'无法确认当前周次，请先同步联盟数据。'};
  const missing=Array.from({length:current},(_,i)=>i+1).filter(n=>!byWeek.has(n));
  if(missing.length)return {error:`缺少第 ${missing.join('、')} 周的完整联盟数据，暂不能计算赛季累计。`,missing};
  const weeks=Array.from({length:current},(_,i)=>byWeek.get(i+1)),latest=weeks[current-1],columns=latest.columns;
  const sameSet=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
  const ids=latest.teams.map(t=>t.id);
  if(weeks.some(w=>!sameSet(w.columns,columns)||!sameSet(w.teams.map(t=>t.id),ids)))return {error:'历史周的球队或计分项目不一致，暂不能计算赛季累计。'};
  const teams=[];
  for(const base of latest.teams){
    const entries=weeks.map(w=>w.teams.find(t=>t.id===base.id)),stats={};
    for(const k of [...new Set([...columns,'GP','AST','TO'])].filter(k=>!['FG%','FT%','A/T'].includes(k))){
      const values=entries.map(t=>value(t,k));
      if(values.some(v=>v==null)){if(columns.includes(k)||(['AST','TO'].includes(k)&&columns.includes('A/T')))return {error:`第 1 至 ${current} 周有球队缺少 ${k} 数据，暂不能计算。`};continue;}
      stats[k]=values.reduce((a,b)=>a+b,0);
    }
    for(const [cat,pair] of [['FG%','FGM/A'],['FT%','FTM/A']])if(columns.includes(cat)){
      const parts=entries.map(t=>{const v=String(t.stats?.[pair]??'').match(/^(\d+)\s*\/\s*(\d+)$/);return v?[+v[1],+v[2]]:null});
      if(parts.some(p=>!p||p[0]>p[1]))return {error:`第 1 至 ${current} 周缺少完整${cat==='FG%'?'投篮':'罚球'}命中和出手数据，无法准确计算。`};
      const made=parts.reduce((a,p)=>a+p[0],0),attempt=parts.reduce((a,p)=>a+p[1],0);
      if(!attempt)return {error:'有球队累计出手次数为零，无法计算命中率排名。'};
      stats[pair]=`${made}/${attempt}`;stats[cat]=made/attempt;
    }
    if(columns.includes('A/T')){if(!stats.TO)return {error:'有球队累计失误为零，无法计算助失比排名。'};stats['A/T']=stats.AST/stats.TO;}
    teams.push({...base,stats});
  }
  const trend=weeks.map(w=>({week:w.week,rows:rankTeams(w.teams,columns)}));
  return {columns,teams,rows:rankTeams(teams,columns),trend,throughWeek:current,updatedAt:latest.updatedAt};
}
module.exports={seasonPower};
