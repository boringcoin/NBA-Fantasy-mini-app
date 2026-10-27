'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile),{hashFile}=require('./update.cjs');
// Helpers run after the old app exits. Arguments are passed separately, never
// interpolated into shell/PowerShell source. No sudo or security-policy changes.
const MAC=`#!/bin/sh
set -eu
pid="$1"; target="$2"; staged="$3"; backup="$4"; ready="$5"; result="$6"; start="$7"
next="$target.installing-$$.app"
case "$pid" in ''|*[!0-9]*) exit 2;; esac
touch "$ready"
i=0; while kill -0 "$pid" 2>/dev/null; do i=$((i+1)); [ "$i" -lt 90 ] || exit 3; sleep 1; done
restore() { [ ! -e "$next" ] || /bin/rm -rf "$next"; if [ -d "$backup" ]; then [ ! -e "$target" ] || /bin/rm -rf "$target"; /bin/mv "$backup" "$target"; fi; printf 'failed' > "$result"; }
trap 'restore' HUP INT TERM
if ! /usr/bin/ditto "$staged" "$next"; then restore; exit 4; fi
if ! /usr/bin/codesign --verify --deep --strict "$next"; then restore; exit 5; fi
if ! /bin/mv "$target" "$backup"; then restore; exit 6; fi
if ! /bin/mv "$next" "$target"; then restore; exit 7; fi
if [ "$start" = 1 ]; then
  if ! /usr/bin/open -n "$target"; then restore; /usr/bin/open -n "$target" || true; exit 8; fi
fi
printf 'installed' > "$result"
`;
const WINDOWS=`param([int]$ParentProcess,[string]$Target,[string]$Installer,[string]$Backup,[string]$Ready,[string]$Result,[string]$ExpectedHash,[string]$Start)
$ErrorActionPreference='Stop'
$copied=$false
try {
  Set-Content -LiteralPath $Ready -Value 'ready'
  $p=Get-Process -Id $ParentProcess -ErrorAction SilentlyContinue
  if($p){$p | Wait-Process -Timeout 90 -ErrorAction Stop}
  if((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHash){throw 'Installer checksum changed'}
  Copy-Item -LiteralPath $Target -Destination $Backup -Recurse -Force
  $copied=$true
  $arguments=@('--updated','/S')
  if($Start -eq '1'){$arguments+='--force-run'}
  $process=Start-Process -FilePath $Installer -ArgumentList $arguments -PassThru -Wait
  if($process.ExitCode -ne 0){throw "Installer exit code $($process.ExitCode)"}
  Set-Content -LiteralPath $Result -Value 'installed'
} catch {
  if($copied){
    if(Test-Path -LiteralPath $Target){Remove-Item -LiteralPath $Target -Recurse -Force}
    Move-Item -LiteralPath $Backup -Destination $Target
  }
  Set-Content -LiteralPath $Result -Value ('failed: '+$_.Exception.Message)
  exit 1
}
`;
async function writableTarget(target){
  const stat=await fs.lstat(target);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('当前安装位置不能自动替换，请使用正常安装的应用');
  await fs.access(path.dirname(target),require('node:fs').constants.W_OK);await fs.access(target,require('node:fs').constants.W_OK);
}
async function prepareMac(installer,stage,version){
  const mount=path.join(stage,'mount'),candidate=path.join(mount,'Thunder Fantasy.app'),staged=path.join(stage,'Thunder Fantasy.app');
  await fs.mkdir(mount);let attached=false;
  try{
    await execute('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,installer],{timeout:90000});attached=true;
    const plist=path.join(candidate,'Contents/Info.plist');
    const id=(await execute('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',plist])).stdout.trim();
    const v=(await execute('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',plist])).stdout.trim();
    if(id!=='app.thunderfantasy.desktop'||v!==version)throw Error('Mac 更新包的应用身份或版本不匹配');
    await execute('/usr/bin/codesign',['--verify','--deep','--strict',candidate],{timeout:90000});
    await execute('/usr/bin/ditto',[candidate,staged],{timeout:180000});return staged;
  }finally{if(attached)await execute('/usr/bin/hdiutil',['detach',mount],{timeout:30000}).catch(()=>execute('/usr/bin/hdiutil',['detach','-force',mount],{timeout:30000}).catch(()=>{}));}
}
async function startInstall({platform,target,prepared,directory,parentPID=process.pid,startAfter=true}){
  if(!['darwin','win32'].includes(platform)||!path.isAbsolute(target)||path.resolve(target)===path.parse(target).root)throw Error('更新安装目录无效');
  if(platform==='darwin'&&!target.endsWith('.app'))throw Error('没有找到已安装的 Mac 应用包');
  if(platform==='win32'){await fs.access(path.join(target,'Thunder Fantasy.exe'));await fs.access(path.join(target,'resources/app.asar'));}
  await writableTarget(target);
  if(platform==='darwin'&&target.startsWith('/Volumes/'))throw Error('请先将应用拖到应用程序目录，再使用自动更新');
  if(await hashFile(prepared.installer)!==prepared.installerHash)throw Error('安装程序校验失败');
  const staged=platform==='darwin'?await prepareMac(prepared.installer,prepared.stage,prepared.version):prepared.installer;
  const ready=path.join(prepared.stage,'ready'),result=path.join(prepared.stage,'result'),log=path.join(prepared.stage,'install.log');
  const backup=platform==='darwin'?path.join(path.dirname(target),'.ThunderFantasy-previous-'+path.basename(prepared.stage)+'.app'):path.join(prepared.stage,'previous-app');
  const record={version:prepared.version,target,backup,stage:prepared.stage,result};
  const helper=path.join(prepared.stage,platform==='darwin'?'install.sh':'install.ps1');await fs.writeFile(helper,platform==='darwin'?MAC:WINDOWS,{mode:0o700});
  // Pass each path as a separate argument to a local script. No shell command
  // interpolation or change to the system execution policy is needed.
  const args=platform==='darwin'?[helper,String(parentPID),target,staged,backup,ready,result,startAfter?'1':'0']:['-NoProfile','-NonInteractive','-File',helper,'-ParentProcess',String(parentPID),'-Target',target,'-Installer',staged,'-Backup',backup,'-Ready',ready,'-Result',result,'-ExpectedHash',prepared.installerHash,'-Start',startAfter?'1':'0'];
  const handle=await fs.open(log,'a',0o600);
  const child=spawn(platform==='darwin'?'/bin/sh':path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),args,{detached:true,windowsHide:true,stdio:['ignore',handle.fd,handle.fd]});
  try{
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
    const deadline=Date.now()+15000;let found=false,exitInfo=null;child.once('exit',(code,signal)=>{exitInfo={code,signal};});
    while(Date.now()<deadline){try{await fs.access(ready);found=true;break;}catch{if(exitInfo)break;await new Promise(r=>setTimeout(r,100));}}
    if(!found){const details=await fs.readFile(log,'utf8').catch(()=>'');throw Error('更新安装器未能启动；原应用保持不变。'+JSON.stringify(exitInfo)+' '+details.slice(-4000));}
    await fs.writeFile(path.join(directory,'pending.json'),JSON.stringify(record),{mode:0o600});return record;
  }finally{await handle.close();}
}
async function finishInstall(directory,currentVersion,target){
  let record;try{record=JSON.parse(await fs.readFile(path.join(directory,'pending.json'),'utf8'));}catch{return;}
  if(record.version!==currentVersion||record.target!==target)return;
  const validStage=path.dirname(record.stage)===directory&&path.basename(record.stage).startsWith('stage-');
  const allowedBackup=record.backup===path.join(record.stage,'previous-app')||record.backup===path.join(path.dirname(target),'.ThunderFantasy-previous-'+path.basename(record.stage)+'.app');
  if(!validStage||!allowedBackup)return;
  // Only a successful new launch removes our own backup; userData is untouched.
  await fs.rm(record.backup,{recursive:true,force:true}).catch(()=>{});
  await fs.unlink(path.join(directory,'pending.json')).catch(()=>{});
}
module.exports={MAC,WINDOWS,prepareMac,startInstall,finishInstall,writableTarget};
