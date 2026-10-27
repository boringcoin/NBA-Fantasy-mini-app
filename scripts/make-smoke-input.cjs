'use strict';
const fs=require('node:fs'),{fixture}=require('../test/fixture.cjs');
fs.mkdirSync('.smoke',{recursive:true});
const current=fixture(),previous=fixture();
current.week=current.leaguePower.week='Week 2';
previous.leaguePower.teams.forEach(t=>{t.stats.PTS=String(Number(t.stats.PTS)+1000);});
current.leaguePower.priorWeeks=[previous.leaguePower];
fs.writeFileSync('.smoke/input.json',JSON.stringify({leagues:[{id:'90001',team:'1',name:'演示联盟',theme:'white'}],snapshots:[current]}));
