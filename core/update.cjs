'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createWriteStream}=require('node:fs'),{Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const yauzl=require('yauzl');
const REPO='boringcoin/NBA-Fantasy-mini-app',API=`https://api.github.com/repos/${REPO}/releases?per_page=20`;
function version(v){const m=/^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(v));const values=m?.slice(1).map(Number);return values?.every(n=>Number.isSafeInteger(n)&&n<=65535)?values:null;}
function compare(a,b){const x=version(a),y=version(b);if(!x||!y)throw Error('更新版本号无效');for(let i=0;i<3;i++)if(x[i]!==y[i])return Math.sign(x[i]-y[i]);return 0;}
function target(platform,arch){if(platform==='darwin'&&arch==='arm64')return 'Mac-Apple';if(platform==='darwin'&&arch==='x64')return 'Mac-Intel';if(platform==='win32'&&arch==='x64')return 'Windows-x64';throw Error('当前系统或架构暂不支持自动更新');}
function selectRelease(releases,current,platform,arch){
  if(!Array.isArray(releases))throw Error('GitHub 更新列表格式无效');
  const label=target(platform,arch);
  for(const r of releases.filter(r=>!r.draft&&version(r.tag_name)&&compare(r.tag_name,current)>0).sort((a,b)=>compare(b.tag_name,a.tag_name))){
    const v=r.tag_name.replace(/^v/,''),name=`ThunderFantasy-${v}-${label}.zip`,asset=r.assets?.find(a=>a.name===name);
    if(!asset)continue;
    const url=`https://github.com/${REPO}/releases/download/v${v}/${name}`;
    if(asset.browser_download_url!==url||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||'')||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>600*1024*1024)throw Error('更新包地址、大小或 SHA-256 校验信息无效');
    return {version:v,name,url,sha256:asset.digest.slice(7),size:asset.size,notes:String(r.body||'').replace(/<!--[\s\S]*?-->/g,'').slice(0,1600),label};
  }
  return null;
}
function trustedResponse(response){if(!response.ok)throw Error(`更新服务器返回 HTTP ${response.status}`);if(response.url){const u=new URL(response.url);if(u.protocol!=='https:'||!['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com'].includes(u.hostname))throw Error('更新服务器重定向地址不受信任');}}
async function hashFile(file){const hash=crypto.createHash('sha256');const {createReadStream}=require('node:fs');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function pruneCache(directory,current){
  try{await fs.access(path.join(directory,'pending.json'));return;}catch{}
  for(const name of await fs.readdir(directory)){
    const file=path.join(directory,name),match=/^ThunderFantasy-(\d+\.\d+\.\d+)-(?:Mac-Apple|Mac-Intel|Windows-x64)\.zip$/.exec(name);
    if(match&&version(match[1])&&compare(match[1],current)<=0){await fs.unlink(file).catch(()=>{});continue;}
    if(!/^stage-[a-z0-9]+$/i.test(name))continue;
    try{if((await fs.lstat(file)).isSymbolicLink())continue;if((await fs.readFile(path.join(file,'result'),'utf8')).trim()!=='installed')continue;await fs.copyFile(path.join(file,'install.log'),path.join(directory,'last-install.log')).catch(()=>{});await fs.rm(file,{recursive:true,force:true});}catch{}
  }
}
async function extractBundle(file,directory,release){
  const root=release.name.slice(0,-4),suffix=release.label==='Windows-x64'?'win-x64.exe':release.label==='Mac-Apple'?'mac-arm64.dmg':'mac-x64.dmg';
  const installerName=`ThunderFantasy-${release.version}-${suffix}`,expected=`${root}/${installerName}`,seen=new Set();
  await fs.mkdir(directory,{recursive:true,mode:0o700});let total=0,count=0;
  return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,strictFileNames:true,validateEntrySizes:true},(error,zip)=>{
    if(error)return reject(error);
    const fail=e=>{zip.close();reject(e);};zip.on('error',fail);
    zip.on('entry',entry=>{(async()=>{
      const name=entry.fileName,mode=(entry.externalFileAttributes>>>16)&0o170000;
      total+=entry.uncompressedSize;
      if(++count>100||total>750*1024*1024||yauzl.validateFileName(name)||!name.startsWith(root+'/')||mode===0o120000||seen.has(name))throw Error('更新压缩包路径、大小或文件类型异常');
      seen.add(name);
      const relative=name.slice(root.length+1);
      if(name!==expected&&!/^YahooSync\/[a-z0-9-]+\.(?:js|json|html|png|svg)$/i.test(relative)){zip.readEntry();return;}
      const dest=path.join(directory,relative);await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
      const stream=await new Promise((yes,no)=>zip.openReadStream(entry,(e,s)=>e?no(e):yes(s)));
      await pipeline(stream,createWriteStream(dest,{flags:'wx',mode:0o600}));zip.readEntry();
    })().catch(fail);});
    zip.on('end',()=>{if(!seen.has(expected))return reject(Error('更新包缺少当前平台的安装程序'));resolve(path.join(directory,installerName));});zip.readEntry();
  }));
}
class Updater {
  constructor({directory,currentVersion,platform=process.platform,arch=process.arch,fetch,onChange=()=>{},enabled=true}){
    Object.assign(this,{directory,currentVersion,platform,arch,fetch,onChange,enabled});this.info=null;this.busy=false;this.state={phase:'idle',currentVersion,auto:true,version:null,progress:0,error:'',notes:'',checkedAt:null};
  }
  emit(next){Object.assign(this.state,next);this.onChange({...this.state});}
  async load(){await fs.mkdir(this.directory,{recursive:true,mode:0o700});try{const p=JSON.parse(await fs.readFile(path.join(this.directory,'preferences.json'),'utf8'));this.state.auto=p.auto!==false;}catch{}await pruneCache(this.directory,this.currentVersion);return this.state;}
  async setAuto(auto){if(typeof auto!=='boolean')throw Error('更新设置无效');this.emit({auto});await fs.writeFile(path.join(this.directory,'preferences.json'),JSON.stringify({auto}),{mode:0o600});}
  async check(automatic=false){
    if(this.busy||this.state.phase==='ready'||(automatic&&!this.state.auto))return this.state;
    if(!this.enabled){this.emit({phase:'disabled',error:'开发环境不安装更新；已安装版本可检查和安装更新。'});return this.state;}
    this.busy=true;this.emit({phase:'checking',error:''});
    try{
      const response=await this.fetch(API,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Accept:'application/vnd.github+json'}});trustedResponse(response);
      const text=await response.text();if(text.length>2*1024*1024)throw Error('更新信息过大');
      this.info=selectRelease(JSON.parse(text),this.currentVersion,this.platform,this.arch);
      this.emit({phase:this.info?'available':'current',version:this.info?.version||null,notes:this.info?.notes||'',checkedAt:new Date().toISOString()});
    }catch(e){this.emit({phase:'error',error:String(e.message||e)});}
    finally{this.busy=false;}
    if(automatic&&this.info&&this.state.phase==='available'&&this.state.auto)await this.download();return this.state;
  }
  async download(){
    if(this.busy)return this.state;if(!this.info)throw Error('请先检查新版本');
    this.busy=true;const info=this.info,file=path.join(this.directory,info.name),temporary=file+'.part';this.emit({phase:'downloading',error:'',progress:0});
    try{
      let cached=false;try{cached=await hashFile(file)===info.sha256;}catch{}
      if(!cached){
        const response=await this.fetch(info.url,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30*60*1000)});trustedResponse(response);
        const hash=crypto.createHash('sha256');let size=0,last=0;const updater=this;
        await pipeline(response.body,new Transform({transform(chunk,_encoding,done){size+=chunk.length;if(size>info.size)return done(Error('更新包超过声明大小'));hash.update(chunk);if(Date.now()-last>300){last=Date.now();updater.emit({progress:Math.floor(size/info.size*100)});}done(null,chunk);}}),createWriteStream(temporary,{mode:0o600}));
        if(size!==info.size||hash.digest('hex')!==info.sha256)throw Error('更新包校验失败，已停止安装，请重试');
        await fs.rename(temporary,file);
      }
      this.file=file;this.emit({phase:'ready',progress:100});
    }catch(e){await fs.unlink(temporary).catch(()=>{});this.emit({phase:'error',error:String(e.message||e)});}
    finally{this.busy=false;}return this.state;
  }
  async prepare(){
    if(!['ready','preparing'].includes(this.state.phase)||!this.file||!this.info)throw Error('更新尚未下载完成');
    if(await hashFile(this.file)!==this.info.sha256)throw Error('更新包在下载后发生变化，请重新下载');
    const stage=await fs.mkdtemp(path.join(this.directory,'stage-'));
    try{const installer=await extractBundle(this.file,stage,this.info);return {stage,installer,version:this.info.version,installerHash:await hashFile(installer)};}catch(e){await fs.rm(stage,{recursive:true,force:true});throw e;}
  }
}
module.exports={Updater,version,compare,target,selectRelease,hashFile,extractBundle,pruneCache};
