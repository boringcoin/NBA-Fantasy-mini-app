'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('update events replace frozen contextBridge state and display progress and restart controls',async()=>{
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,scrollTop:0,classList:{toggle:()=>{}}});return nodes.get(id);};let update;
  const state=Object.freeze({leagues:[],clients:0,snapshots:{},updater:Object.freeze({phase:'idle',currentVersion:'2.1.0',progress:0,auto:true})});
  const sandbox={window:{desktop:{getState:async()=>state,onChange:()=>{},onUpdate:callback=>{update=callback;}}},document:{getElementById:node,querySelectorAll:()=>[],addEventListener:()=>{}},setTimeout:()=>0,clearTimeout:()=>{},console};
  vm.runInNewContext(fs.readFileSync(require.resolve('../app/renderer.js'),'utf8'),sandbox);await new Promise(r=>setImmediate(r));
  update(Object.freeze({phase:'downloading',currentVersion:'2.1.0',version:'2.1.1',progress:45,auto:true}));
  assert.equal(node('update-progress').value,45);assert.equal(node('update-banner').hidden,false);assert.equal(node('update-banner-install').hidden,true);
  update(Object.freeze({phase:'ready',currentVersion:'2.1.0',version:'2.1.1',progress:100,auto:true}));assert.equal(node('update-banner-install').hidden,false);
});
