(function(root){
  'use strict';
  const ORIGIN='https://basketball.fantasysports.yahoo.com';
  const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
  function fromURL(value){
    let url;try{url=new URL(value);}catch{return null;}
    if(url.origin!==ORIGIN||url.username||url.password)return null;
    const ids=url.pathname.match(/^\/nba\/([1-9]\d{0,9})\/([1-9]\d?)\/?$/);
    if(!ids||Number(ids[1])<1||Number(ids[2])<1||Number(ids[2])>48)return null;
    return {id:ids[1],team:ids[2],source:`${ORIGIN}/nba/${ids[1]}/${ids[2]}`};
  }
  function fromDocument(doc,value){
    const result=fromURL(value);if(!result)return null;
    const links=Array.from(doc.querySelectorAll('a[href]'));
    const league=links.find(a=>{try{const name=clean(a.textContent);return new URL(a.getAttribute('href'),ORIGIN).href.replace(/\/$/,'')===`${ORIGIN}/nba/${result.id}`&&name&&!/^(overview|league|league home|home|my team|总览|联盟|联盟首页|首页)$/i.test(name);}catch{return false;}});
    const title=clean(doc.querySelector('h1')?.textContent).slice(0,100);
    return {...result,name:clean(league?.textContent).replace(/\s*\(ID\s*#?\s*\d+\)\s*$/i,'').slice(0,80)||`联盟 ${result.id}`,teamName:title};
  }
  const api={fromURL,fromDocument};root.ThunderTeamContext=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
