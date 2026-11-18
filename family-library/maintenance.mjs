import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
export const revitRunning=()=>new Promise(resolve=>execFile('tasklist.exe',['/FI','IMAGENAME eq Revit.exe','/FO','CSV','/NH'],{windowsHide:true,timeout:5000},(error,stdout)=>resolve(Boolean(error)||/revit\.exe/i.test(stdout))));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));

// No caller-supplied filesystem target is accepted by the maintenance API.
export function safeLocal(root,relative){
 const base=path.resolve(root),target=path.resolve(base,relative);
 if(target!==base&&!target.startsWith(base+path.sep))throw Error('Maintenance path escapes library.');
 const parsed=path.parse(target);let cursor=parsed.root;
 for(const part of target.slice(parsed.root.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,part);
  let stat;try{stat=fs.lstatSync(cursor);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(stat?.isSymbolicLink())throw Error('Maintenance refuses symbolic links/junctions.');
 }
 return target;
}
function filesUnder(root){
 const result=[];
 for(const entry of fs.readdirSync(root,{withFileTypes:true})){
  const file=path.join(root,entry.name),stat=fs.lstatSync(file);
  if(stat.isSymbolicLink())throw Error('Temporary copy contains a link; preserved.');
  if(stat.isDirectory())result.push(...filesUnder(file));
  else if(stat.isFile())result.push({file,size:stat.size,mtime:stat.mtimeMs});
  else throw Error('Unexpected temporary entry; preserved.');
 }
 return result;
}
function sharedProof(shared,item){
 const directory=path.join(shared,'records',item.id);
 if(!fs.existsSync(directory))return false;
 return fs.readdirSync(directory).filter(n=>n.endsWith('.json')).some(name=>{
  try{
   const data=read(path.join(directory,name)).data;
   if(data.id!==item.id||data.sourceHash!==item.sourceHash)return false;
   const types=data.types?.types;
   if(!types?.length||types.some(t=>t.status!=='ready'))return false;
   return types.every(type=>{
    const blob=type.blob;
    if(!blob||!/^[a-f0-9]{64}$/.test(blob.hash)||blob.ext!=='json')return false;
    const bytes=fs.readFileSync(path.join(shared,'assets',blob.hash.slice(0,2),blob.hash+'.json'));
    return hash(bytes)===blob.hash;
   });
  }catch{return false;}
 });
}
export function createMaintenance({metadataRoot,configPath,getCatalog,previewSync,refresh,isRevitRunning=revitRunning,now=()=>Date.now()}){
 let busy=false;
 async function run(action,{dryRun=true}={}){
  if(!['cleanup-temp','rebuild-cache'].includes(action))throw Error('Unknown maintenance action.');
  if(busy)throw Error('Maintenance is already running.');
  busy=true;
  try{
   const root=safeLocal(metadataRoot,'.'),config=read(configPath);
   const familyRoot=path.resolve(process.env.ABBY_FAMILY_ROOT||config.familyRoot||'');
   if(!config.familyRoot&&!process.env.ABBY_FAMILY_ROOT)throw Error('Configure the family root first.');
   if(!fs.existsSync(familyRoot)||!fs.statSync(familyRoot).isDirectory())throw Error('Family/shared folder is unavailable; existing cache preserved.');
   if(root===familyRoot||root.startsWith(familyRoot+path.sep)||familyRoot.startsWith(root+path.sep))throw Error('Local cache must be separate from original/shared families.');
   // Validate every destination the preview importer can write through.
   for(const relative of ['dist','dist/models-types','dist/models-types/sync','dist/native','dist/native/sync','models-index.json','type-models-index.json','rendered-previews.json','.preview-sync-state.json','sources.local.json'])safeLocal(root,relative);
   if(action==='rebuild-cache'){
    if(dryRun)return {ok:true,dryRun:true,action,description:'Verify shared assets and restore local preview copies; shared data is read-only.'};
    await previewSync.tick({repair:true,readOnlyShared:true});
    if(previewSync.status.error)throw Error(previewSync.status.error);
    refresh();return {ok:true,action,sharedReadOnly:true,status:{...previewSync.status}};
   }
   if(await isRevitRunning())return {ok:true,action,deferred:true,reason:'Revit is running; temporary copies preserved.'};
   const parent=safeLocal(root,'render/upgrade-copies'),catalog=getCatalog(),shared=path.join(familyRoot,'_ABBY預覽同步');
   const candidates=[],skipped=[];
   if(fs.existsSync(parent))for(const batch of fs.readdirSync(parent,{withFileTypes:true})){
    if(!batch.isDirectory())continue;
    const batchPath=safeLocal(root,path.relative(root,path.join(parent,batch.name)));
    for(const entry of fs.readdirSync(batchPath,{withFileTypes:true})){
     const match=/^([a-f0-9]{16})-[a-f0-9]{32}$/.exec(entry.name);
     if(!entry.isDirectory()||!match)continue;
     try{
      const directory=safeLocal(root,path.relative(root,path.join(batchPath,entry.name)));
      const files=filesUnder(directory),item=catalog.items.find(i=>i.id===match[1]);
      if(!item||!files.some(f=>path.basename(f.file)==='preview-working.rfa')||!files.length||files.some(f=>now()-f.mtime<86400000))throw Error('Not a completed copy older than 24 hours.');
      if(!sharedProof(shared,item))throw Error('Complete shared previews could not be verified.');
      candidates.push({directory,bytes:files.reduce((n,f)=>n+f.size,0)});
     }catch(error){skipped.push({name:entry.name,reason:error.message});}
    }
   }
   if(!dryRun)for(const candidate of candidates){
    // Recheck containment, links, age, and Revit immediately before each delete.
    safeLocal(root,path.relative(root,candidate.directory));
    if(await isRevitRunning())throw Error('Revit started; remaining copies preserved.');
    if(filesUnder(candidate.directory).some(f=>now()-f.mtime<86400000))throw Error('Copy changed; preserved.');
    fs.rmSync(candidate.directory,{recursive:true});
   }
   return {ok:true,action,dryRun,copies:candidates.length,bytes:candidates.reduce((n,c)=>n+c.bytes,0),skipped,sharedReadOnly:true};
  }finally{busy=false;}
 }
 return {run,get busy(){return busy;}};
}
