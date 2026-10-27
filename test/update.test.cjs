'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Updater,compare,selectRelease,extractBundle,hashFile}=require('../core/update.cjs'),{managedExtension}=require('../core/extension-files.cjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),ORIGIN='https://github.com/boringcoin/NBA-Fantasy-mini-app/releases/download';
function release(version='2.0.7',label='Windows-x64',bytes=Buffer.from('installer bundle')){const name=`ThunderFantasy-${version}-${label}.zip`;return {tag_name:'v'+version,prerelease:true,draft:false,body:'Notes',assets:[{name,browser_download_url:`${ORIGIN}/v${version}/${name}`,size:bytes.length,digest:'sha256:'+sha(bytes)}]};}
async function temp(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'fantasy-update-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}
async function zipFile(directory,entries){const {createWriteStream}=require('node:fs'),archiver=require('archiver');const file=path.join(directory,'bundle-'+crypto.randomUUID()+'.zip'),out=createWriteStream(file),zip=archiver('zip');const done=new Promise((r,j)=>{out.on('close',r);zip.on('error',j);out.on('error',j);});zip.pipe(out);for(const entry of entries)entry.link?zip.symlink(entry.name,entry.link):zip.append(entry.bytes||'test',{name:entry.name});await zip.finalize();await done;return file;}
test('updates select the newest complete matching architecture including test releases; never downgrade',()=>{
  const all=[release('2.0.6'),release('2.0.7'),release('2.0.8','Mac-Apple'),{...release('2.0.9'),draft:true}];
  assert.equal(selectRelease(all,'2.0.6','win32','x64').version,'2.0.7');assert.equal(selectRelease(all,'2.0.6','darwin','arm64').version,'2.0.8');
  assert.equal(selectRelease(all,'2.0.7','win32','x64'),null);assert.ok(compare('2.0.10','2.0.9')>0);assert.throws(()=>selectRelease(all,'2.0.6','darwin','x64'),/暂不支持/);assert.throws(()=>compare('v1.2.3;bad','2.0.1'));
});
test('update metadata rejects external download URLs and missing checksum',()=>{
  const wrong=release();wrong.assets[0].browser_download_url='https://evil.example/setup.exe';assert.throws(()=>selectRelease([wrong],'2.0.6','win32','x64'),/校验/);
  const unsigned=release();delete unsigned.assets[0].digest;assert.throws(()=>selectRelease([unsigned],'2.0.6','win32','x64'),/校验/);
});
test('download verifies exact length and SHA-256; bad bytes never become installable',async t=>{
  const directory=await temp(t),bytes=Buffer.from('verified update'),r=release('2.0.7','Windows-x64',bytes);let corrupt=true;
  const updater=new Updater({directory,currentVersion:'2.0.6',platform:'win32',arch:'x64',fetch:async url=>url.includes('/releases?')?new Response(JSON.stringify([r])):new Response(corrupt?Buffer.from('corrupt'):bytes)});await updater.load();await updater.check();
  await updater.download();assert.equal(updater.state.phase,'error');assert.equal(await fs.stat(path.join(directory,r.assets[0].name)).catch(()=>null),null);
  corrupt=false;await updater.download();assert.equal(updater.state.phase,'ready');assert.equal(await hashFile(updater.file),sha(bytes));
  await fs.writeFile(updater.file,'changed');await assert.rejects(updater.prepare(),/发生变化/);
});
test('disabled automatic updates make no requests; preferences survive restart',async t=>{
  const directory=await temp(t);let requests=0;const options={directory,currentVersion:'2.0.6',fetch:async()=>{requests++;return new Response('[]');}};
  const updater=new Updater(options);await updater.load();await updater.setAuto(false);await updater.check(true);assert.equal(requests,0);
  const restarted=new Updater(options);await restarted.load();assert.equal(restarted.state.auto,false);await restarted.check(true);assert.equal(requests,0);
});
test('bundle extraction writes only installer and extension files; rejects symlinks and wrong platform payloads',async t=>{
  const directory=await temp(t),root='ThunderFantasy-2.0.7-Windows-x64',installer=`${root}/ThunderFantasy-2.0.7-win-x64.exe`;
  const file=await zipFile(directory,[{name:installer},{name:root+'/YahooSync/manifest.json',bytes:'{}'},{name:root+'/ignored.txt'}]);
  const info={name:root+'.zip',version:'2.0.7',label:'Windows-x64'},stage=path.join(directory,'valid');
  assert.equal(await extractBundle(file,stage,info),path.join(stage,'ThunderFantasy-2.0.7-win-x64.exe'));
  await assert.rejects(fs.access(path.join(stage,'ignored.txt')));
  const bad=await zipFile(directory,[{name:installer},{name:root+'/YahooSync/bad.js',link:'../../escape'}]);await assert.rejects(extractBundle(bad,path.join(directory,'bad'),info),/类型异常/);
  await assert.rejects(extractBundle(file,path.join(directory,'other'),{...info,label:'Mac-Apple'}),/安装程序/);
});
test('managed extension keeps its path and instance, updates files, and touches no user settings',async t=>{
  const directory=await temp(t),source=path.join(directory,'source'),user=path.join(directory,'user');await fs.mkdir(source);await fs.mkdir(user);
  await fs.writeFile(path.join(source,'manifest.json'),' {"version":"2.0.7"}');await fs.writeFile(path.join(source,'sync.js'),'first');await fs.writeFile(path.join(user,'settings.json'),'private');
  const a=await managedExtension(source,user);await fs.writeFile(path.join(source,'sync.js'),'second');const b=await managedExtension(source,user);
  assert.equal(a.instance,b.instance);assert.equal(a.directory,b.directory);assert.equal(await fs.readFile(path.join(b.directory,'sync.js'),'utf8'),'second');assert.equal(await fs.readFile(path.join(user,'settings.json'),'utf8'),'private');
});

test('installer helpers load without shell interpolation and preserve backups until a successful version launches',async t=>{
  const {MAC,WINDOWS,finishInstall}=require('../core/update-install.cjs');assert.match(MAC,/codesign --verify/);assert.ok(!WINDOWS.includes('ExecutionPolicy'));assert.match(WINDOWS,/Get-FileHash/);
  if(process.platform!=='win32'){const r=require('node:child_process').spawnSync('/bin/sh',['-n'],{input:MAC});assert.equal(r.status,0);}
  const directory=await temp(t),stage=path.join(directory,'stage-abc'),target=path.join(directory,'Installed.app'),backup=path.join(stage,'previous-app');await fs.mkdir(backup,{recursive:true});
  await fs.writeFile(path.join(directory,'pending.json'),JSON.stringify({version:'2.0.7',target,backup,stage}));
  await finishInstall(directory,'2.0.6',target);await fs.access(backup);await finishInstall(directory,'2.0.7',target);await assert.rejects(fs.access(backup));
});
