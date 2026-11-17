import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {createPreviewSync} from './preview-sync.mjs';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data));};
const read=file=>JSON.parse(fs.readFileSync(file));
test('bidirectional previews use local roots, validate blobs and source bytes, and do not echo',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'abby-preview-sync-'));
 const previous=process.env.ABBY_FAMILY_ROOT;delete process.env.ABBY_FAMILY_ROOT;
 try{
  const id='0123456789abcdef',bytes=Buffer.from('fake RFA bytes'),sourceHash=hash(bytes);
  function machine(name){
   const metadataRoot=path.join(temp,name,'app'),familyRoot=path.join(temp,name,'families'),file=path.join(familyRoot,'doors','family.rfa');
   fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
   const configPath=path.join(metadataRoot,'sources.local.json');json(configPath,{familyRoot});
   const item={id,sourceId:'extra',sourceHash,revitVersion:'2021',path:file};
   const catalog={items:[item],sources:[{id:'extra',relativePath:'doors',label:'Doors',category:'門',recursive:true}]};
   const engine=createPreviewSync({metadataRoot,configPath,getCatalog:()=>catalog,onSourcesChanged:()=>true});
   return {metadataRoot,familyRoot,file,item,engine,shared:path.join(familyRoot,'_ABBY預覽同步')};
  }
  const a=machine('A'),b=machine('B');
  function exportType(machine,name,width){
   const file='models-types/'+name+'.json';json(path.join(machine.metadataRoot,'dist',file),{schema:1,units:'meters',meshes:[],revitVersion:'2021',familyType:name,width});
   const index=path.join(machine.metadataRoot,'type-models-index.json');let data={};if(fs.existsSync(index))data=read(index);
   const entry=data[id]||{sourceHash,processingVersion:'2021',types:[]};entry.types=entry.types.filter(x=>x.name!==name);entry.types.push({name,status:'ready',url:file});data[id]=entry;json(index,data);
  }
  const transfer=(from,to)=>fs.cpSync(from.shared,to.shared,{recursive:true});
  exportType(a,'900',0.9);await a.engine.tick();assert.equal(a.engine.status.state,'watching');assert.equal(a.engine.status.published,1);
  transfer(a,b);
  const blob=fs.readdirSync(path.join(b.shared,'assets'),{recursive:true}).find(x=>x.endsWith('.json'));
  const blobPath=path.join(b.shared,'assets',blob),original=fs.readFileSync(blobPath);fs.writeFileSync(blobPath,'partial');
  await b.engine.tick();assert.equal(b.engine.status.imported,0);assert.ok(b.engine.status.waiting>0);
  fs.writeFileSync(blobPath,original);fs.writeFileSync(b.file,'changed source');await b.engine.tick();assert.equal(b.engine.status.imported,0);
  fs.writeFileSync(b.file,bytes);await b.engine.tick();assert.equal(b.engine.status.imported,1);
  let index=read(path.join(b.metadataRoot,'type-models-index.json'));assert.equal(index[id].types[0].name,'900');assert.ok(fs.existsSync(path.join(b.metadataRoot,'dist',index[id].types[0].url.split('?')[0])));
  assert.equal(read(path.join(b.metadataRoot,'sources.local.json')).familyRoot,b.familyRoot);
  await b.engine.tick();assert.equal(b.engine.status.published,0,'import must not publish echo');
  exportType(b,'1200',1.2);await b.engine.tick();assert.equal(b.engine.status.published,1);
  transfer(b,a);await a.engine.tick();index=read(path.join(a.metadataRoot,'type-models-index.json'));assert.deepEqual(index[id].types.map(x=>x.name),['1200','900']);
  exportType(a,'900',0.95);await a.engine.tick();transfer(a,b);await b.engine.tick();
  index=read(path.join(b.metadataRoot,'type-models-index.json'));const model=read(path.join(b.metadataRoot,'dist',index[id].types.find(x=>x.name==='900').url.split('?')[0]));assert.equal(model.width,0.95);
  await a.engine.tick();await b.engine.tick();assert.equal(b.engine.status.published,1,'stable after bidirectional updates');
  const records=fs.readdirSync(path.join(a.shared,'records',id)).map(name=>fs.readFileSync(path.join(a.shared,'records',id,name),'utf8')).join('');assert.ok(!records.includes(a.metadataRoot));assert.ok(!records.includes(a.familyRoot));
 }finally{if(previous===undefined)delete process.env.ABBY_FAMILY_ROOT;else process.env.ABBY_FAMILY_ROOT=previous;fs.rmSync(temp,{recursive:true,force:true});}
});
