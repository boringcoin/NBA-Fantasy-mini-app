'use strict';
const LABEL = {'FG%':'投篮命中率','FT%':'罚球命中率','3PTM':'三分','PTS':'得分','OREB':'前场篮板','REB':'总篮板','AST':'助攻','ST':'抢断','BLK':'盖帽','TO':'失误 ↓','A/T':'助失比','GP':'GP'};
const KEYS = Object.keys(LABEL).filter(k=>k!=='GP');
function number(raw) {
  if(raw==null||String(raw).trim()===''||/^[-—]+$/.test(String(raw).trim()))return null;
  const n=Number(String(raw).replace(/[,*]/g,''));return Number.isFinite(n)&&n>=0?n:null;
}
function value(team,key) {
  const s=team?.stats||{};
  if(key==='FG%'||key==='FT%') {
    const raw=s[key==='FG%'?'FGM/A':'FTM/A'];
    if(raw!=null&&String(raw).includes('/')){const [a,b]=String(raw).split('/').map(number);return a!=null&&b>0?a/b:null;}
  }
  if(key==='A/T'){const a=number(s.AST),b=number(s.TO);if(a!=null&&b>0)return a/b;}
  return number(s[key]);
}
function compare(a,b,columns){
  const m={left:a.id,right:b.id,won:[],lost:[],tied:[]};
  for(const k of columns){const x=value(a,k),y=value(b,k);if(x==null||y==null)continue;const d=(x-y)*(k==='TO'?-1:1);m[Math.abs(d)<1e-10?'tied':d>0?'won':'lost'].push(k);}return m;
}
function rankTeams(teams,columns){
  const rows=teams.map(t=>{
    const ranks={};let points=0;
    for(const k of columns){const x=value(t,k),better=teams.filter(o=>(value(o,k)-x)*(k==='TO'?-1:1)>1e-10).length,equal=teams.filter(o=>Math.abs(value(o,k)-x)<1e-10).length;ranks[k]=better+1+(equal-1)/2;points+=teams.length+1-ranks[k];}
    return {id:t.id,points,score:points,ranks,wins:0,losses:0,ties:0};
  });
  rows.forEach(r=>r.rank=1+rows.filter(o=>o.points>r.points+1e-10).length);return rows.sort((a,b)=>a.rank-b.rank||String(a.id).localeCompare(String(b.id)));
}
function analyze(snapshot){
  const p=snapshot?.leaguePower,teams=p?.teams||[],columns=(snapshot?.columns||[]).filter(k=>KEYS.includes(k));
  const fail=message=>({rows:[],matchups:[],luck:[],categories:columns,message,scheduleComplete:false});
  if(p?.error)return fail(p.error);
  if(teams.length<4||teams.length>24||teams.length!==p?.expectedTeamCount||new Set(teams.map(t=>t.id)).size!==teams.length||!teams.some(t=>t.id===snapshot.teamID))return fail('全盟数据尚未收齐，暂不生成排名');
  if(p.week!==snapshot.week)return fail('统计周次不一致，请手动刷新');
  if(!columns.length||teams.some(t=>columns.some(k=>value(t,k)==null)))return fail('计分项目存在缺失数据，暂不生成完整排名');
  if(!teams.some(t=>(value(t,'PTS')||0)>0))return fail('本周比赛尚未产生统计数据');
  const rows=rankTeams(teams,columns),byRow=new Map(rows.map(r=>[r.id,r])),byTeam=new Map(teams.map(t=>[t.id,t])),matchups=[];
  for(let i=0;i<teams.length;i++)for(let j=i+1;j<teams.length;j++){
    const m=compare(teams[i],teams[j],columns);matchups.push(m);const a=byRow.get(m.left),b=byRow.get(m.right),d=m.won.length-m.lost.length;
    if(d>0){a.wins++;b.losses++;}else if(d<0){a.losses++;b.wins++;}else{a.ties++;b.ties++;}
  }
  const pairs=p.matchupPairs||[],members=pairs.flat();
  const scheduleComplete=pairs.every(x=>Array.isArray(x)&&x.length===2&&x[0]!==x[1])&&members.length===teams.length&&new Set(members).size===teams.length&&members.every(id=>byTeam.has(id));
  const history=(p.priorWeeks||[]).filter(h=>Number(String(h.week).match(/\d+/)?.[0])<Number(String(p.week).match(/\d+/)?.[0])).sort((a,b)=>Number(b.week.match(/\d+/)?.[0])-Number(a.week.match(/\d+/)?.[0])).slice(0,4).filter(h=>h.expectedTeamCount===teams.length&&h.teams?.length===teams.length&&new Set(h.teams.map(t=>t.id)).size===teams.length&&teams.every(t=>h.teams.some(o=>o.id===t.id))&&h.teams.every(t=>columns.every(k=>value(t,k)!=null))).map(h=>rankTeams(h.teams,columns));
  const luck=rows.map(r=>{
    const team=byTeam.get(r.id),opponent=scheduleComplete?pairs.find(pair=>pair.includes(r.id)).find(id=>id!==r.id):null;
    const points=teams.filter(t=>t.id!==r.id).map(t=>{const m=compare(team,t,columns);return m.won.length+m.tied.length*.5;}).sort((a,b)=>a-b),mid=Math.floor(points.length/2),median=points.length%2?points[mid]:(points[mid-1]+points[mid])/2;
    const actualMatch=opponent?compare(team,byTeam.get(opponent),columns):null,actual=actualMatch?actualMatch.won.length+actualMatch.tied.length*.5:null;
    let opponentDifference=null,opponentForm='历史样本不足';
    if(opponent&&history.length>=2){const past=history.map(h=>h.find(r=>r.id===opponent).points);opponentDifference=byRow.get(opponent).points-past.reduce((a,b)=>a+b,0)/past.length;opponentForm=opponentDifference>.05?'爆种':opponentDifference<-.05?'失常':'接近均值';}
    const narrow=keys=>keys.filter(k=>{if(k==='A/T')return false;const d=Math.abs(value(team,k)-value(byTeam.get(opponent),k));return d>1e-10&&d<=(['FG%','FT%'].includes(k)?.01:1)+1e-10;});
    return {id:r.id,opponent,median,actual,difference:actual==null?null:actual-median,opponentForm,opponentDifference,closeResult:actualMatch&&Math.abs(actualMatch.won.length-actualMatch.lost.length)===1,narrowWins:actualMatch?narrow(actualMatch.won):[],narrowLosses:actualMatch?narrow(actualMatch.lost):[]};
  });
  return {rows,matchups,luck,categories:columns,message:scheduleComplete?'':'尚未获取完整实际配对，走位分析暂不可用',scheduleComplete};
}
function health(player){
  const text=String(player?.info||'')+' '+String(player?.status||'');
  const tail=text.startsWith(player?.name||'\0')?text.slice(player.name.length):text;
  if(/\b(?:INJ|IL\+?|OUT|OFS|O|SUSP|NA)\b|受伤|裁掉|无球队|停赛|waived|released|unsigned/i.test(tail)||/\b(?:FA|N\/A)\s*-\s*(?:PG|SG|SF|PF|C)\b/i.test(tail))return '暂不可出场';
  if(/\b(?:GTD|DTD|Q|D)\b/i.test(tail))return '出场待定';
  if(!/\b(?:ATL|BOS|BKN|BRK|CHA|CHI|CLE|DAL|DEN|DET|GSW|GS|HOU|IND|LAC|LAL|MEM|MIA|MIL|MIN|NOP|NO|NYK|NY|OKC|ORL|PHI|PHX|POR|SAC|SAS|SA|TOR|UTA|UTAH|WAS|WSH)\s*-\s*(?:PG|SG|SF|PF|C)\b/.test(tail))return '所属球队待确认';
  return '未发现伤停标记';
}
function playerValues(snapshot,mode='balanced'){
  const research=snapshot.dailyResearch,own=snapshot.players||[],columns=(snapshot.columns||[]).filter(k=>KEYS.includes(k));
  const recent=new Map([...(research?.recent||[]),...(snapshot.research?.recent||[])].map(p=>[p.id,p]));
  const season=new Map((snapshot.research?.season||[]).map(p=>[p.id,p])),prior=new Map([...(research?.prior||[]),...(snapshot.research?.prior||[])].map(p=>[p.id,p]));
  const available=(research?.available||[]).filter(p=>!own.some(o=>o.id===p.id)&&/^(FA|W\b)/.test(p.availability||''));
  const rates=p=>{
    if(!p||(value(p,'GP')||0)<=0)return null;
    const r={};for(const [pair,made,attempts]of [['FGM/A','FGM','FGA'],['FTM/A','FTM','FTA']]){const bits=String(p.stats?.[pair]||'').split('/').map(number);if(bits.length!==2||bits.some(v=>v==null)||bits[0]>bits[1])return null;r[made]=bits[0];r[attempts]=bits[1];}
    for(const k of ['3PTM','PTS','OREB','REB','AST','ST','BLK','TO']){const v=value(p,k);if(v==null&&columns.includes(k))return null;r[k]=v||0;}return r;
  };
  const selected=new Map();
  for(const p of [...own,...available]){
    const current=recent.get(p.id),historical=prior.get(p.id),fallback=season.get(p.id),currentRates=rates(current),priorRates=rates(historical),ng=currentRates?(value(current,'GP')||0):0,pg=priorRates?(value(historical,'GP')||0):0;
    let row=currentRates?current:priorRates?historical:rates(fallback)?fallback:null;if(!row)continue;
    let combined=rates(row),source=currentRates?'近14天场均':priorRates?'上季场均基线':'本赛季场均';
    if(priorRates){const weight=currentRates?ng/(ng+12):0;combined=Object.fromEntries(Object.keys(priorRates).map(k=>[k,priorRates[k]*(1-weight)+(currentRates?.[k]||0)*weight]));source=`近期 ${ng} 场 + 上季 ${pg} 场（近期权重 ${(weight*100).toFixed(0)}%）`;}
    selected.set(p.id,{player:{...row,...p,stats:row.stats},rates:combined,sample:currentRates?ng:priorRates?0:value(row,'GP'),priorSample:pg,source});
  }
  const stable=own.map(p=>selected.get(p.id)).filter(r=>r&&(r.sample>=5||r.priorSample>=20));
  if(stable.length<4)return {owned:own.map(p=>({player:p,score:null,health:health(p),sample:selected.get(p.id)?.sample??null,source:selected.get(p.id)?.source||'无有效场均样本'})),recommendations:[],message:'本队稳定样本不足 4 人，暂不生成价值分和换人推荐；需要近期至少 5 场或上季至少 20 场。'};
  const total=k=>stable.reduce((n,r)=>n+r.rates[k],0),fg=total('FGA')>0?total('FGM')/total('FGA'):null,ft=total('FTA')>0?total('FTM')/total('FTA'):null,at=total('TO')>0?total('AST')/total('TO'):null;
  if((columns.includes('FG%')&&fg==null)||(columns.includes('FT%')&&ft==null)||(columns.includes('A/T')&&at==null))return {owned:[],recommendations:[],message:'出手或失误数据不足，无法正确计算比例贡献。'};
  const features=r=>({...r,'FG%':r.FGM-(fg||0)*r.FGA,'FT%':r.FTM-(ft||0)*r.FTA,'A/T':r.AST-(at||0)*r.TO,TO:-r.TO});
  const reference=stable.map(r=>features(r.rates)),moments=Object.fromEntries(columns.map(k=>{const ns=reference.map(r=>r[k]),mean=ns.reduce((a,b)=>a+b,0)/ns.length,sd=Math.sqrt(ns.reduce((a,b)=>a+(b-mean)**2,0)/ns.length);return [k,{mean,sd}];}));
  const weighting=Object.fromEntries(columns.map(k=>[k,1]));if(mode==='needs'&&snapshot.teams?.length===2){const mine=snapshot.teams.find(t=>t.id===snapshot.teamID),other=snapshot.teams.find(t=>t.id!==snapshot.teamID);if(mine&&other)for(const k of columns){const x=value(mine,k),y=value(other,k);if(x!=null&&y!=null&&(x-y)*(k==='TO'?-1:1)<0)weighting[k]=1.25;}}
  const rate=p=>{const row=selected.get(p.id);if(!row)return {player:p,score:null,zs:{},health:health(p),sample:null,source:'无有效场均样本'};const f=features(row.rates),zs=Object.fromEntries(columns.map(k=>[k,moments[k].sd>1e-6?(f[k]-moments[k].mean)/moments[k].sd:0]));return {...row,zs,health:health(p),score:columns.reduce((n,k)=>n+zs[k]*weighting[k],0)/Object.values(weighting).reduce((a,b)=>a+b,0)};};
  const owned=own.map(rate),pool=available.filter(p=>health(p)==='未发现伤停标记').map(rate).filter(p=>p.score!=null);
  const positions=p=>new Set((p.eligible||p.info?.match(/-\s*((?:PG|SG|SF|PF|C)(?:,(?:PG|SG|SF|PF|C))*)/)?.[1]||p.position||'').split(',').map(x=>x.trim()).filter(Boolean));
  const stale=Date.now()-new Date(snapshot.receivedAt).getTime()>15*60*1000;
  const recommendations=stale?[]:owned.filter(r=>r.score!=null).sort((a,b)=>a.score-b.score).slice(0,5).flatMap(out=>{const pos=positions(out.player);return pool.filter(row=>[...positions(row.player)].some(p=>pos.has(p))).sort((a,b)=>b.score-a.score).slice(0,20).filter(row=>row.score>out.score+.1).slice(0,1).map(row=>({out:out.player,into:row.player,gain:row.score-out.score,improves:columns.filter(k=>row.zs[k]>out.zs[k]).sort((a,b)=>(row.zs[b]-out.zs[b])-(row.zs[a]-out.zs[a])).slice(0,3),costs:columns.filter(k=>row.zs[k]<out.zs[k]).slice(0,3),sample:row.sample,outSample:out.sample}));});
  return {owned:owned.sort((a,b)=>(b.score??-Infinity)-(a.score??-Infinity)),recommendations,message:stale?'当前状态超过 15 分钟未更新，请刷新后再查看换人参考。':research?.error||(!research?'尚未同步当前自由球员池，仅显示自己的球员。':'参考当前池子前 100 位，按相同位置前 20 位候选分析。')};
}
module.exports={KEYS,LABEL,number,value,compare,analyze,playerValues,health};
