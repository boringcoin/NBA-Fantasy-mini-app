'use strict';
function normalize(raw){
 if(!Array.isArray(raw?.injuries)||raw.injuries.length<20)throw Error('ESPN 伤病数据不完整');
 const players=raw.injuries.flatMap(g=>(g.injuries||[]).map(i=>({id:String(i.athlete?.id||''),name:i.athlete?.displayName||'',team:g.displayName||'',status:i.status||'',injury:i.details?.type||'',returnDate:i.details?.returnDate||'',newsDate:i.date||'',news:i.longComment||i.shortComment||''}))).filter(p=>p.name);
 if(!players.length)throw Error('ESPN 伤病名单为空');return players;
}
function signature(p){return JSON.stringify([p.status,p.injury,p.returnDate,p.newsDate,p.news]);}
function changes(followed,baseline,players){const next={...baseline},alerts=[];for(const name of followed){const p=players.find(x=>x.name.toLowerCase()===name.toLowerCase());if(!p)continue;const key=name.toLowerCase(),sig=signature(p);if(next[key]&&next[key]!==sig)alerts.push(p.name);next[key]=sig;}return {baseline:next,alerts};}
module.exports={normalize,changes};
