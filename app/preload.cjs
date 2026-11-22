'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const call=(name,...args)=>ipcRenderer.invoke(name,...args);
contextBridge.exposeInMainWorld('desktop',{
  injuryRefresh:()=>call('injury-refresh'),injuryFollow:name=>call('injury-follow',name),fontScale:n=>call('font-scale',n),dailyRefresh:(date,followToday)=>call('daily-refresh',date,followToday),dailyRank:(id,punt)=>call('daily-rank',id,punt),
  updateAction:(action,value)=>call('update-action',action,value),
  onUpdate:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('update-state',listener);return ()=>ipcRenderer.removeListener('update-state',listener);},
  getState:()=>call('get-state'),configure:leagues=>call('configure',leagues),selectLeague:id=>call('select-league',id),
  newCode:()=>call('new-code'),revoke:()=>call('revoke'),refresh:scope=>call('refresh',scope),windowAction:action=>call('window-action',action),
  openYahoo:id=>call('open-yahoo',id),gameSummary:id=>call('game-summary',id),playerValues:(id,mode)=>call('player-values',id,mode),powerWeek:(id,week)=>call('power-week',id,week),openReport:selection=>call('open-report',selection),export:selection=>call('export',selection),exportPowerHTML:selection=>call('export-power-html',selection),exportPowerImages:selection=>call('export-power-images',selection),
  onChange:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('changed',listener);return ()=>ipcRenderer.removeListener('changed',listener);}
});
