'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),RE=require('resedit');
module.exports=async function afterPack(context){
  if(context.electronPlatformName!=='win32')return;
  const file=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.exe');
  const bytes=await fs.readFile(file),exe=RE.NtExecutable.from(bytes,{ignoreCert:true}),resource=RE.NtExecutableResource.from(exe);
  const icon=RE.Data.IconFile.from(await fs.readFile(path.join(context.packager.projectDir,'assets/icon.ico')));
  const groups=RE.Resource.IconGroupEntry.fromEntries(resource.entries);
  for(const group of groups)RE.Resource.IconGroupEntry.replaceIconsForResource(resource.entries,group.id,group.lang,icon.icons.map(i=>i.data));
  const versions=RE.Resource.VersionInfo.fromEntries(resource.entries),version=versions[0]||RE.Resource.VersionInfo.createEmpty();
  const numbers=context.packager.appInfo.version.split('-')[0].split('.').map(Number);
  if(numbers.length!==3||numbers.some(n=>!Number.isInteger(n)||n<0||n>65535))throw Error('Windows 版本号无效');
  version.setFileVersion(...numbers,0,1033);version.setProductVersion(...numbers,0,1033);
  version.setStringValues({lang:1033,codepage:1200},{FileDescription:'Thunder Fantasy',ProductName:'Thunder Fantasy',InternalName:'Thunder Fantasy',OriginalFilename:'Thunder Fantasy.exe',CompanyName:'Thunder Fantasy',LegalCopyright:'Thunder Fantasy contributors'});
  version.outputToResourceEntries(resource.entries);resource.outputResource(exe);
  const updated=Buffer.from(exe.generate()),check=RE.NtExecutable.from(updated),verify=RE.NtExecutableResource.from(check);
  if(check.newHeader.fileHeader.machine!==exe.newHeader.fileHeader.machine||RE.Resource.IconGroupEntry.fromEntries(verify.entries).length!==groups.length)throw Error('Windows 图标与资源校验失败');
  const temp=file+'.branding';await fs.writeFile(temp,updated);await fs.rename(temp,file);
};
