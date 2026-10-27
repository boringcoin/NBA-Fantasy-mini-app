'use strict';
const {KEYS,value}=require('./analysis.cjs');
const weekNumber=week=>Number(/^Week ([1-9]\d?)$/.exec(String(week))?.[1]||0);
const season=s=>s?.seasonYear||Number(String(s?.research?.seasonLabel||'').match(/20\d{2}/)?.[0])||null;
function complete(power,columns,teamID){
  const teams=power?.teams;
  return !!weekNumber(power?.week)&&!power.error&&Array.isArray(columns)&&columns.length>0&&columns.every(k=>KEYS.includes(k))&&new Set(columns).size===columns.length&&Array.isArray(teams)&&teams.length>=4&&teams.length<=24&&teams.length===power.expectedTeamCount&&new Set(teams.map(t=>t.id)).size===teams.length&&teams.some(t=>t.id===teamID)&&teams.every(t=>columns.every(k=>value(t,k)!=null))&&teams.some(t=>value(t,'PTS')>0);
}
function powers(snapshot){
  const map=new Map();
  for(const power of [...(snapshot?.powerHistory||[]),...(snapshot?.leaguePower?.priorWeeks||[]),snapshot?.leaguePower]){
    const columns=power?.columns||snapshot?.columns;
    if(!complete(power,columns,snapshot?.teamID))continue;
    map.set(power.week,{week:power.week,columns,teams:power.teams,expectedTeamCount:power.expectedTeamCount,matchupPairs:power.matchupPairs||[],updatedAt:power.updatedAt||snapshot.leaguePower?.updatedAt||snapshot.receivedAt,seasonYear:power.seasonYear||season(snapshot)});
  }
  return [...map.values()].sort((a,b)=>weekNumber(b.week)-weekNumber(a.week)).slice(0,40);
}
function mergePowerHistory(previous,next){
  const compatible=previous?.leagueID===next.leagueID&&previous?.teamID===next.teamID&&!(season(previous)&&season(next)&&season(previous)!==season(next));
  const map=new Map((compatible?powers(previous):[]).map(p=>[p.week,p]));
  for(const power of powers(next))map.set(power.week,power);
  return [...map.values()].sort((a,b)=>weekNumber(b.week)-weekNumber(a.week)).slice(0,40);
}
function availableWeeks(snapshot){return powers(snapshot).map(p=>({week:p.week,updatedAt:p.updatedAt}));}
function powerSnapshot(snapshot,week){
  const list=powers(snapshot),power=list.find(p=>p.week===week);
  if(!power)throw Error('该周全盟数据尚未同步，请保持 Yahoo 页面打开并点击刷新');
  const historical=week!==snapshot.week;
  const priorWeeks=list.filter(p=>weekNumber(p.week)<weekNumber(week)).slice(0,4);
  // Historical totals must never be exported alongside today's roster averages.
  const pair=power.matchupPairs.find(p=>p.includes(snapshot.teamID))||[snapshot.teamID];
  return {...snapshot,week,columns:power.columns,leaguePower:{...power,priorWeeks},powerHistory:undefined,teams:historical?power.teams.filter(t=>pair.includes(t.id)):snapshot.teams,players:historical?[]:snapshot.players,research:historical?undefined:snapshot.research,dailyResearch:historical?undefined:snapshot.dailyResearch,source:`https://basketball.fantasysports.yahoo.com/nba/${snapshot.leagueID}/matchup?week=${weekNumber(week)}&date=totals`};
}
module.exports={weekNumber,availableWeeks,powerSnapshot,mergePowerHistory,season};
