'use strict';
const $=id=>document.getElementById(id);let config,currentTeam=null;
async function send(data){const r=await chrome.runtime.sendMessage(data);if(!r?.ok)throw Error(r?.error||'无法连接');return r;}
async function previewTeam(){
  currentTeam=null;$('import-team').disabled=true;
  try{
    const r=await send({type:'current-team'});currentTeam=r.context;
    $('current-team').textContent=`${currentTeam.name}${currentTeam.teamName?' · '+currentTeam.teamName:''}\n联盟 ID ${currentTeam.id} · 球队 ID ${currentTeam.team}${currentTeam.needsReload?'\n安装扩展后请刷新一次 Yahoo 网页，以开始同步。':''}`;
    const existing=config?.leagues?.find(l=>l.id===currentTeam.id);
    if(existing&&existing.team!==currentTeam.team){$('current-team').textContent+='\n该联盟已配置另一支球队。需要切换时，请到桌面应用设置修改球队 ID。';return;}
    $('import-team').textContent=existing?'已添加 · 同步这支球队':'导入当前球队';$('import-team').disabled=false;
  }catch(e){$('current-team').textContent=e.message;}
}
async function status(preview=true){
  const r=await send({type:'popup-status'});config=r.config;
  const connected=r.paired&&!r.appError;$('pair').hidden=connected;$('connected').hidden=!connected;
  $('status').textContent=`扩展版本 ${chrome.runtime.getManifest().version}\n`+(r.appError||(r.status?`${r.status.ok?'最近一次同步完成（各盟状态见下方）':'同步提示'} · ${new Date(r.status.time).toLocaleString()}\n${r.status.error||''}`:'已配对，等待首次同步'));
  $('leagues').style.whiteSpace='pre-wrap';
  $('leagues').textContent=(config?.leagues||[]).map(l=>{const s=r.leagueStatus?.[l.id],full=s?.lastFull;const latest=!s?'尚未同步':s.state==='started'?'正在同步…':s.state==='completed'?(s.scope==='today'?'球员同步完成':'完整同步完成')+' · '+new Date(s.time).toLocaleTimeString():'同步未完成：'+s.error;return `${l.name}（${l.id}） · ${latest}${full?.state==='error'&&s?.scope==='today'?'\n上次完整同步未完成：'+full.error:''}`;}).join('\n\n')||'尚未添加球队。打开自己的 My Team，然后点击下方导入。';
  $('refresh').disabled=!config?.leagues?.length;$('open').disabled=!config?.leagues?.length;
  if(connected&&preview)await previewTeam();
}
async function run(fn){try{await fn();}catch(e){$('status').textContent=e.message;}}
$('connect').onclick=()=>run(async()=>{await send({type:'pair',code:$('code').value.trim()});$('code').value='';await status();$('status').textContent=config?.leagues?.length?'已配对并请求同步。请保持 Yahoo 联盟网页打开。':'已配对。请打开自己的 My Team，再点击“导入当前球队”。';});
$('import-team').onclick=()=>run(async()=>{
  if(!currentTeam)return;$('import-team').disabled=true;
  try{
    const r=await send({type:'import-team',source:currentTeam.source});config=r.config;
    await status();$('status').textContent=`已添加 ${r.league.name}（球队 ${r.league.team}），已请求首次完整同步。${r.needsReload?'请刷新 Yahoo 网页后保持打开。':'请保持 Yahoo 网页打开。'}`;
  }finally{await previewTeam();}
});
$('refresh').onclick=()=>run(async()=>{await send({type:'request-refresh'});$('status').textContent='已请求完整同步，请保持 Yahoo 标签页打开。';});
$('disconnect').onclick=()=>run(async()=>{await send({type:'unpair'});await status();});
$('open').onclick=()=>run(async()=>{const l=config?.leagues?.[0];if(!l)throw Error('请先导入球队或在桌面应用配置联盟');if(!/^\d+$/.test(l.id)||!/^\d+$/.test(l.team))throw Error('ID 无效');await chrome.tabs.create({url:`https://basketball.fantasysports.yahoo.com/nba/${l.id}/${l.team}`});});
run(status);

setInterval(()=>run(()=>status(false)),2000);
