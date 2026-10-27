'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function managedExtension(source,userData){
  const directory=path.join(userData,'YahooSync'),marker=path.join(directory,'managed.json');await fs.mkdir(directory,{recursive:true,mode:0o700});
  let id;try{id=JSON.parse(await fs.readFile(marker,'utf8')).instance;}catch{}if(!/^[a-f0-9-]{36}$/.test(id||''))id=crypto.randomUUID();
  const manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
  const names=(await fs.readdir(source)).filter(n=>/^[a-z0-9-]+\.(?:js|json|html|png|svg)$/i.test(n)&&n!=='manifest.json'&&n!=='managed.json');
  for(const name of [...names,'manifest.json']){const file=path.join(directory,name),temp=file+'.tmp';await fs.writeFile(temp,await fs.readFile(path.join(source,name)),{mode:0o600});await fs.rename(temp,file);}
  await fs.writeFile(marker,JSON.stringify({instance:id,version:manifest.version}),{mode:0o600});return {directory,instance:id,version:manifest.version};
}
module.exports={managedExtension};
