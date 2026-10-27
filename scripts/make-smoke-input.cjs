'use strict';
const fs=require('node:fs'),{fixture}=require('../test/fixture.cjs');
fs.mkdirSync('.smoke',{recursive:true});
fs.writeFileSync('.smoke/input.json',JSON.stringify({leagues:[{id:'90001',team:'1',name:'演示联盟',theme:'white'}],snapshots:[fixture()]}));
