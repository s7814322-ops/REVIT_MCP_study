import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {defaultSources,resolveSources} from './sources.mjs';
import {isAuthorizedCopy} from './version-policy.mjs';
const io=fs.promises;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const stable=value=>JSON.stringify(value,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en'))):value);
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const indexNames=['models-index.json','type-models-index.json','rendered-previews.json'];
const emptyIndexes=()=>Object.fromEntries(indexNames.map(name=>[name,{}]));
function indexesAt(root){const indexes=emptyIndexes();for(const name of indexNames)if(fs.existsSync(path.join(root,name)))indexes[name]=readJson(path.join(root,name));return indexes;}
function atomicJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.partial';fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,file);}
async function fileHash(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
function relativeCopy(value,root){if(!value)return null;const result=path.relative(root,path.resolve(root,value)).replaceAll('\\','/');if(result.startsWith('../')||path.isAbsolute(result))throw Error('Preview provenance is outside the local library.');return result;}
function clean(record,root){const result={...record};for(const key of ['url','preview','source','path','error','detail','warnings','warning'])delete result[key];if(result.upgradedCopy)result.upgradedCopy=relativeCopy(result.upgradedCopy,root);return result;}
function safeBlob(blob){return blob&&/^[a-f0-9]{64}$/.test(blob.hash)&&['json','png'].includes(blob.ext);}
function blobFile(shared,blob){if(!safeBlob(blob))throw Error('Invalid preview blob.');return path.join(shared,'assets',blob.hash.slice(0,2),blob.hash+'.'+blob.ext);}
function validateData(data){
 if(!data||!/^([a-f0-9]{16})$/.test(data.id)||!/^[a-f0-9]{64}$/.test(data.sourceHash))throw Error('Invalid preview record.');
 const source=data.definition;
 if(!source||source.id!==data.sourceId||typeof source.relativePath!=='string'||path.isAbsolute(source.relativePath)||source.relativePath.split(/[\\/]/).includes('..'))throw Error('Invalid relative source.');
}
export function createPreviewSync({metadataRoot,configPath,getCatalog,onSourcesChanged=()=>{}}){
 let busy=false;
 const stateFile=path.join(metadataRoot,'.preview-sync-state.json');
 let state;try{state=readJson(stateFile);}catch{state={applied:{},indexes:null};}
 state.applied ||= {};
 const status={state:'waiting',folder:null,published:0,imported:0,waiting:0,lastChecked:null,error:null};
 async function tick(){
  if(busy)return;busy=true;
  try{
   status.lastChecked=new Date().toISOString();status.waiting=0;status.error=null;
   if(!fs.existsSync(configPath)){status.state='unconfigured';return;}
   const config=readJson(configPath),base=process.env.ABBY_FAMILY_ROOT || config.familyRoot;
   if(!base||!path.isAbsolute(base)||!fs.existsSync(base)){status.state='unconfigured';return;}
   const shared=path.join(base,'_ABBY預覽同步');status.folder=shared;await io.mkdir(path.join(shared,'records'),{recursive:true});
   if(state.root!==base){state.root=base;state.indexes=null;state.applied={};state.sourcesPending=true;}
   const records=[];
   for(const directory of await io.readdir(path.join(shared,'records'),{withFileTypes:true})){
    if(!directory.isDirectory()||!/^[a-f0-9]{16}$/.test(directory.name))continue;
    for(const name of await io.readdir(path.join(shared,'records',directory.name))){
     if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
     try{const record=JSON.parse(await io.readFile(path.join(shared,'records',directory.name,name),'utf8'));validateData(record.data);
      if(record.schema!==1||record.data.id!==directory.name||!Number.isSafeInteger(record.generation)||record.generation<1||digest(stable(record.data))+'.json'!==name)throw Error('Invalid record checksum.');
      records.push({...record,key:name.slice(0,-5)});
     }catch{status.waiting++;}
    }
   }
   const indexes=indexesAt(metadataRoot),before=digest(stable(indexes));
   const catalog=getCatalog(),families=new Map(catalog.items.map(item=>[item.id,item]));
   const definitions=new Map((catalog.sources||[]).map(source=>[source.id,source]));
   const catalogKey=digest(stable({sources:catalog.sources,items:catalog.items.map(item=>[item.id,item.sourceHash,item.revitVersion])}));
   async function publishBlob(url){
    const relative=url.split('?')[0],file=path.resolve(metadataRoot,'dist',relative);
    if(!file.startsWith(path.join(metadataRoot,'dist')+path.sep))throw Error('Invalid local preview asset.');
    const bytes=await io.readFile(file),blob={hash:digest(bytes),ext:path.extname(file).slice(1)};const dest=blobFile(shared,blob);
    let exists=false;try{exists=digest(await io.readFile(dest))===blob.hash;}catch{}
    if(!exists){await io.mkdir(path.dirname(dest),{recursive:true});const temp=dest+'.'+crypto.randomUUID()+'.partial';await io.writeFile(temp,bytes);await io.rename(temp,dest);}
    return blob;
   }
   let publishPending=false;
   if(before!==state.indexes || catalogKey!==state.catalog || state.publishPending){
    for(const item of families.values()){
     try{
      const definition=definitions.get(item.sourceId);if(!definition?.relativePath)continue;
      const data={id:item.id,sourceId:item.sourceId,sourceHash:item.sourceHash,sourceVersion:item.revitVersion,definition:{id:definition.id,label:definition.label,category:definition.category,relativePath:definition.relativePath,recursive:Boolean(definition.recursive)}};
      const variants=indexes['type-models-index.json'][item.id];
      if(variants?.sourceHash===item.sourceHash){
       data.types=clean(variants,metadataRoot);data.types.types=[];
       for(const type of variants.types){const value=clean(type,metadataRoot);if(type.status==='ready'&&type.url)value.blob=await publishBlob(type.url);data.types.types.push(value);}data.types.types.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
      }
      const model=indexes['models-index.json'][item.id];if(model?.sourceHash===item.sourceHash&&model.status==='ready'&&model.url)data.model={...clean(model,metadataRoot),blob:await publishBlob(model.url)};
      const preview=indexes['rendered-previews.json'][item.id];if(preview?.sourceHash===item.sourceHash&&preview.preview)data.preview={...clean(preview,metadataRoot),blob:await publishBlob(preview.preview)};
      if(!data.types&&!data.model&&!data.preview)continue;
      validateData(data);const key=digest(stable(data));if(records.some(record=>record.key===key))continue;
      const generation=1+Math.max(0,...records.filter(record=>record.data.id===item.id&&record.data.sourceHash===item.sourceHash).map(record=>record.generation));
      const record={schema:1,generation,data};atomicJson(path.join(shared,'records',item.id,key+'.json'),record);records.push({...record,key});status.published++;
     }catch(error){publishPending=true;status.waiting++;status.error=error.message;}
    }
   }
   // Source definitions travel privately with the cache, never with the public program.
   const additions=new Map((config.additionalSources||[]).map(source=>[source.id,source]));let configChanged=false;
   for(const record of records){const source=record.data.definition;if(defaultSources.some(item=>item.id===source.id)||additions.has(source.id))continue;additions.set(source.id,source);configChanged=true;}
   if(configChanged){const updated={...config,additionalSources:[...additions.values()]};resolveSources(updated);atomicJson(configPath,updated);}
   if(configChanged)state.sourcesPending=true;
   if(state.sourcesPending && onSourcesChanged())state.sourcesPending=false;
   let indexChanged=false;
   async function materialize(record,expectedType=null,processingVersion=null){
    const result={...record};
    if(record.blob){
     const bytes=await io.readFile(blobFile(shared,record.blob));if(digest(bytes)!==record.blob.hash)throw Error('Preview file is not fully synchronized yet.');
     if(record.blob.ext==='json'){
      const model=JSON.parse(bytes);if(model.schema!==1||model.units!=='meters'||!Array.isArray(model.meshes)||processingVersion&&model.revitVersion!==processingVersion)throw Error('Invalid synchronized geometry.');
      if(expectedType && (model.familyType.trim()?model.familyType:'未命名類型')!==expectedType)throw Error('Synchronized type does not match geometry.');
     }else if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid synchronized PNG.');
     const relative=(record.blob.ext==='json'?'models-types':'native')+'/sync/'+record.blob.hash+'.'+record.blob.ext;
     const target=path.join(metadataRoot,'dist',relative);await io.mkdir(path.dirname(target),{recursive:true});let correct=false;try{correct=digest(await io.readFile(target))===record.blob.hash;}catch{}if(!correct)await io.writeFile(target,bytes);
     if(record.blob.ext==='json')result.url=relative+'?v='+record.blob.hash.slice(0,16);else result.preview=relative;
     delete result.blob;
    }
    return result;
   }
   for(const item of families.values()){
    const candidates=records.filter(record=>record.data.id===item.id&&record.data.sourceHash===item.sourceHash&&record.data.sourceVersion===item.revitVersion).sort((a,b)=>b.generation-a.generation||b.key.localeCompare(a.key,'en'));
    if(!candidates.length)continue;
    const signature=digest(candidates.map(record=>record.key).join('|'));
    if(state.applied[item.id]===signature)continue;
    try{
     const allowed=(record,kind)=>{if(!record||record.sourceHash!==item.sourceHash)return false;const version=kind==='preview'?/^Revit (\d{4})$/.exec(record.renderer||'')?.[1]:record.processingVersion;return version===item.revitVersion||isAuthorizedCopy(item,version,record.upgradedCopy,metadataRoot);};
     const group=candidates.find(record=>allowed(record.data.types,'types'))?.data.types;
     let types=null;
     if(group){
      types={...group,types:[]};const names=new Set();
      for(const candidate of candidates){const source=candidate.data.types;if(!allowed(source,'types')||source.processingVersion!==group.processingVersion)continue;for(const type of source.types){if(names.has(type.name))continue;names.add(type.name);types.types.push(await materialize(type,type.name,group.processingVersion));}}
      types.types.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
     }
     const preview=candidates.find(record=>allowed(record.data.preview,'preview'))?.data.preview,model=candidates.find(record=>allowed(record.data.model,'model'))?.data.model;
     const valuePreview=preview?await materialize(preview):null,valueModel=model?await materialize(model,null,model.processingVersion):null;
     if(await fileHash(item.path)!==item.sourceHash){status.waiting++;continue;}
     if(types)indexes['type-models-index.json'][item.id]=types;
     if(valueModel)indexes['models-index.json'][item.id]=valueModel;
     if(valuePreview)indexes['rendered-previews.json'][item.id]=valuePreview;
     state.applied[item.id]=signature;indexChanged=true;status.imported++;
    }catch(error){status.waiting++;status.error=error.message;}
   }
   // An exporter may finish while asynchronous OneDrive reads are in progress.
   // Retry against its fresh indexes instead of overwriting that export.
   if(digest(stable(indexesAt(metadataRoot)))!==before){state.applied={};state.indexes=null;return;}
   if(indexChanged)for(const name of indexNames)atomicJson(path.join(metadataRoot,name),indexes[name]);
   state.indexes=digest(stable(indexes));state.catalog=catalogKey;state.publishPending=publishPending;atomicJson(stateFile,state);
   status.state=status.waiting?'waiting':'watching';
  }catch(error){status.state='error';status.error=error.message;}
  finally{busy=false;}
 }
 return {tick,status};
}
