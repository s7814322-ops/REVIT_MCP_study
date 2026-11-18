import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createMaintenance,safeLocal} from './maintenance.mjs';
import {createPreviewSync} from './preview-sync.mjs';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const stable=value=>JSON.stringify(value,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en'))):value);
function fixture(){
 const outer=fs.mkdtempSync(path.join(os.tmpdir(),'abby-maintenance-')),root=path.join(outer,'cache'),families=path.join(outer,'families');
 fs.mkdirSync(path.join(root,'dist'),{recursive:true});fs.mkdirSync(families);
 const source=Buffer.from('original fixture RFA, never edited'),id='a'.repeat(16),sourceHash=digest(source),sourcePath=path.join(families,'sample.rfa');fs.writeFileSync(sourcePath,source);
 const item={id,path:sourcePath,sourceHash,sourceId:'test',revitVersion:'2025'};
 const model=Buffer.from(JSON.stringify({schema:1,units:'meters',revitVersion:'2025',familyType:'T',meshes:[{positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2]}]}));const blob={hash:digest(model),ext:'json'};
 const shared=path.join(families,'_ABBY預覽同步'),record={schema:1,generation:1,data:{id,sourceId:'test',sourceHash,sourceVersion:'2025',definition:{id:'test',label:'test',category:'test',relativePath:'test',recursive:true},types:{sourceHash,sourceVersion:'2025',processingVersion:'2025',types:[{name:'T',status:'ready',blob}]}}};
 const recordDir=path.join(shared,'records',id),asset=path.join(shared,'assets',blob.hash.slice(0,2),blob.hash+'.json');fs.mkdirSync(recordDir,{recursive:true});fs.mkdirSync(path.dirname(asset),{recursive:true});fs.writeFileSync(path.join(recordDir,digest(stable(record.data))+'.json'),JSON.stringify(record));fs.writeFileSync(asset,model);
 const configPath=path.join(root,'sources.local.json');fs.writeFileSync(configPath,JSON.stringify({familyRoot:families,additionalSources:[record.data.definition]}));
 const catalog={items:[item],sources:[{...record.data.definition,path:path.join(families,'test')} ]};
 const sync=createPreviewSync({metadataRoot:root,configPath,getCatalog:()=>catalog});
 const maintenance=options=>createMaintenance({metadataRoot:root,configPath,getCatalog:()=>catalog,previewSync:sync,refresh:()=>{},isRevitRunning:async()=>false,...options});
 return {outer,root,families,id,sourcePath,sourceHash,asset,model,blob,shared,maintenance,sync};
}
test('repair missing/corrupt cache from shared blobs, preserve originals and shared bytes',async()=>{
 const f=fixture(),before=digest(fs.readFileSync(f.asset));
 await f.maintenance().run('rebuild-cache',{dryRun:false});
 const cache=path.join(f.root,'dist/models-types/sync',f.blob.hash+'.json');assert.deepEqual(fs.readFileSync(cache),f.model);
 fs.writeFileSync(cache,'corrupt');await f.maintenance().run('rebuild-cache',{dryRun:false});assert.deepEqual(fs.readFileSync(cache),f.model);
 assert.equal(digest(fs.readFileSync(f.sourcePath)),f.sourceHash);assert.equal(digest(fs.readFileSync(f.asset)),before);
 fs.writeFileSync(f.asset,'not synchronized');fs.writeFileSync(cache,'keep existing');await assert.rejects(f.maintenance().run('rebuild-cache',{dryRun:false}));assert.equal(fs.readFileSync(cache,'utf8'),'keep existing');
});
test('cleanup only old completed, shared-verified copies; dry run and running Revit preserve them',async()=>{
 const f=fixture(),directory=path.join(f.root,'render/upgrade-copies/test-2025',f.id+'-'+'b'.repeat(32));fs.mkdirSync(directory,{recursive:true});const copy=path.join(directory,'preview-working.rfa');fs.writeFileSync(copy,'temporary upgraded copy');
 assert.equal((await f.maintenance().run('cleanup-temp',{dryRun:false})).copies,0);
 const old=new Date(Date.now()-2*86400000);fs.utimesSync(copy,old,old);
 assert.equal((await f.maintenance().run('cleanup-temp')).copies,1);assert.ok(fs.existsSync(copy));
 assert.equal((await f.maintenance({isRevitRunning:async()=>true}).run('cleanup-temp',{dryRun:false})).deferred,true);assert.ok(fs.existsSync(copy));
 assert.equal((await f.maintenance().run('cleanup-temp',{dryRun:false})).copies,1);assert.ok(!fs.existsSync(directory));assert.ok(fs.existsSync(f.asset));assert.equal(digest(fs.readFileSync(f.sourcePath)),f.sourceHash);
});
test('reject path escape/junctions and never delete without intact shared preview',async()=>{
 const f=fixture();assert.throws(()=>safeLocal(f.root,'../families'));
 const directory=path.join(f.root,'render/upgrade-copies/test-2025',f.id+'-'+'c'.repeat(32));fs.mkdirSync(directory,{recursive:true});const copy=path.join(directory,'preview-working.rfa');fs.writeFileSync(copy,'copy');const old=new Date(Date.now()-2*86400000);fs.utimesSync(copy,old,old);fs.writeFileSync(f.asset,'corrupt');
 assert.equal((await f.maintenance().run('cleanup-temp',{dryRun:false})).copies,0);assert.ok(fs.existsSync(copy));
 const junction=path.join(f.root,'linked');fs.symlinkSync(f.families,junction,process.platform==='win32'?'junction':'dir');assert.throws(()=>safeLocal(f.root,'linked/sample.rfa'));
 await assert.rejects(f.maintenance().run('delete-anything',{dryRun:false}));
});
