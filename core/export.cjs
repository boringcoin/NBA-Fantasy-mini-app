'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const ExcelJS=require('exceljs');
const {withCSP}=require('./html.cjs');
const {analyze,LABEL,value,compare,playerValues}=require('./analysis.cjs');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeName=s=>String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,70)||'联盟';
function datasets(snapshots,leagues=[]){return Object.values(snapshots).map(snapshot=>{const analysis=analyze(snapshot);return {snapshot:{...snapshot,leaguePower:snapshot.leaguePower?{...snapshot.leaguePower,matchupPairs:analysis.scheduleComplete?snapshot.leaguePower.matchupPairs:[]}:null},analysis,theme:leagues.find(l=>l.id===snapshot.leagueID)?.theme||'white'};}).filter(d=>d.analysis.rows.length);}
async function reportHTML(data){if(!data.length)throw Error('尚无完整全盟数据，请连接扩展并手动刷新');const template=await fs.readFile(path.join(__dirname,'../assets/report.html'),'utf8');const json=JSON.stringify({leagues:data}).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));return withCSP(template.replace('__REPORT_DATA__',()=>json));}
const fmt=(n,k)=>n==null?'—':['FG%','FT%'].includes(k)?(n*100).toFixed(2)+'%':Number.isInteger(n)?String(n):n.toFixed(k==='A/T'?3:1);
function tables(d){
  const s=d.snapshot,a=d.analysis,teams=new Map(s.leaguePower.teams.map(t=>[t.id,t])),names=id=>teams.get(id)?.name||'未获取',luck=new Map(a.luck.map(l=>[l.id,l]));
  const data=[];
  data.push({name:'战力排名',rows:[['球队','战力名次','战力积分','GP','全对战胜','负','平'],...a.rows.map(r=>[names(r.id),r.rank,r.points,value(teams.get(r.id),'GP'),r.wins,r.losses,r.ties])]});
  data.push({name:'各队数据',rows:[['球队','GP',...s.columns.map(k=>LABEL[k]),'FGM/A','FTM/A'],...a.rows.map(r=>{const t=teams.get(r.id);return [t.name,value(t,'GP'),...s.columns.map(k=>value(t,k)),t.stats['FGM/A']||null,t.stats['FTM/A']||null];})]});
  data.push({name:'单项名次',rows:[['球队',...s.columns.map(k=>LABEL[k])],...a.rows.map(r=>[names(r.id),...s.columns.map(k=>1+a.rows.filter(o=>o.ranks[k]<r.ranks[k]).length)])]});
  data.push({name:'全员对战',rows:[['行 vs 列',...a.rows.map(r=>names(r.id))],...a.rows.map(r=>[names(r.id),...a.rows.map(o=>{if(r.id===o.id)return '—';const m=compare(teams.get(r.id),teams.get(o.id),s.columns);return `${m.won.length}:${m.lost.length}:${m.tied.length}`;})])]});
  data.push({name:'实际对局',rows:[['球队','对手','赢项','输项','平项','赢项名称','输项名称'],...(s.leaguePower.matchupPairs||[]).map(([left,right])=>{const m=compare(teams.get(left),teams.get(right),s.columns);return [names(left),names(right),m.won.length,m.lost.length,m.tied.length,m.won.map(k=>LABEL[k]).join('、'),m.lost.map(k=>LABEL[k]).join('、')];})]});
  data.push({name:'走位与险胜',rows:[['球队','实际对手','实际分类得分','全对战中位数','走位差','险胜项','险负项','对手状态','对手战力偏差'],...a.rows.map(r=>{const l=luck.get(r.id);return [names(r.id),names(l.opponent),l.actual,l.median,l.difference,l.narrowWins.map(k=>LABEL[k]).join('、'),l.narrowLosses.map(k=>LABEL[k]).join('、'),l.opponentForm,l.opponentDifference];})]});
  for(const [key,title]of [['season','本赛季场均'],['recent','近14天场均']])data.push({name:title,rows:[['我的球员','GP',...s.columns.map(k=>LABEL[k])],...(s.research?.[key]||[]).filter(p=>s.players.some(o=>o.id===p.id)).map(p=>[p.name,value(p,'GP'),...s.columns.map(k=>value(p,k))])]});
  return data;
}
async function workbook(data,file){
  const wb=new ExcelJS.Workbook();wb.creator='Thunder Fantasy';wb.created=new Date();
  for(let index=0;index<data.length;index++)for(const table of tables(data[index])){
    const sheet=wb.addWorksheet(`${index+1}-${data[index].snapshot.league.slice(0,12)}-${table.name}`.replace(/[\[\]:*?/\\]/g,'_').slice(0,31));
    sheet.addRows(table.rows);sheet.views=[{state:'frozen',xSplit:1,ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,table.rows.length),column:table.rows[0].length}};
    sheet.columns=table.rows[0].map((h,i)=>({width:i===0?32:table.name==='全员对战'?25:16}));
    sheet.eachRow((row,n)=>{row.height=n===1?32:25;row.eachCell(cell=>{cell.font={name:'Arial',size:11,color:{argb:n===1?'FFFFFFFF':'FF182A40'},bold:n===1};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:n===1?'FF254668':n%2?'FFF3F6FA':'FFFFFFFF'}};cell.alignment={vertical:'middle',wrapText:n===1};if(typeof cell.value==='number')cell.numFmt='0.###';});});
    if(table.name==='各队数据')for(const k of ['FG%','FT%']){const i=data[index].snapshot.columns.indexOf(k);if(i>=0)sheet.getColumn(i+3).numFmt='0.00%';}
  }
  await wb.xlsx.writeFile(file);
}
function chartHTML(d,kind){
  const s=d.snapshot,a=d.analysis,teams=new Map(s.leaguePower.teams.map(t=>[t.id,t])),name=id=>teams.get(id)?.name||'—';
  const grid=(rows)=>`<table>${rows.map((r,i)=>`<tr>${r.map(v=>`<${i?'td':'th'}>${esc(v)}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</table>`;
  let content='',title='';
  if(kind==='战力排名'){title='全盟战力积分';content=a.rows.map(r=>`<div class="bar"><b>${r.rank}</b><span>${esc(name(r.id))}</span><div class="track"><i style="width:${r.points/(a.rows.length*s.columns.length)*100}%"></i></div><strong>${fmt(r.points)}</strong></div>`).join('');}
  if(kind==='各队数据'){title='各队累计数据 · 数值 / 联盟名次';content=grid([['球队','GP',...s.columns.map(k=>LABEL[k])],...a.rows.map(r=>[name(r.id),fmt(value(teams.get(r.id),'GP')),...s.columns.map(k=>fmt(value(teams.get(r.id),k),k)+' / #'+(1+a.rows.filter(o=>o.ranks[k]<r.ranks[k]).length))])]);}
  if(kind==='全员对战'){title='全员对战 · 行球队视角';content='<table><tr><th>球队</th>'+a.rows.map(r=>`<th>${esc(name(r.id))}</th>`).join('')+'</tr>'+a.rows.map(r=>'<tr><th>'+esc(name(r.id))+'</th>'+a.rows.map(o=>{if(o.id===r.id)return '<td>—</td>';const m=compare(teams.get(r.id),teams.get(o.id),s.columns),diff=m.won.length-m.lost.length;return `<td class="${diff>0?'win':diff<0?'loss':'tie'}">${m.won.length}:${m.lost.length}<small>${m.tied.length} 平</small></td>`;}).join('')+'</tr>').join('')+'</table>';}
  if(kind==='走位分析'){title='走位、对手状态与险胜';content=grid(tables(d).find(t=>t.name==='走位与险胜').rows.map((row,i)=>i?row.map((v,j)=>j>=2&&j<=4?fmt(v):v):row));}
  if(kind==='实际对局'){title='本周实际对局';content=grid(tables(d).find(t=>t.name==='实际对局').rows);}
  return withCSP(`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html{scrollbar-width:none}::-webkit-scrollbar{display:none}body{padding:40px;margin:0;color:#182a40;background:white;font:18px/1.5 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif}h1{font-size:34px;margin:0 0 8px}h2{font-size:25px;margin:24px 0}p{color:#50647a}.bar{display:grid;grid-template-columns:40px 360px 1fr 80px;align-items:center;gap:20px;padding:14px 0}.track{height:22px;background:#eaf0f6;border-radius:20px}.track i{display:block;height:100%;border-radius:20px;background:#307fbd}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:17px}th,td{padding:16px 10px;border:1px solid #dae3ed;text-align:center;overflow-wrap:anywhere}th{background:#edf2f7;font-weight:650}th:first-child,td:first-child{width:250px;text-align:left}.win{background:#dff1e7;color:#14263d}.loss{background:#f8e1e4;color:#14263d}.tie{background:#eef1f5;color:#14263d}small{display:block;color:#43566c;font-size:13px}.foot{margin-top:25px;font-size:15px}</style></head><body><h1>${esc(s.league)} · ${esc(s.week)}</h1><p>截至 ${esc(new Date(s.leaguePower.updatedAt).toLocaleString('zh-CN',{hour12:false}))} · ${a.rows.length} 队 · ${s.columns.length} 项 · 战力满分 ${a.rows.length*s.columns.length}</p><h2>${title}</h2>${content}<p class="foot">Yahoo 本周累计统计快照；走位采用全对战分类分中位数。比例按完整分子／分母计算。历史不足时不判断爆种／失常。</p></body></html>`);
}
async function exportBundle({snapshots,leagues,outDir,capture}){
  const data=datasets(snapshots,leagues);if(!data.length)throw Error('尚无完整全盟数据，无法导出');
  await fs.mkdir(outDir,{recursive:true});const files=[];
  const html=path.join(outDir,'全盟交互报告.html');await fs.writeFile(html,await reportHTML(data));files.push(html);
  const xlsx=path.join(outDir,'全盟数据.xlsx');await workbook(data,xlsx);files.push(xlsx);
  const raw=path.join(outDir,'数据快照.json');await fs.writeFile(raw,JSON.stringify({exportedAt:new Date().toISOString(),leagues:data},null,2));files.push(raw);
  if(capture)for(const d of data)for(const kind of ['战力排名','各队数据','全员对战','实际对局','走位分析']){const file=path.join(outDir,`${safeName(d.snapshot.league)}-${safeName(d.snapshot.week)}-${kind}.png`);await capture(chartHTML(d,kind),file,kind==='全员对战'?Math.max(1800,280+d.analysis.rows.length*180):kind==='各队数据'?2400:1800);files.push(file);}
  const note=path.join(outDir,'说明.txt');await fs.writeFile(note,'HTML 可离线打开、排序、切换背景和联盟。Excel 包含排名、GP、数据、各项名次、全员对战、实际对局、走位与球员场均。图片为导出时快照。\n报告含联盟成员数据；分享前请确认分享范围。没有导出浏览器凭证、Cookie 或配对令牌。\n');
  files.push(note);return files;
}
module.exports={datasets,reportHTML,tables,chartHTML,workbook,exportBundle,safeName,withCSP};
