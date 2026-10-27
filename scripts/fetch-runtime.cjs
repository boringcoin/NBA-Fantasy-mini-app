'use strict';
// Optional developer helper: bounded byte ranges survive interrupted large downloads.
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile),version=require('../node_modules/electron/package.json').version,checks=require('../node_modules/electron/checksums.json');
const cache=path.resolve('.runtime-cache');
async function digest(file){const hash=crypto.createHash('sha256');for await(const chunk of sync.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function prepare(target){
  const name=`electron-v${version}-${target}.zip`,file=path.join(cache,name),url=`https://github.com/electron/electron/releases/download/v${version}/${name}`;
  const {stdout}=await exec('curl',['--head','--location','--max-time','30','--silent','--show-error',url]);
  const total=Number([...stdout.matchAll(/^content-length:\s*(\d+)/gim)].at(-1)?.[1]);if(!(total>10000000&&total<500000000))throw Error('未知运行时大小');
  let size=0;try{size=(await fs.stat(file)).size;}catch{}if(size>total){await fs.rename(file,file+'.invalid');size=0;}
  if(size===total){if(await digest(file)!==checks[name])throw Error(name+' 校验失败');console.log(name+' 已校验');return {name,file,parts:[],complete:true};}
  const parts=[];for(let start=size;start<total;start+=8*1024*1024){const end=Math.min(total-1,start+8*1024*1024-1);parts.push({start,end,file:file+`.part-${start}-${end}`});}
  console.log(name+' 续传 '+Math.round(size/total*100)+'%');return {name,file,url,size,total,parts};
}
async function main(){await fs.mkdir(cache,{recursive:true});const jobs=await Promise.all(['darwin-arm64','darwin-x64','win32-x64'].map(prepare));const tasks=jobs.flatMap(job=>job.parts.map(part=>({job,part})));let index=0;
  await Promise.all(Array.from({length:12},async()=>{while(index<tasks.length){
    const {job,part}=tasks[index++],expected=part.end-part.start+1;
    let size=0;try{size=(await fs.stat(part.file)).size;}catch{}
    if(size>expected){await fs.unlink(part.file);size=0;}
    for(let attempt=0;size<expected&&attempt<4;attempt++){
      const remaining=part.file+'.remaining';
      await fs.rm(remaining,{force:true});
      let failure=null;
      try{await exec('curl',['--fail','--location','--range',`${part.start+size}-${part.end}`,'--connect-timeout','20','--max-time','300','--silent','--show-error',job.url,'--output',remaining],{maxBuffer:1024*1024});}catch(error){failure=error;}
      let chunk;try{chunk=await fs.readFile(remaining);}catch{chunk=Buffer.alloc(0);}
      if(chunk.length>expected-size)throw Error('下载服务返回了超出请求范围的数据');
      if(chunk.length){await fs.appendFile(part.file,chunk);size+=chunk.length;}
      await fs.rm(remaining,{force:true});
      if(failure&&!chunk.length&&attempt===3)throw failure;
    }
    if(size!==expected)throw Error('分块尚未完成，请重新运行以续传');
    console.log(job.name+' 分块完成 '+part.start);
  }}));
  for(const job of jobs){if(job.complete)continue;const temp=job.file+'.assembled';await fs.writeFile(temp,job.size?await fs.readFile(job.file):Buffer.alloc(0));for(const part of job.parts)await fs.appendFile(temp,await fs.readFile(part.file));if(await digest(temp)!==checks[job.name])throw Error(job.name+' SHA-256 校验失败');await fs.rename(temp,job.file);for(const part of job.parts)await fs.unlink(part.file);console.log(job.name+' SHA-256 正确');}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
