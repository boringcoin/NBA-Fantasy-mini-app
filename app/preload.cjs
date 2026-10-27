'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const call=(name,...args)=>ipcRenderer.invoke(name,...args);
contextBridge.exposeInMainWorld('desktop',{
  getState:()=>call('get-state'),configure:leagues=>call('configure',leagues),selectLeague:id=>call('select-league',id),
  newCode:()=>call('new-code'),revoke:()=>call('revoke'),refresh:scope=>call('refresh',scope),windowAction:action=>call('window-action',action),
  openYahoo:id=>call('open-yahoo',id),gameSummary:id=>call('game-summary',id),playerValues:(id,mode)=>call('player-values',id,mode),openReport:()=>call('open-report'),export:()=>call('export'),
  onChange:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('changed',listener);return ()=>ipcRenderer.removeListener('changed',listener);}
});
