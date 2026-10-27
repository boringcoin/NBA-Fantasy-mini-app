'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {fixture}=require('./fixture.cjs'),{State,mergeSnapshot}=require('../core/state.cjs'),{availableWeeks,powerSnapshot}=require('../core/weeks.cjs'),{analyze}=require('../core/analysis.cjs');
function weekly(week,id='90001'){
  const s=fixture(4,id);s.week=s.leaguePower.week='Week '+week;s.seasonYear=2026;
  s.leaguePower.teams.forEach((t,i)=>{t.stats.PTS=String(week*100+i*7);t.stats.GP=String(week*10+i);});
  s.leaguePower.updatedAt=`2026-10-${String(20+week).padStart(2,'0')}T00:00:00Z`;return s;
}
test('older extensions priorWeeks become selectable with real totals and no current player averages',()=>{
  const s=weekly(2),prior=weekly(1).leaguePower;s.leaguePower.priorWeeks=[prior];
  assert.deepEqual(availableWeeks(s).map(w=>w.week),['Week 2','Week 1']);
  const historical=powerSnapshot(s,'Week 1');assert.equal(historical.leaguePower.teams[0].stats.PTS,'100');
  assert.equal(historical.players.length,0);assert.equal(historical.research,undefined);assert.equal(historical.teams[0].stats.GP,'10');
  assert.equal(analyze(historical).rows.length,4);assert.match(historical.source,/week=1/);
});
test('week rollover and partial updates preserve complete historical data across restart',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fantasy-history-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const state=new State(dir);state.configure([{id:'90001',team:'1',name:'Demo'}]);state.snapshot(weekly(1));state.snapshot(weekly(2));
  const partial=weekly(3);partial.syncScope='today';delete partial.leaguePower;delete partial.research;state.snapshot(partial);
  const saved=new State(dir).data.snapshots['90001'];assert.deepEqual(availableWeeks(saved).map(w=>w.week),['Week 3','Week 2','Week 1']);
  assert.equal(powerSnapshot(saved,'Week 1').leaguePower.teams[0].stats.PTS,'100');
  assert.throws(()=>powerSnapshot(saved,'Week 3'),/尚未同步/);
});
test('incomplete history does not replace a valid week or create zero rankings; corrections replace totals',()=>{
  const old=mergeSnapshot(null,weekly(1)),broken=weekly(1);delete broken.leaguePower.teams[0].stats.PTS;
  const retained=mergeSnapshot(old,broken);assert.equal(powerSnapshot(retained,'Week 1').leaguePower.teams[0].stats.PTS,'100');
  const corrected=weekly(1);corrected.leaguePower.teams[0].stats.PTS='999';
  assert.equal(powerSnapshot(mergeSnapshot(retained,corrected),'Week 1').leaguePower.teams[0].stats.PTS,'999');
  assert.deepEqual(availableWeeks(broken).map(w=>[w.week,w.available]),[['Week 1',false]]);
});
test('histories stay in their league and season, and use only weeks before the selected week',()=>{
  let s=mergeSnapshot(weekly(1),weekly(2));s=mergeSnapshot(s,weekly(3));
  const w2=powerSnapshot(s,'Week 2');assert.deepEqual(w2.leaguePower.priorWeeks.map(w=>w.week),['Week 1']);
  const fresh=weekly(1);fresh.seasonYear=2027;fresh.syncScope='today';delete fresh.leaguePower;delete fresh.research;
  assert.deepEqual(availableWeeks(mergeSnapshot(s,fresh)).map(w=>[w.week,w.available]),[['Week 1',false]]);
  const other=weekly(4,'90002');assert.deepEqual(availableWeeks(mergeSnapshot(null,other)).filter(w=>w.available).map(w=>w.week),['Week 4']);
});
test('historical exports and offline report contain correct weeks and support week selection',async t=>{
  const {datasets,reportHTML,workbook,chartHTML}=require('../core/export.cjs');
  const s=mergeSnapshot(weekly(1),weekly(2)),snapshots={[s.leagueID]:s};
  const all=datasets(snapshots,[],{allWeeks:true});assert.deepEqual(all.map(d=>d.snapshot.week),['Week 2','Week 1']);
  const selection={leagueID:s.leagueID,week:'Week 1'},data=datasets(snapshots,[],{selection});assert.equal(data.length,1);
  assert.match(chartHTML(data[0],'各队数据'),/Week 1/);assert.ok(!chartHTML(data[0],'各队数据').includes('Week 2'));
  const html=await reportHTML(all,selection);assert.match(html,/id="weeks"/);assert.match(html,/state\.week/);
  const encoded=JSON.parse(html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(encoded.selection.week,'Week 1');assert.equal(encoded.leagues.length,2);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fantasy-history-export-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'last-week.xlsx');await workbook(data,file);
  const ExcelJS=require('exceljs'),wb=new ExcelJS.Workbook();await wb.xlsx.readFile(file);
  const row=wb.worksheets[1].getRows(2,4).find(r=>r.getCell(1).value===s.leaguePower.teams[0].name);
  assert.equal(row.getCell(6).value,100);assert.equal(wb.worksheets[6].rowCount,1);
});
