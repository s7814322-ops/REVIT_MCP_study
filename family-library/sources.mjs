import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export const defaultSources=[
 {id:'doors',label:'門',relativePath:'建築/門'},
 {id:'windows',label:'窗',relativePath:'建築/窗'},
 {id:'safety',label:'職安衛元件',category:'職安衛元件',relativePath:'外部蒐集/2019.12.25 營造業安全衛生(職安署)/元件-職安',recursive:true},
 {id:'accessible-toilet',label:'無障礙廁所',category:'無障礙廁所',relativePath:'外部蒐集/2024.06.27 元件-無障礙廁所相關',recursive:true},
];
export function resolveSources(config,env=process.env) {
 const base=env.ABBY_FAMILY_ROOT || config.familyRoot;
 if(!base || !path.isAbsolute(base))throw Error('請設定 sources.local.json 的 familyRoot 為元件根目錄的完整路徑。');
 const definitions=[...defaultSources,...(config.additionalSources || [])];
 const ids=new Set();
 return definitions.map(source=>{
  if(!source.id || ids.has(source.id) || typeof source.relativePath!=='string')throw Error('元件來源設定不正確。');
  ids.add(source.id);
  const location=path.resolve(base,source.relativePath),basePath=path.resolve(base);
  if(!location.startsWith(basePath+path.sep))throw Error('元件來源必須位於元件根目錄內。');
  return {...source,path:location};
 });
}
export function loadSources(configPath=path.join(root,'sources.local.json')) {
 const config=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\uFEFF/,'')):{};
 return resolveSources(config);
}
// The settings page must also work before the first source folder is configured.
export const librarySources=(()=>{try{return loadSources();}catch{return [];}})();
