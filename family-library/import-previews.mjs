import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveSources} from './sources.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const pack=path.resolve(process.argv[2] || '');
if(!process.argv[2])throw Error('Usage: node import-previews.mjs <preview-pack-folder>');
const manifest=JSON.parse(fs.readFileSync(path.join(pack,'preview-pack.json'),'utf8'));
if(![1,2].includes(manifest.schema))throw Error('Unsupported preview pack.');
const configPath=path.join(root,'sources.local.json');
const config=JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));
const sources=new Map((config.additionalSources||[]).map(source=>[source.id,source]));
for(const source of manifest.additionalSources || []){
 if(!source || typeof source.relativePath!=='string' || path.isAbsolute(source.relativePath) || source.relativePath.split(/[\\/]/).includes('..'))throw Error('Invalid source definition.');
 const previous=sources.get(source.id);
 if(previous && previous.relativePath!==source.relativePath)throw Error('Existing source has a different relative path: '+source.id);
 const {id,label,category,relativePath,recursive}=source;sources.set(id,{id,label,category,relativePath,recursive:Boolean(recursive)});
}
if(sources.size)config.additionalSources=[...sources.values()];
resolveSources(config);
const indexes=['models-index.json','type-models-index.json','rendered-previews.json'];
const assets=new Map(),merged=new Map();
for(const name of indexes){
 const file=path.join(pack,name);if(!fs.existsSync(file))continue;
 const incoming=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const record of Object.values(incoming))for(const url of [record.url,record.preview,...(record.types||[]).map(type=>type.url)].filter(Boolean)){
  const relative=url.split('?')[0],parts=relative.split('/');
  if(!['models','models-v2','models-types','native','rendered'].includes(parts[0]) || parts.includes('..') || /[\\:]/.test(relative) || !/\.(json|png)$/i.test(relative))throw Error('Unsafe preview asset path.');
  const input=path.resolve(pack,'dist',relative);if(!input.startsWith(path.join(pack,'dist')+path.sep)||!fs.statSync(input).isFile())throw Error('Preview asset missing.');
  const bytes=fs.readFileSync(input);
  if(/\.json$/i.test(relative)){const model=JSON.parse(bytes);if(model.schema!==1 || !Array.isArray(model.meshes))throw Error('Invalid model asset.');}
  else if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid PNG asset.');
  assets.set(relative,bytes);
 }
 const previous=path.join(root,name);merged.set(name,{...(fs.existsSync(previous)?JSON.parse(fs.readFileSync(previous,'utf8')):{}),...incoming});
}
// Only validated preview assets are copied; source RFAs and web code are untouched.
for(const [relative,bytes] of assets){const target=path.resolve(root,'dist',relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
for(const [name,index] of merged){const file=path.join(root,name);fs.writeFileSync(file+'.tmp',JSON.stringify(index,null,2));fs.renameSync(file+'.tmp',file);}
fs.writeFileSync(configPath+'.tmp',JSON.stringify(config,null,2)+'\n');fs.renameSync(configPath+'.tmp',configPath);
console.log(JSON.stringify({importedAssets:assets.size,additionalSources:sources.size}));
