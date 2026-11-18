import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {defaultSources,resolveSources} from './sources.mjs';
import {listFamilyFiles} from './source-files.mjs';
import {buildCatalog} from './build-catalog.mjs';

export function createSettings({configPath,dist,metadataRoot,getSources,applySources,env=process.env}) {
 const token=crypto.randomBytes(32).toString('hex');
 function read(){return fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\uFEFF/,'')):{};}
 function snapshot(){
  let config={},error=null;try{config=read();}catch{error='設定檔無法讀取，請重新設定並儲存。';}
  return {config:{familyRoot:env.ABBY_FAMILY_ROOT || config.familyRoot || ''},environmentRoot:env.ABBY_FAMILY_ROOT || null,error,token,
   active:getSources().map(source=>({id:source.id,path:source.path}))};
 }
 function save(input){
  if(!input || typeof input.familyRoot!=='string')throw Error('請填寫元件根目錄。');
  const config={familyRoot:input.familyRoot.trim()};
  const existing=read();
  if(Array.isArray(existing.additionalSources) && existing.additionalSources.length)config.additionalSources=existing.additionalSources;
  if(env.ABBY_FAMILY_ROOT && config.familyRoot!==env.ABBY_FAMILY_ROOT)throw Error('根目錄由 ABBY_FAMILY_ROOT 環境變數指定。');
  const sources=resolveSources(config,env);
  const counts=[];
  for(const source of sources){
   try{if(!fs.statSync(source.path).isDirectory())throw Error();counts.push({id:source.id,label:source.label,count:listFamilyFiles(source).length});}
   catch{throw Error('找不到或無法讀取「'+source.label+'」資料夾：'+source.path);}
  }
  // Build in isolation. Invalid or locked RFAs cannot replace the current catalog.
  const staged=fs.mkdtempSync(path.join(path.dirname(dist),'.settings-build-'));
  const oldConfig=fs.existsSync(configPath)?fs.readFileSync(configPath):null;
  const oldCatalog=['catalog.json','catalog.js'].map(name=>[name,fs.existsSync(path.join(dist,name))?fs.readFileSync(path.join(dist,name)):null]);
  const temporary=configPath+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
  try{
   for(const entry of fs.readdirSync(dist,{withFileTypes:true}))if(entry.isDirectory()&&entry.name!=='previews')fs.symlinkSync(path.join(dist,entry.name),path.join(staged,entry.name),process.platform==='win32'?'junction':'dir');
   if(oldCatalog[0][1])fs.writeFileSync(path.join(staged,'catalog.json'),oldCatalog[0][1]);
   const catalog=buildCatalog({sources,output:staged,metadataRoot});
   fs.writeFileSync(temporary,JSON.stringify(config,null,2)+'\n');
   fs.mkdirSync(path.join(dist,'previews'),{recursive:true});
   for(const name of fs.readdirSync(path.join(staged,'previews')))fs.renameSync(path.join(staged,'previews',name),path.join(dist,'previews',name));
   fs.renameSync(temporary,configPath);
   for(const [name] of oldCatalog)fs.renameSync(path.join(staged,name),path.join(dist,name));
   applySources(sources,catalog);
   return {ok:true,counts,total:catalog.items.length,revision:catalog.revision};
  }catch(error){
   if(oldConfig)fs.writeFileSync(configPath,oldConfig);else if(fs.existsSync(configPath))fs.unlinkSync(configPath);
   for(const [name,bytes] of oldCatalog){if(bytes)fs.writeFileSync(path.join(dist,name),bytes);else if(fs.existsSync(path.join(dist,name)))fs.unlinkSync(path.join(dist,name));}
   throw error;
  }finally{
   if(fs.existsSync(temporary))fs.unlinkSync(temporary);
   // Unlink junctions first so cleanup never follows a link to live model assets.
   for(const entry of fs.readdirSync(staged,{withFileTypes:true})){const file=path.join(staged,entry.name);if(fs.lstatSync(file).isSymbolicLink())fs.unlinkSync(file);}
   if(path.dirname(path.resolve(staged))!==path.resolve(path.dirname(dist)) || !path.basename(staged).startsWith('.settings-build-'))throw Error('Unexpected staging directory.');
   fs.rmSync(staged,{recursive:true,force:true});
  }
 }
 return {snapshot,save,token};
}

