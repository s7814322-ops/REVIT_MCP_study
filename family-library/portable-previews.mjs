import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isAuthorizedCopy} from './version-policy.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const [mode,destination]=process.argv.slice(2);
if(mode!=='export' || !destination)throw Error('Usage: node portable-previews.mjs export <empty-folder>');
const target=path.resolve(destination);
if(fs.existsSync(target)&&fs.readdirSync(target).length)throw Error('Destination must be empty.');
if(target===root || target.startsWith(path.join(root,'dist')+path.sep))throw Error('Choose a separate output folder.');
fs.mkdirSync(target,{recursive:true});
const families=new Map(JSON.parse(fs.readFileSync(path.join(root,'dist/catalog.json'))).items.map(item=>[item.id,item]));
for(const name of ['models-index.json','type-models-index.json','rendered-previews.json']){
 const source=path.join(root,name);if(!fs.existsSync(source))continue;
 const result={};
 for(const [id,record] of Object.entries(JSON.parse(fs.readFileSync(source)))){
  const family=families.get(id);if(!family || family.sourceHash!==record.sourceHash)continue;
  const copy={...record};
  const processing=record.processingVersion || record.renderer?.replace('Revit ','');
  if(record.upgradedCopy){if(!isAuthorizedCopy(family,processing,record.upgradedCopy,root))continue;copy.upgradedCopy=path.relative(root,path.resolve(root,record.upgradedCopy)).replaceAll('\\','/');}
  delete copy.source;delete copy.path;delete copy.error;delete copy.warning;delete copy.warnings;delete copy.detail;
  if(copy.types)copy.types=copy.types.map(({detail,warnings,...type})=>type);
  const urls=[copy.url,copy.preview,...(copy.types||[]).map(type=>type.url)].filter(Boolean);
  if(urls.some(url=>{const input=path.resolve(root,'dist',url.split('?')[0]);return !input.startsWith(path.join(root,'dist')+path.sep)||!fs.existsSync(input);}))continue;
  for(const url of urls){const relative=url.split('?')[0],output=path.resolve(target,'dist',relative);fs.mkdirSync(path.dirname(output),{recursive:true});fs.copyFileSync(path.resolve(root,'dist',relative),output);}
  result[id]=copy;
 }
 fs.writeFileSync(path.join(target,name),JSON.stringify(result,null,2));
}
fs.writeFileSync(path.join(target,'preview-pack.json'),JSON.stringify({schema:1,created:new Date().toISOString(),note:'Private preview data; do not commit to a public repository.'},null,2));
console.log('Preview pack exported to '+target);
