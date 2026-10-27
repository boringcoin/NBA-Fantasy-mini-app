'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {KEYS}=require('./analysis.cjs');
const numeric=v=>typeof v==='string'&&/^\d{1,10}$/.test(v);
function validateLeagues(input){
  if(!Array.isArray(input)||input.length>12)throw Error('最多配置 12 个联盟');
  const seen=new Set();return input.map(l=>{if(!numeric(l.id)||!numeric(l.team)||Number(l.team)<1||Number(l.team)>48||seen.has(l.id))throw Error('联盟 ID、球队 ID 必须有效且不能重复');seen.add(l.id);return {id:l.id,team:l.team,name:String(l.name||'联盟 '+l.id).trim().slice(0,80),theme:['white','dark','warm','gray'].includes(l.theme)?l.theme:'white',dailyFreeAgents:l.dailyFreeAgents===true};});
}
function validateSnapshot(data,leagues){
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('无效的数据包');
  const league=leagues.find(l=>l.id===data.leagueID&&l.team===data.teamID);if(!league)throw Error('该联盟或球队未在桌面应用中配置');
  const columns=data.columns;if(!Array.isArray(columns)||!columns.length||columns.length>11||columns.some(k=>!KEYS.includes(k))||new Set(columns).size!==columns.length)throw Error('不支持的计分项目');
  const text=JSON.stringify(data);if(text.length>2*1024*1024)throw Error('数据包过大');
  JSON.parse(text,(key,v)=>{if(['__proto__','prototype','constructor'].includes(key))throw Error('无效字段');if(typeof v==='string'&&v.length>8000)throw Error('字段过长');return v;});
  if(!Array.isArray(data.players)||data.players.length>80||!Array.isArray(data.teams)||data.teams.length>24)throw Error('球员或球队数据异常');
  function validatePeople(rows,limit){if(!Array.isArray(rows)||rows.length>limit)throw Error('统计条数异常');for(const p of rows){if(!numeric(p.id)||typeof p.name!=='string'||p.name.length>200||!p.stats||typeof p.stats!=='object'||Array.isArray(p.stats))throw Error('统计格式异常');for(const [key,v] of Object.entries(p.stats)){if(key.length>30||!['string','number'].includes(typeof v)||String(v).length>100)throw Error('统计值异常');}}}
  validatePeople(data.players,80);validatePeople(data.teams,24);
  for(const research of [data.research,data.dailyResearch])if(research)for(const key of ['recent','prior','season','available'])if(research[key])validatePeople(research[key],180);
  if(data.recentUpdates)validatePeople(data.recentUpdates,80);
  if(data.leaguePower){validatePeople(data.leaguePower.teams,24);if((data.leaguePower.priorWeeks||[]).length>4)throw Error('历史周次过多');for(const week of data.leaguePower.priorWeeks||[])validatePeople(week.teams,24);}
  const source=new URL(data.source);if(source.origin!=='https://basketball.fantasysports.yahoo.com'||!source.pathname.startsWith('/nba/'+league.id+'/'))throw Error('无效数据来源');
  return {...data,league:league.name,receivedAt:new Date().toISOString()};
}
function mergeSnapshot(previous,next){
  if(!previous)return next;
  const merged={...previous,...next};
  if(previous.teamID!==next.teamID)return next;
  if(next.research)merged.research={...(previous.research||{}),...next.research};
  if(next.syncScope==='today'){
    const owned=new Set(next.players.map(p=>p.id)),updates=new Map((next.recentUpdates||[]).map(p=>[p.id,p]));
    const recent=new Map((previous.research?.recent||[]).filter(p=>owned.has(p.id)).map(p=>[p.id,p]));for(const [id,p] of updates)if(owned.has(id))recent.set(id,p);
    merged.research={...(previous.research||{}),recent:[...recent.values()]};
  }
  return merged;
}
class State {
  constructor(dir){this.dir=dir;this.file=path.join(dir,'settings.json');this.data={version:2,leagues:[],clients:{},snapshots:{},selectedLeague:null};if(fs.existsSync(this.file)){const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));this.data={...this.data,...saved,leagues:validateLeagues(saved.leagues||[])};}this.command=null;this.syncStatus=null;this.pairing=null;}
  save(){fs.mkdirSync(this.dir,{recursive:true,mode:0o700});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.data),{mode:0o600});fs.renameSync(temp,this.file);try{fs.chmodSync(this.file,0o600);}catch{}}
  configure(leagues){this.data.leagues=validateLeagues(leagues);const allowed=new Set(leagues.map(l=>l.id));for(const id of Object.keys(this.data.snapshots))if(!allowed.has(id)||this.data.snapshots[id].teamID!==leagues.find(l=>l.id===id)?.team)delete this.data.snapshots[id];for(const l of leagues)if(this.data.snapshots[l.id])this.data.snapshots[l.id].league=l.name;this.save();}
  importLeague(input){
    if(!input||typeof input.source!=='string'||input.source.length>2000)throw Error('请打开自己的 Yahoo My Team 球队页');
    let url;try{url=new URL(input.source);}catch{throw Error('球队网页地址无效');}
    const match=url.pathname.match(/^\/nba\/([1-9]\d{0,9})\/([1-9]\d?)\/?$/);
    if(url.origin!=='https://basketball.fantasysports.yahoo.com'||url.username||url.password||!match||Number(match[2])>48)throw Error('请打开自己的 Yahoo My Team 球队页，不能从联盟首页或对局页导入');
    const [id,team]=match.slice(1),existing=this.data.leagues.find(l=>l.id===id);
    if(existing&&existing.team!==team)throw Error('这个联盟已配置另一支球队；如需更换，请在桌面应用设置中修改球队 ID');
    const name=typeof input.name==='string'?input.name.trim().slice(0,80):'';
    const league=existing||{id,team,name:name||'联盟 '+id,theme:'white',dailyFreeAgents:false};
    if(!existing)this.configure([...this.data.leagues,league]);
    this.data.selectedLeague=id;this.save();this.refresh('full');return league;
  }
  newCode(){this.pairing={code:String(crypto.randomInt(100000,1000000)),expires:Date.now()+180000,attempts:0};return {code:this.pairing.code,expires:this.pairing.expires};}
  pair(code,extensionID){const p=this.pairing;if(!p||Date.now()>p.expires||p.attempts>=5)throw Error('配对码已失效，请在桌面应用重新生成');p.attempts++;if(!/^\d{6}$/.test(code)||!crypto.timingSafeEqual(Buffer.from(code),Buffer.from(p.code)))throw Error('配对码不正确');const token=crypto.randomBytes(32).toString('hex'),clientID=crypto.randomUUID();this.data.clients[clientID]={extensionID,hash:crypto.createHash('sha256').update(token).digest('hex'),createdAt:new Date().toISOString()};this.pairing=null;this.save();return {token,clientID};}
  authorize(id,token,extensionID){const client=this.data.clients[id];if(!client||client.extensionID!==extensionID||!/^\w{64}$/.test(token||''))return false;const hash=crypto.createHash('sha256').update(token).digest();return crypto.timingSafeEqual(hash,Buffer.from(client.hash,'hex'));}
  revoke(){this.data.clients={};this.pairing=null;this.save();}
  snapshot(next){const clean=validateSnapshot(next,this.data.leagues);this.data.snapshots[clean.leagueID]=mergeSnapshot(this.data.snapshots[clean.leagueID],clean);this.save();}
  refresh(scope='full'){this.command={requestID:crypto.randomUUID(),scope,leagueID:scope==='recommendations'?this.data.selectedLeague:null,createdAt:Date.now()};this.syncStatus={state:'waiting',time:Date.now(),error:null};return this.command;}
  public(){return {leagues:this.data.leagues,snapshots:this.data.snapshots,clients:Object.keys(this.data.clients).length,syncStatus:this.syncStatus,port:18747,selectedLeague:this.data.selectedLeague};}
}
module.exports={State,validateLeagues,validateSnapshot,mergeSnapshot};
