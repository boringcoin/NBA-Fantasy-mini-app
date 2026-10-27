'use strict';
// Disposable CI runners only: a real installer and synthetic process/profile.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{createReadStream,createWriteStream}=require('node:fs'),{Readable}=require('node:stream');
const {Updater,hashFile}=require('../core/update.cjs'),{startInstall,finishInstall,prepareMac}=require('../core/update-install.cjs');
const version=require('../package.json').version,platform=process.platform,arch=process.arch;
async function run(file,args){return new Promise((resolve,reject)=>{const child=spawn(file,args,{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.once('error',reject);child.once('exit',code=>code===0?resolve(output):reject(Error(file+' exited '+code+'\n'+output)));});}
async function waitFor(file,expected){const end=Date.now()+180000;while(Date.now()<end){try{const text=(await fs.readFile(file,'utf8')).trim();if(text===expected)return;if(text.startsWith('failed'))throw Error(text);}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,300));}throw Error('Update helper timed out: '+file);}
async function main(){
  assert.ok(['darwin','win32'].includes(platform));
  const label=platform==='win32'?'Windows-x64':arch==='arm64'?'Mac-Apple':'Mac-Intel',suffix=platform==='win32'?'win-x64.exe':`mac-${arch}.dmg`;
  const root=path.resolve('.smoke/update'),cache=path.join(root,'cache'),zipName=`ThunderFantasy-${version}-${label}.zip`,installerName=`ThunderFantasy-${version}-${suffix}`;
  await fs.mkdir(root,{recursive:true});
  const zipPath=path.join(root,zipName),zip=require('archiver')('zip',{store:true}),output=createWriteStream(zipPath),finished=new Promise((yes,no)=>{output.on('close',yes);output.on('error',no);zip.on('error',no);});
  zip.pipe(output);zip.file(path.resolve('release',installerName),{name:zipName.slice(0,-4)+'/'+installerName});zip.file(path.resolve('extension/manifest.json'),{name:zipName.slice(0,-4)+'/YahooSync/manifest.json'});await zip.finalize();await finished;
  const digest=await hashFile(zipPath),size=(await fs.stat(zipPath)).size,url=`https://github.com/boringcoin/NBA-Fantasy-mini-app/releases/download/v${version}/${zipName}`;
  const updater=new Updater({directory:cache,currentVersion:'0.0.0',platform,arch,fetch:async u=>u.includes('/releases?')?new Response(JSON.stringify([{tag_name:'v'+version,assets:[{name:zipName,browser_download_url:url,size,digest:'sha256:'+digest}]}])):new Response(Readable.toWeb(createReadStream(zipPath)))});
  await updater.load();await updater.check(true);assert.equal(updater.state.phase,'ready');
  const prepared=await updater.prepare(),target=path.join(root,platform==='darwin'?'Thunder Fantasy.app':'installed'),exe=platform==='darwin'?path.join(target,'Contents/MacOS/Thunder Fantasy'):path.join(target,'Thunder Fantasy.exe');
  if(platform==='darwin'){
    const candidate=await prepareMac(prepared.installer,await fs.mkdtemp(path.join(cache,'baseline-')),version);await run('/usr/bin/ditto',[candidate,target]);
  }else await run(prepared.installer,['/S',`/D=${target}`]);
  await fs.access(exe);
  const sentinel=path.join(root,'profile','preserve.txt');await fs.mkdir(path.dirname(sentinel));await fs.writeFile(sentinel,'keep league and pairing');
  await assert.rejects(startInstall({platform,target,prepared:{...prepared,installerHash:'0'.repeat(64)},directory:cache}),/校验/);
  await fs.access(exe);
  const old=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  let record;
  try{record=await startInstall({platform,target,prepared,directory:cache,parentPID:old.pid,startAfter:false});}finally{old.kill();}
  await waitFor(record.result,'installed');assert.equal(await fs.readFile(sentinel,'utf8'),'keep league and pairing');
  const result=await run(exe,['--smoke-test','--data-dir',path.join(root,'profile'),'--input',path.resolve('.smoke/input.json'),'--smoke-output',path.join(root,'new-app-output')]);
  assert.match(result,/SMOKE_OK/);await finishInstall(cache,version,target);await assert.rejects(fs.access(record.backup));
  await fs.writeFile(path.join(root,'passed.txt'),`UPDATE_INSTALL_OK ${platform} ${arch} ${version}\n`);console.log(`UPDATE_INSTALL_OK ${platform} ${arch} ${version}`);
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
