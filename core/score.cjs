'use strict';
function dayKey(date,zone='Asia/Shanghai'){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));return parts.year+parts.month+parts.day;}
function espnDateForBeijing(key){if(!/^\d{8}$/.test(String(key)))throw Error('比赛日格式无效');const y=Number(key.slice(0,4)),m=Number(key.slice(4,6)),d=Number(key.slice(6,8)),date=new Date(Date.UTC(y,m-1,d));if(date.toISOString().slice(0,10).replaceAll('-','')!==key)throw Error('比赛日无效');date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10).replaceAll('-','');}
function scoreboardDays(now){const key=dayKey(new Date(now),'America/New_York'),base=Date.UTC(Number(key.slice(0,4)),Number(key.slice(4,6))-1,Number(key.slice(6,8)));return [-1,0,1,2].map(offset=>new Date(base+offset*86400000).toISOString().slice(0,10).replaceAll('-',''));}
module.exports={dayKey,scoreboardDays,espnDateForBeijing};
